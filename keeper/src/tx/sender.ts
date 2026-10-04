import { CHAIN_ID } from '@sleeve/core';
import {
  type Address,
  BaseError,
  type Hex,
  type TransactionReceipt,
  WaitForTransactionReceiptTimeoutError,
  keccak256,
} from 'viem';
import type { LocalAccount } from 'viem/accounts';

import { type KeeperCall, encodeKeeperCall } from '../chain/calls';
import type { ChainGateway } from '../chain/gateway';
import { GasAboveCapError, SendError, TxTimeoutError } from '../errors';
import type { Logger } from '../log';
import { feesFor, gasLimitFor } from './fees';
import type { NonceManager } from './nonce';

export interface SenderOptions {
  chain: ChainGateway;
  account: LocalAccount;
  nonces: NonceManager;
  maxFeeWei: bigint;
  maxGas: bigint;
  receiptTimeoutMs?: number;
  log: Logger;
}

export interface MinedTransaction {
  txHash: Hex;
  receipt: TransactionReceipt;
  nonce: number;
  gasLimit: bigint;
  maxFeePerGas: bigint;
}

/** A send the node already holds: the transaction went out, so wait for it instead of resyncing. */
function alreadyKnown(error: unknown): boolean {
  const text = error instanceof BaseError ? `${error.shortMessage} ${error.details}` : String(error);
  return /already known|known transaction/i.test(text);
}

/**
 * Signs and sends keeper calls one at a time from the keeper key: gas estimated and capped per call, EIP-1559 fees
 * capped, the nonce from the keeper's own counter, and the receipt awaited. It reports what was mined; whether the
 * action happened is decided by reading state back (tx/postcondition.ts), never by the hash.
 */
export class TxSender {
  private readonly receiptTimeoutMs: number;

  constructor(private readonly options: SenderOptions) {
    this.receiptTimeoutMs = options.receiptTimeoutMs ?? 60_000;
  }

  get address(): Address {
    return this.options.account.address;
  }

  async send(call: KeeperCall, baseFeePerGas: bigint): Promise<MinedTransaction> {
    const { chain, account, nonces, log } = this.options;
    const request = encodeKeeperCall(call);
    const estimate = await chain.estimateGas(request, account.address);
    if (estimate > this.options.maxGas) throw new GasAboveCapError(estimate, this.options.maxGas);
    const gasLimit = gasLimitFor(estimate, this.options.maxGas);
    const fees = feesFor(baseFeePerGas, this.options.maxFeeWei);
    const nonce = await nonces.take();
    const serialized = await account.signTransaction({
      type: 'eip1559',
      chainId: CHAIN_ID,
      nonce,
      to: request.to,
      data: request.data,
      value: 0n,
      gas: gasLimit,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    });
    const localHash = keccak256(serialized);

    let txHash: Hex;
    try {
      txHash = await chain.sendRawTransaction(serialized);
    } catch (error) {
      if (!alreadyKnown(error)) {
        await nonces.resync().catch((resyncError: unknown) => log.error('nonce resync failed', { error: resyncError }));
        const message = error instanceof BaseError ? error.shortMessage : String(error);
        throw new SendError('SEND_FAILED', `the RPC refused the transaction with nonce ${nonce}: ${message}`, {
          cause: error,
        });
      }
      txHash = localHash;
    }
    log.info('transaction sent', {
      txHash,
      nonce,
      gasLimit,
      maxFeePerGas: fees.maxFeePerGas,
      fn: call.fn,
      account: call.account,
    });

    let receipt: TransactionReceipt;
    try {
      receipt = await chain.waitForReceipt(txHash, this.receiptTimeoutMs);
    } catch (error) {
      await nonces.resync().catch((resyncError: unknown) => log.error('nonce resync failed', { error: resyncError }));
      if (error instanceof WaitForTransactionReceiptTimeoutError) {
        throw new TxTimeoutError(txHash, this.receiptTimeoutMs);
      }
      throw new SendError('RECEIPT_FAILED', `could not read the receipt of ${txHash}`, { cause: error });
    }
    return { txHash, receipt, nonce, gasLimit, maxFeePerGas: fees.maxFeePerGas };
  }
}
