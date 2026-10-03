import type { Address, Hex } from '@sleeve/core';
import { hexToBigInt, hexToNumber, multicall3Abi, numberToHex, type PublicClient } from 'viem';
import { robinhood } from 'viem/chains';

import type { RawLog } from './evidence';

/**
 * The chain reads the verifier makes, behind one small interface so the gathering logic can run against a fake chain
 * in tests and against any viem client in the CLI and the app.
 */

export interface LogFilter {
  address: Address | readonly Address[];
  /** Positional topics: a value, a list of alternatives, or null for any. */
  topics: readonly (Hex | readonly Hex[] | null)[];
}

export interface ContractCall {
  to: Address;
  data: Hex;
}

export type CallOutcome = { ok: true; data: Hex } | { ok: false; error: string };

export interface BlockInfo {
  number: bigint;
  timestamp: bigint;
}

export interface TransactionInfo {
  hash: Hex;
  from: Address;
  to: Address | null;
  /** Every log of the transaction, in order. */
  logs: RawLog[];
}

export interface ChainReader {
  readonly url: string;
  chainId(): Promise<number>;
  latestBlock(): Promise<BlockInfo>;
  block(number: bigint): Promise<BlockInfo>;
  transaction(hash: Hex): Promise<TransactionInfo>;
  /** One eth_getLogs over [fromBlock, toBlock]. Range limits are the caller's to handle (logs.ts). */
  getLogs(filter: LogFilter, fromBlock: bigint, toBlock: bigint): Promise<RawLog[]>;
  /** eth_calls at one block. A call that reverts comes back as a failure; the batch itself does not. */
  callMany(calls: readonly ContractCall[], blockNumber: bigint): Promise<CallOutcome[]>;
}

/** Multicall3 at its canonical address, which viem lists for Robinhood Chain. */
export const MULTICALL3: Address = robinhood.contracts.multicall3.address;

const CALLS_PER_BATCH = 64;

interface RpcLog {
  address: Address;
  topics: readonly Hex[];
  data: Hex;
  blockNumber: Hex | null;
  logIndex: Hex | null;
  transactionHash: Hex | null;
}

function fromRpcLog(log: RpcLog): RawLog {
  if (log.blockNumber === null || log.logIndex === null || log.transactionHash === null) {
    throw new RangeError('eth_getLogs returned a pending log for a mined range');
  }
  return {
    address: log.address,
    topics: log.topics,
    data: log.data,
    blockNumber: hexToBigInt(log.blockNumber),
    logIndex: hexToNumber(log.logIndex),
    transactionHash: log.transactionHash,
  };
}

/** A reader over a viem public client. Pair it with throttledHttp for the public RPC (D-012). */
export function viemReader(client: PublicClient, url: string): ChainReader {
  return {
    url,
    chainId: () => client.getChainId(),
    async latestBlock() {
      const block = await client.getBlock({ blockTag: 'latest' });
      return { number: block.number, timestamp: block.timestamp };
    },
    async block(number) {
      const block = await client.getBlock({ blockNumber: number });
      return { number: block.number, timestamp: block.timestamp };
    },
    async transaction(hash) {
      const receipt = await client.getTransactionReceipt({ hash });
      return {
        hash,
        from: receipt.from,
        to: receipt.to,
        logs: receipt.logs.map((log) => ({
          address: log.address,
          topics: log.topics,
          data: log.data,
          blockNumber: log.blockNumber,
          logIndex: log.logIndex,
          transactionHash: log.transactionHash,
        })),
      };
    },
    async getLogs(filter, fromBlock, toBlock) {
      const address = typeof filter.address === 'string' ? filter.address : [...filter.address];
      const topics = filter.topics.map((topic) => (topic === null || typeof topic === 'string' ? topic : [...topic]));
      const logs = await client.request({
        method: 'eth_getLogs',
        params: [{ address, topics, fromBlock: numberToHex(fromBlock), toBlock: numberToHex(toBlock) }],
      });
      return logs.map(fromRpcLog);
    },
    async callMany(calls, blockNumber) {
      const outcomes: CallOutcome[] = [];
      for (let start = 0; start < calls.length; start += CALLS_PER_BATCH) {
        const batch = calls.slice(start, start + CALLS_PER_BATCH);
        const results = await client.readContract({
          address: MULTICALL3,
          abi: multicall3Abi,
          functionName: 'aggregate3',
          args: [batch.map((call) => ({ target: call.to, allowFailure: true, callData: call.data }))],
          blockNumber,
        });
        for (const result of results) {
          outcomes.push(
            result.success
              ? { ok: true, data: result.returnData }
              : { ok: false, error: result.returnData === '0x' ? 'reverted without data' : `reverted with ${result.returnData}` },
          );
        }
      }
      return outcomes;
    },
  };
}
