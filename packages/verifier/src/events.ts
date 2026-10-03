import { sleeveModuleAbi, type Address, type Receipt } from '@sleeve/core';
import { decodeEventLog, encodeEventTopics, numberToHex, pad } from 'viem';

import type { RawLog } from './evidence';
import { decodeReceiptLog, isReceiptLog } from './receipt';
import { indexOfLog } from './trades';

/**
 * The module's companion events in a receipt's transaction. A ledger reconcile logs Reconciled with each bucket's cut
 * next to its RECONCILED receipt; a lot reconcile logs LotsReconciled with the total trimmed after its run of
 * RECONCILED receipts (SPEC 13).
 */

export const RECONCILED_TOPIC = encodeEventTopics({ abi: sleeveModuleAbi, eventName: 'Reconciled' })[0];
export const LOTS_RECONCILED_TOPIC = encodeEventTopics({ abi: sleeveModuleAbi, eventName: 'LotsReconciled' })[0];

function same(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export interface ReconciledEvent {
  balance: bigint;
  fromSpend: bigint;
  fromBuckets: readonly bigint[];
}

/** The Reconciled log for a RECONCILED receipt id, emitted by the module in the same transaction. */
export function findReconciled(logs: readonly RawLog[], module: Address, receiptId: bigint): ReconciledEvent | null {
  const idTopic = pad(numberToHex(receiptId), { size: 32 });
  for (const log of logs) {
    const [signature, account, id] = log.topics;
    if (!same(log.address, module) || signature !== RECONCILED_TOPIC || account === undefined || id === undefined) continue;
    if (id.toLowerCase() !== idTopic.toLowerCase()) continue;
    const { args } = decodeEventLog({ abi: sleeveModuleAbi, eventName: 'Reconciled', topics: [signature, account, id], data: log.data });
    return { balance: args.balance, fromSpend: args.fromSpend, fromBuckets: args.fromBuckets };
  }
  return null;
}

export interface LotRun {
  receipts: readonly Receipt[];
  containsTarget: boolean;
  tokensIn: bigint;
  /** LotsReconciled: the account's token balance and the total trimmed. */
  balance: bigint;
  trimmed: bigint;
}

function isLotReconcile(receipt: Receipt): boolean {
  return receipt.status === 'RECONCILED' && !/^0x0{40}$/i.test(receipt.token);
}

/**
 * A lot reconcile's run: the RECONCILED receipts with a token that come right before the first LotsReconciled log for
 * the account and ticker after the target, with sequential ids.
 */
export function findLotRun(logs: readonly RawLog[], receiptLogIndex: number, target: Receipt, module: Address): LotRun | null {
  const start = indexOfLog(logs, receiptLogIndex);
  if (start < 0) return null;
  for (let i = start + 1; i < logs.length; i += 1) {
    const log = logs[i];
    if (log === undefined) break;
    const [signature, account, ticker] = log.topics;
    if (!same(log.address, module) || signature !== LOTS_RECONCILED_TOPIC || account === undefined || ticker === undefined) continue;
    const { args } = decodeEventLog({
      abi: sleeveModuleAbi,
      eventName: 'LotsReconciled',
      topics: [signature, account, ticker],
      data: log.data,
    });
    if (!same(args.account, target.account) || args.tickerId !== target.tickerId) continue;
    const receipts: Receipt[] = [];
    let containsTarget = false;
    for (let j = i - 1; j >= 0; j -= 1) {
      const previous = logs[j];
      if (previous === undefined || !isReceiptLog(previous, module)) break;
      const decoded = decodeReceiptLog(previous);
      if (!decoded.ok) break;
      const receipt = decoded.value.receipt;
      const next = receipts[0];
      const fits =
        isLotReconcile(receipt) &&
        same(receipt.account, target.account) &&
        receipt.tickerId === target.tickerId &&
        (next === undefined || receipt.id + 1n === next.id);
      if (!fits) break;
      receipts.unshift(receipt);
      if (previous.logIndex === receiptLogIndex) containsTarget = true;
    }
    return {
      receipts,
      containsTarget,
      tokensIn: receipts.reduce((sum, receipt) => sum + receipt.tokensIn, 0n),
      balance: args.balance,
      trimmed: args.trimmed,
    };
  }
  return null;
}
