import { type Address, type Hex, sleeveModuleAbi } from '@sleeve/core';
import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  type Log,
  type TransactionReceipt,
  encodeErrorResult,
  keccak256,
  stringToHex,
  zeroAddress,
} from 'viem';

import type { KeeperCall } from '../../src/chain/calls';
import type {
  BlockRef,
  BucketState,
  ChainGateway,
  FeedRound,
  HeadBlock,
  LedgerState,
  LotState,
  SettlePreview,
  SplitPreview,
  TickerState,
  TxRequest,
} from '../../src/chain/gateway';
import { KERNEL_PROXY_RUNTIME, KERNEL_V31_IMPLEMENTATION } from '../../src/chain/kernel';

/** A module revert the way viem reports it from eth_call. */
export function revert(errorName: string, args: readonly unknown[] = []): Error {
  const data = encodeErrorResult({ abi: sleeveModuleAbi, errorName, args } as Parameters<typeof encodeErrorResult>[0]);
  const cause = new ContractFunctionRevertedError({ abi: sleeveModuleAbi, data, functionName: 'split' });
  return new ContractFunctionExecutionError(cause, {
    abi: sleeveModuleAbi,
    functionName: 'split',
    args: [zeroAddress, zeroAddress, 0n],
  });
}

export function blockHash(number: bigint): Hex {
  return keccak256(stringToHex(`block:${number}`));
}

export const idleSplitPreview: SplitPreview = {
  ruleStatus: 'ACTIVE',
  tickerId: 0,
  shortfall: 0n,
  unsorted: 0n,
  spendPart: 0n,
  equityPart: 0n,
  status: 'FILLED',
  reason: 'NONE',
  buy: false,
  publicReadyAt: 0n,
};

export interface FakeAccount {
  keeper: Address;
  listed: boolean;
  bracketOpen: boolean;
  code: Hex | undefined;
  implementation: Address | null;
  preview: SplitPreview;
  ledger: LedgerState;
  buckets: Map<number, BucketState>;
  settlePreviews: Map<number, SettlePreview>;
}

export function fakeAccount(keeper: Address, overrides: Partial<FakeAccount> = {}): FakeAccount {
  return {
    keeper,
    listed: true,
    bracketOpen: false,
    code: KERNEL_PROXY_RUNTIME,
    implementation: KERNEL_V31_IMPLEMENTATION,
    preview: idleSplitPreview,
    ledger: { balance: 0n, spend: 0n, pendingTotal: 0n, unsorted: 0n },
    buckets: new Map(),
    settlePreviews: new Map(),
    ...overrides,
  };
}

/**
 * A chain held in memory for unit tests. Fields are set by the test; a read the test did not prepare throws, so a
 * test never passes on a default it did not choose.
 */
export class FakeChain implements ChainGateway {
  head_: HeadBlock = { number: 1_000n, hash: blockHash(1_000n), timestamp: 1_791_158_460n, baseFeePerGas: 20_000_000n };
  blockTimes = new Map<bigint, bigint>();
  blockHashes = new Map<bigint, Hex>();
  logs: Log[] = [];
  txLogs = new Map<Hex, Log[]>();
  accounts = new Map<Address, FakeAccount>();
  lots = new Map<bigint, LotState>();
  receiptHashes = new Map<bigint, Hex>();
  tickers: TickerState[] = [];
  pools = new Map<number, Address[]>();
  fees = new Map<Address, number>();
  decimalsOf = new Map<Address, number>();
  rounds = new Map<Address, FeedRound>();
  /** amountOut per pool, or an error to throw. */
  quotes = new Map<Address, bigint | Error>();
  coverageEnd = 1_830_315_600n;
  keeperBalance = 10n ** 18n;
  nonce = 0;
  simulateCall: (call: KeeperCall) => bigint = () => {
    throw new Error('simulate not prepared');
  };
  gasEstimate = 300_000n;
  sent: Hex[] = [];
  mined: (hash: Hex) => TransactionReceipt = () => {
    throw new Error('no receipt prepared');
  };
  calls: string[] = [];

  private account(address: Address): FakeAccount {
    const found = this.accounts.get(address.toLowerCase() as Address);
    if (found === undefined) throw new Error(`no fake account ${address}`);
    return found;
  }

  async head(): Promise<HeadBlock> {
    this.calls.push('head');
    return this.head_;
  }

  async block(number: bigint): Promise<BlockRef> {
    return {
      number,
      hash: this.blockHashes.get(number) ?? blockHash(number),
      timestamp: this.blockTimes.get(number) ?? 1_791_000_000n + number,
    };
  }

  async moduleLogs(fromBlock: bigint, toBlock: bigint): Promise<Log[]> {
    this.calls.push(`moduleLogs:${fromBlock}-${toBlock}`);
    return this.logs.filter(
      (log) =>
        log.address.toLowerCase() !== '0x5fc5360d0400a0fd4f2af552add042d716f1d168' &&
        log.blockNumber !== null &&
        log.blockNumber >= fromBlock &&
        log.blockNumber <= toBlock,
    );
  }

  async transferLogs(fromBlock: bigint, toBlock: bigint, recipients: readonly Address[]): Promise<Log[]> {
    this.calls.push(`transferLogs:${fromBlock}-${toBlock}:${recipients.length}`);
    const wanted = new Set(recipients.map((recipient) => recipient.toLowerCase()));
    return this.logs.filter((log) => {
      if (log.address.toLowerCase() !== '0x5fc5360d0400a0fd4f2af552add042d716f1d168') return false;
      if (log.blockNumber === null || log.blockNumber < fromBlock || log.blockNumber > toBlock) return false;
      const to = log.topics[2];
      return to !== undefined && wanted.has(`0x${to.slice(26)}`);
    });
  }

  async transactionLogs(txHash: Hex): Promise<Log[]> {
    return this.txLogs.get(txHash) ?? this.logs.filter((log) => log.transactionHash === txHash);
  }

  async keeperOf(account: Address): Promise<Address> {
    return this.account(account).keeper.toLowerCase() as Address;
  }

  async isModuleListed(account: Address): Promise<boolean> {
    return this.account(account).listed;
  }

  async ownerOpOpen(account: Address): Promise<boolean> {
    return this.account(account).bracketOpen;
  }

  async code(account: Address): Promise<Hex | undefined> {
    return this.account(account).code;
  }

  async implementationOf(account: Address): Promise<Address | null> {
    return this.account(account).implementation;
  }

  async previewSplit(account: Address): Promise<SplitPreview> {
    this.calls.push(`previewSplit:${account}`);
    return this.account(account).preview;
  }

  async previewSettle(account: Address, tickerId: number): Promise<SettlePreview> {
    this.calls.push(`previewSettle:${account}:${tickerId}`);
    const preview = this.account(account).settlePreviews.get(tickerId);
    if (preview === undefined) throw new Error(`no settle preview for ${account} ticker ${tickerId}`);
    return preview;
  }

  async ledger(account: Address): Promise<LedgerState> {
    return this.account(account).ledger;
  }

  async bucketOf(account: Address, tickerId: number): Promise<BucketState> {
    return this.account(account).buckets.get(tickerId) ?? { amount: 0n, since: 0n, reason: 'NONE' };
  }

  async lot(lotId: bigint): Promise<LotState> {
    const lot = this.lots.get(lotId);
    if (lot === undefined) throw new Error(`no lot ${lotId}`);
    return lot;
  }

  async receiptHash(id: bigint): Promise<Hex> {
    const hash = this.receiptHashes.get(id);
    if (hash === undefined) throw new Error(`no receipt hash ${id}`);
    return hash;
  }

  async tickerCount(): Promise<number> {
    return this.tickers.length;
  }

  async ticker(id: number): Promise<TickerState> {
    const ticker = this.tickers[id];
    if (ticker === undefined) throw new Error(`no ticker ${id}`);
    return ticker;
  }

  async poolsOf(id: number): Promise<Address[]> {
    this.calls.push(`poolsOf:${id}`);
    return this.pools.get(id) ?? [];
  }

  async poolFee(pool: Address): Promise<number> {
    return this.fees.get(pool) ?? 500;
  }

  async decimals(contract: Address): Promise<number> {
    const decimals = this.decimalsOf.get(contract.toLowerCase() as Address);
    if (decimals !== undefined) return decimals;
    const isFeed = this.tickers.some((ticker) => ticker.feed === contract.toLowerCase());
    if (isFeed || contract.toLowerCase() === '0x61b7e5650328764b076a108eff5fa7282a1b9ad2') return 8;
    if (contract.toLowerCase() === '0x5fc5360d0400a0fd4f2af552add042d716f1d168') return 6;
    return 18;
  }

  async latestRound(feed: Address): Promise<FeedRound> {
    return this.rounds.get(feed.toLowerCase() as Address) ?? { roundId: 1n, answer: 100_000_000n, startedAt: 1n, updatedAt: 1n };
  }

  async quoteBuy(_token: Address, fee: number, amountIn: bigint): Promise<bigint> {
    for (const [pool, quote] of this.quotes) {
      if ((this.fees.get(pool) ?? 500) !== fee) continue;
      if (quote instanceof Error) throw quote;
      return (quote * amountIn) / 1_000_000n;
    }
    throw new Error('no quote prepared');
  }

  async calendarCoverageEnd(): Promise<bigint> {
    return this.coverageEnd;
  }

  async simulate(call: KeeperCall): Promise<bigint> {
    this.calls.push(`simulate:${call.fn}:${call.pool}:${call.quote}`);
    return this.simulateCall(call);
  }

  async estimateGas(_request: TxRequest): Promise<bigint> {
    return this.gasEstimate;
  }

  async balance(): Promise<bigint> {
    return this.keeperBalance;
  }

  async pendingNonce(): Promise<number> {
    return this.nonce;
  }

  async sendRawTransaction(serialized: Hex): Promise<Hex> {
    this.sent.push(serialized);
    return keccak256(serialized);
  }

  async waitForReceipt(hash: Hex): Promise<TransactionReceipt> {
    return this.mined(hash);
  }
}
