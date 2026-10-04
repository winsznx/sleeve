import type { Receipt } from '@sleeve/core';
import { type Hex, type TransactionReceipt, keccak256 } from 'viem';

import { type KeeperCall, MODULE_ADDRESS } from '../chain/calls';
import { decodeModuleLog, lower } from '../chain/events';
import type { ChainGateway } from '../chain/gateway';
import { PostconditionError } from '../errors';

/** What a keeper transaction was for: a split that sorts, a split that only reconciles, or a settle. */
export type ActionKind = 'SORT' | 'RECONCILE' | 'SETTLE';

export interface ConfirmedAction {
  receipt: Receipt;
  receiptHash: Hex;
  /** Whether the ledger checks read state at the transaction's block (false when the RPC no longer had it). */
  stateAtBlock: boolean;
  gasUsed: bigint;
  effectiveGasPrice: bigint;
}

const SORT_STATUSES: ReadonlySet<Receipt['status']> = new Set([
  'FILLED',
  'QUEUED',
  'REFUSED_TICKER',
  'REFUSED_ACCOUNT',
]);
const SETTLE_STATUSES: ReadonlySet<Receipt['status']> = new Set(['SETTLED', 'REFUSED_TICKER', 'REFUSED_ACCOUNT']);

function check(condition: boolean, message: string): void {
  if (!condition) throw new PostconditionError(message);
}

/** The receipt fields every keeper action must carry, by kind (SPEC 13). */
export function checkReceiptShape(kind: ActionKind, call: KeeperCall, receipt: Receipt): void {
  const id = receipt.id;
  check(receipt.account === lower(call.account), `receipt ${id} is for ${receipt.account}, not ${call.account}`);
  check(receipt.trigger === 'KEEPER', `receipt ${receipt.id} has trigger ${receipt.trigger}, not KEEPER`);
  if (kind === 'SORT') {
    check(SORT_STATUSES.has(receipt.status), `receipt ${receipt.id} is ${receipt.status}, not a split`);
    check(receipt.usdgIn > 0n, `split receipt ${receipt.id} sorted nothing`);
    check(
      receipt.usdgIn === receipt.usdgToSpend + receipt.usdgSpent + receipt.usdgQueued,
      `split receipt ${id} breaks I2: ${receipt.usdgIn} in, ` +
        `${receipt.usdgToSpend} + ${receipt.usdgSpent} + ${receipt.usdgQueued} out`,
    );
  } else if (kind === 'RECONCILE') {
    check(receipt.status === 'RECONCILED', `receipt ${receipt.id} is ${receipt.status}, not RECONCILED`);
    check(
      receipt.usdgIn === receipt.usdgSpent + receipt.usdgQueued,
      `reconcile receipt ${id}: shortfall ${receipt.usdgIn} is not the cuts ` +
        `${receipt.usdgSpent} + ${receipt.usdgQueued}`,
    );
  } else {
    check(SETTLE_STATUSES.has(receipt.status), `receipt ${receipt.id} is ${receipt.status}, not a settle`);
    const sameTicker = call.fn === 'settle' && receipt.tickerId === call.tickerId;
    check(sameTicker, `settle receipt ${id} is for ticker ${receipt.tickerId}`);
    check(receipt.usdgIn === 0n, `settle receipt ${receipt.id} carries ${receipt.usdgIn} USDG in`);
  }
  if (receipt.status === 'FILLED' || receipt.status === 'SETTLED') {
    check(receipt.lotId === receipt.id && receipt.tokensOut > 0n, `buy receipt ${receipt.id} has no lot of its own`);
  }
}

/** The one ReceiptWritten of the account in a transaction's logs, with its raw data. */
function accountReceipt(mined: TransactionReceipt, call: KeeperCall): { receipt: Receipt; data: Hex } {
  const found: { receipt: Receipt; data: Hex }[] = [];
  for (const log of mined.logs) {
    if (lower(log.address) !== lower(MODULE_ADDRESS)) continue;
    const event = decodeModuleLog(log);
    if (event?.kind === 'ReceiptWritten' && event.receipt.account === lower(call.account)) {
      found.push({ receipt: event.receipt, data: event.data });
    }
  }
  if (found.length !== 1 || found[0] === undefined) {
    throw new PostconditionError(
      `expected one receipt for ${call.account} in ${mined.transactionHash}, found ${found.length}`,
    );
  }
  return found[0];
}

/**
 * Success is read back from chain state, never assumed from a hash or a status (build contract rule 4): the
 * transaction wrote the receipt this action writes, the module stores that receipt's hash, the ledger shows the
 * action at the transaction's block, and a buy's lot holds its tokens.
 */
export async function confirmAction(
  chain: ChainGateway,
  kind: ActionKind,
  call: KeeperCall,
  mined: TransactionReceipt,
): Promise<ConfirmedAction> {
  check(mined.status === 'success', `transaction ${mined.transactionHash} reverted`);
  const { receipt, data } = accountReceipt(mined, call);
  checkReceiptShape(kind, call, receipt);

  const stored = await chain.receiptHash(receipt.id);
  const fromData = keccak256(data);
  check(stored === fromData, `the module stores ${stored} for receipt ${receipt.id}, the event hashes to ${fromData}`);

  let stateAtBlock = true;
  try {
    if (kind === 'SETTLE' && call.fn === 'settle') {
      const bucket = await chain.bucketOf(call.account, call.tickerId, mined.blockNumber);
      const left = bucket.amount;
      check(left === 0n, `bucket ${call.tickerId} of ${call.account} still holds ${left} after settle`);
    } else {
      const ledger = await chain.ledger(call.account, mined.blockNumber);
      if (kind === 'SORT') check(ledger.unsorted === 0n, `${ledger.unsorted} USDG still unsorted after the split`);
      else {
        const booked = ledger.spend + ledger.pendingTotal;
        check(booked <= ledger.balance, 'the ledgers still exceed the balance after the reconcile');
      }
    }
  } catch (error) {
    if (error instanceof PostconditionError) throw error;
    stateAtBlock = false;
  }

  if (receipt.status === 'FILLED' || receipt.status === 'SETTLED') {
    const lot = await chain.lot(receipt.id);
    check(lot.account === receipt.account && lot.tickerId === receipt.tickerId, `lot ${receipt.id} belongs elsewhere`);
    const bought = receipt.tokensOut;
    check(lot.tokensBought === bought, `lot ${receipt.id} holds ${lot.tokensBought}, the receipt bought ${bought}`);
  }

  return {
    receipt,
    receiptHash: fromData,
    stateAtBlock,
    gasUsed: mined.gasUsed,
    effectiveGasPrice: mined.effectiveGasPrice,
  };
}
