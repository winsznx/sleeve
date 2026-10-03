import type { Address, Hex } from '@sleeve/core';

import type { RawLog } from '../../src/evidence';
import type { BlockInfo, CallOutcome, ChainReader, ContractCall, LogFilter, TransactionInfo } from '../../src/reader';

/**
 * An in-memory chain behind the ChainReader interface: logs filtered as eth_getLogs filters them, eth_calls answered
 * by exact calldata, and an optional range limit per filter shape with the public RPC's own refusal text, so the
 * gathering logic and the log scanner run without a network.
 */
export class FakeChain implements ChainReader {
  readonly url = 'https://fake.rpc.test';
  chain = 4663;
  latest: BlockInfo;
  readonly blocks = new Map<bigint, bigint>();
  readonly transactions = new Map<Hex, TransactionInfo>();
  logs: RawLog[] = [];
  /** Widest eth_getLogs range per filter shape, as the public RPC allows: one value per position, or lists. */
  limits: { single: bigint; multi: bigint } | null = null;
  /** Every getLogs range asked for, and every callMany batch size, in order. */
  readonly getLogsCalls: { filter: LogFilter; from: bigint; to: bigint; refused: boolean }[] = [];
  readonly callBatches: number[] = [];
  private readonly replies = new Map<string, CallOutcome>();

  constructor(latest: BlockInfo) {
    this.latest = latest;
  }

  reply(to: Address, data: Hex, returnData: Hex): void {
    this.replies.set(`${to.toLowerCase()}:${data.toLowerCase()}`, { ok: true, data: returnData });
  }

  revert(to: Address, data: Hex, error = 'reverted without data'): void {
    this.replies.set(`${to.toLowerCase()}:${data.toLowerCase()}`, { ok: false, error });
  }

  async chainId(): Promise<number> {
    return this.chain;
  }

  async latestBlock(): Promise<BlockInfo> {
    return this.latest;
  }

  async block(number: bigint): Promise<BlockInfo> {
    const timestamp = this.blocks.get(number);
    if (timestamp === undefined) throw new Error(`no block ${number} in the fake chain`);
    return { number, timestamp };
  }

  async transaction(hash: Hex): Promise<TransactionInfo> {
    const transaction = this.transactions.get(hash);
    if (transaction === undefined) throw new Error(`no transaction ${hash} in the fake chain`);
    return transaction;
  }

  async getLogs(filter: LogFilter, fromBlock: bigint, toBlock: bigint): Promise<RawLog[]> {
    const multi = typeof filter.address !== 'string' || filter.topics.some((topic) => topic !== null && typeof topic !== 'string');
    const limit = this.limits === null ? null : multi ? this.limits.multi : this.limits.single;
    const span = toBlock - fromBlock + 1n;
    const refused = limit !== null && span > limit;
    this.getLogsCalls.push({ filter, from: fromBlock, to: toBlock, refused });
    if (refused) {
      throw new Error(`query spans ${span} blocks (${fromBlock} to ${toBlock}), but only ${limit} are allowed for this request; narrow the block range`);
    }
    const addresses = (typeof filter.address === 'string' ? [filter.address] : [...filter.address]).map((address) => address.toLowerCase());
    return this.logs.filter((log) => {
      if (log.blockNumber < fromBlock || log.blockNumber > toBlock) return false;
      if (!addresses.includes(log.address.toLowerCase())) return false;
      return filter.topics.every((wanted, position) => {
        if (wanted === null) return true;
        const topic = log.topics[position]?.toLowerCase();
        if (topic === undefined) return false;
        return typeof wanted === 'string' ? wanted.toLowerCase() === topic : wanted.some((option) => option.toLowerCase() === topic);
      });
    });
  }

  async callMany(calls: readonly ContractCall[]): Promise<CallOutcome[]> {
    this.callBatches.push(calls.length);
    return calls.map((call) => this.replies.get(`${call.to.toLowerCase()}:${call.data.toLowerCase()}`) ?? { ok: false, error: `no reply for ${call.to} ${call.data.slice(0, 10)}` });
  }

  /** Adds a transaction's logs to the chain and serves it by hash. */
  addTransaction(hash: Hex, from: Address, to: Address | null, logs: readonly RawLog[]): void {
    this.transactions.set(hash, { hash, from, to, logs: [...logs] });
    this.logs.push(...logs);
  }
}
