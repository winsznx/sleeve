import {
  ADDRESSES,
  DEPLOYMENT_4663,
  REASONS,
  RULE_STATUSES,
  type Reason,
  type RuleStatus,
  SESSION_TYPES,
  STATUSES,
  type SessionType,
  type Status,
  aggregatorV3Abi,
  enumMember,
  erc20Abi,
  quoterV2Abi,
  sessionCalendarExtensionAbi,
  sleeveModuleAbi,
  tokenSourceAbi,
  uniswapV3PoolAbi,
} from '@sleeve/core';
import type { Address, Hex, Log, PublicClient, TransactionReceipt } from 'viem';

import { type KeeperCall, MODULE_ADDRESS } from './calls';
import { TRANSFER_EVENT, lower } from './events';
import { ERC1967_IMPLEMENTATION_SLOT, MODULE_TYPE_EXECUTOR, implementationFromSlot, kernelAbi } from './kernel';

export interface HeadBlock {
  number: bigint;
  hash: Hex;
  timestamp: bigint;
  baseFeePerGas: bigint;
}

export interface BlockRef {
  number: bigint;
  hash: Hex;
  timestamp: bigint;
}

/** SleeveModule.previewSplit (SPEC 15). */
export interface SplitPreview {
  ruleStatus: RuleStatus;
  tickerId: number;
  shortfall: bigint;
  unsorted: bigint;
  spendPart: bigint;
  equityPart: bigint;
  status: Status;
  reason: Reason;
  buy: boolean;
  publicReadyAt: bigint;
}

/** SleeveModule.previewSettle (SPEC 15). */
export interface SettlePreview {
  ruleStatus: RuleStatus;
  amount: bigint;
  since: bigint;
  bucketReason: Reason;
  minClip: bigint;
  status: Status;
  reason: Reason;
  buy: boolean;
  publicReadyAt: bigint;
  shortfall: bigint;
}

export interface LedgerState {
  balance: bigint;
  spend: bigint;
  pendingTotal: bigint;
  unsorted: bigint;
}

export interface BucketState {
  amount: bigint;
  since: bigint;
  reason: Reason;
}

export interface LotState {
  account: Address;
  tickerId: number;
  status: Status;
  tokensBought: bigint;
  tokensRemaining: bigint;
}

export interface TickerState {
  id: number;
  token: Address;
  feed: Address;
  sessionType: SessionType;
  active: boolean;
}

export interface FeedRound {
  roundId: bigint;
  answer: bigint;
  startedAt: bigint;
  updatedAt: bigint;
}

export interface TxRequest {
  to: Address;
  data: Hex;
}

/**
 * Every chain read and write the keeper makes, behind one interface so the decision code can be tested against a
 * fake chain. The viem implementation below is the only one that talks to an RPC.
 */
export interface ChainGateway {
  head(): Promise<HeadBlock>;
  block(number: bigint): Promise<BlockRef>;
  moduleLogs(fromBlock: bigint, toBlock: bigint): Promise<Log[]>;
  transferLogs(fromBlock: bigint, toBlock: bigint, recipients: readonly Address[]): Promise<Log[]>;
  transactionLogs(txHash: Hex): Promise<Log[]>;

  keeperOf(account: Address): Promise<Address>;
  isModuleListed(account: Address): Promise<boolean>;
  ownerOpOpen(account: Address): Promise<boolean>;
  code(account: Address): Promise<Hex | undefined>;
  implementationOf(account: Address): Promise<Address | null>;
  previewSplit(account: Address): Promise<SplitPreview>;
  previewSettle(account: Address, tickerId: number): Promise<SettlePreview>;
  ledger(account: Address, blockNumber?: bigint): Promise<LedgerState>;
  bucketOf(account: Address, tickerId: number, blockNumber?: bigint): Promise<BucketState>;
  lot(lotId: bigint): Promise<LotState>;
  receiptHash(id: bigint): Promise<Hex>;

  tickerCount(): Promise<number>;
  ticker(id: number): Promise<TickerState>;
  poolsOf(id: number): Promise<Address[]>;
  poolFee(pool: Address): Promise<number>;
  decimals(contract: Address): Promise<number>;
  latestRound(feed: Address): Promise<FeedRound>;
  /** QuoterV2's amountOut for amountIn USDG into token through the fee tier. */
  quoteBuy(token: Address, fee: number, amountIn: bigint): Promise<bigint>;
  calendarCoverageEnd(): Promise<bigint>;

  /** The call as an eth_call from `from`: the receipt id it would write. Throws the revert. */
  simulate(call: KeeperCall, from: Address): Promise<bigint>;
  estimateGas(request: TxRequest, from: Address): Promise<bigint>;
  balance(address: Address): Promise<bigint>;
  pendingNonce(address: Address): Promise<number>;
  sendRawTransaction(serialized: Hex): Promise<Hex>;
  waitForReceipt(hash: Hex, timeoutMs: number): Promise<TransactionReceipt>;
}

const MODULE = MODULE_ADDRESS;
const TOKEN_SOURCE: Address = DEPLOYMENT_4663.contracts.TokenSource.address;
const CALENDAR: Address = DEPLOYMENT_4663.contracts.SessionCalendarExtension.address;
const USDG: Address = ADDRESSES.USDG;
const QUOTER: Address = ADDRESSES.QUOTER_V2;

export function viemGateway(client: PublicClient): ChainGateway {
  const read = client.readContract.bind(client);

  return {
    async head() {
      const block = await client.getBlock({ blockTag: 'latest' });
      if (block.number === null || block.hash === null) throw new Error('the latest block has no number or hash');
      return {
        number: block.number,
        hash: lower(block.hash),
        timestamp: block.timestamp,
        baseFeePerGas: block.baseFeePerGas ?? 0n,
      };
    },

    async block(number) {
      const block = await client.getBlock({ blockNumber: number });
      if (block.hash === null) throw new Error(`block ${number} has no hash`);
      return { number, hash: lower(block.hash), timestamp: block.timestamp };
    },

    moduleLogs: (fromBlock, toBlock) => client.getLogs({ address: MODULE, fromBlock, toBlock }),

    async transferLogs(fromBlock, toBlock, recipients) {
      // Awaited before returning: a contextual Promise<Log[]> return type would erase the event's argument types.
      const logs = await client.getLogs({
        address: USDG,
        event: TRANSFER_EVENT,
        args: { to: [...recipients] },
        fromBlock,
        toBlock,
      });
      return logs;
    },

    async transactionLogs(txHash) {
      const receipt = await client.getTransactionReceipt({ hash: txHash });
      return receipt.logs;
    },

    keeperOf: async (account) =>
      lower(await read({ address: MODULE, abi: sleeveModuleAbi, functionName: 'keeperOf', args: [account] })),

    isModuleListed: (account) =>
      read({
        address: account,
        abi: kernelAbi,
        functionName: 'isModuleInstalled',
        args: [MODULE_TYPE_EXECUTOR, MODULE, '0x'],
      }),

    ownerOpOpen: (account) =>
      read({ address: MODULE, abi: sleeveModuleAbi, functionName: 'ownerOpOpen', args: [account] }),

    code: (account) => client.getCode({ address: account }),

    implementationOf: async (account) =>
      implementationFromSlot(await client.getStorageAt({ address: account, slot: ERC1967_IMPLEMENTATION_SLOT })),

    async previewSplit(account) {
      const p = await read({ address: MODULE, abi: sleeveModuleAbi, functionName: 'previewSplit', args: [account] });
      return {
        ruleStatus: enumMember(RULE_STATUSES, p.ruleStatus),
        tickerId: p.tickerId,
        shortfall: p.shortfall,
        unsorted: p.unsorted,
        spendPart: p.spendPart,
        equityPart: p.equityPart,
        status: enumMember(STATUSES, p.status),
        reason: enumMember(REASONS, p.reason),
        buy: p.buy,
        publicReadyAt: p.publicReadyAt,
      };
    },

    async previewSettle(account, tickerId) {
      const p = await read({
        address: MODULE,
        abi: sleeveModuleAbi,
        functionName: 'previewSettle',
        args: [account, tickerId],
      });
      return {
        ruleStatus: enumMember(RULE_STATUSES, p.ruleStatus),
        amount: p.amount,
        since: p.since,
        bucketReason: enumMember(REASONS, p.bucketReason),
        minClip: p.minClip,
        status: enumMember(STATUSES, p.status),
        reason: enumMember(REASONS, p.reason),
        buy: p.buy,
        publicReadyAt: p.publicReadyAt,
        shortfall: p.shortfall,
      };
    },

    async ledger(account, blockNumber) {
      const [balance, spend, pendingTotal, unsorted] = await read({
        address: MODULE,
        abi: sleeveModuleAbi,
        functionName: 'ledger',
        args: [account],
        blockNumber,
      });
      return { balance, spend, pendingTotal, unsorted };
    },

    async bucketOf(account, tickerId, blockNumber) {
      const bucket = await read({
        address: MODULE,
        abi: sleeveModuleAbi,
        functionName: 'bucketOf',
        args: [account, tickerId],
        blockNumber,
      });
      return { amount: bucket.amount, since: bucket.since, reason: enumMember(REASONS, bucket.reason) };
    },

    async lot(lotId) {
      const lot = await read({ address: MODULE, abi: sleeveModuleAbi, functionName: 'lot', args: [lotId] });
      return {
        account: lower(lot.account),
        tickerId: lot.tickerId,
        status: enumMember(STATUSES, lot.status),
        tokensBought: lot.tokensBought,
        tokensRemaining: lot.tokensRemaining,
      };
    },

    receiptHash: async (id) =>
      lower(await read({ address: MODULE, abi: sleeveModuleAbi, functionName: 'receiptHash', args: [id] })),

    tickerCount: async () =>
      Number(await read({ address: TOKEN_SOURCE, abi: tokenSourceAbi, functionName: 'tickerCount' })),

    async ticker(id) {
      const [token, feed, sessionType, active] = await read({
        address: TOKEN_SOURCE,
        abi: tokenSourceAbi,
        functionName: 'ticker',
        args: [id],
      });
      return {
        id,
        token: lower(token),
        feed: lower(feed),
        sessionType: enumMember(SESSION_TYPES, sessionType),
        active,
      };
    },

    poolsOf: async (id) =>
      (await read({ address: TOKEN_SOURCE, abi: tokenSourceAbi, functionName: 'poolsOf', args: [id] })).map(lower),

    poolFee: (pool) => read({ address: pool, abi: uniswapV3PoolAbi, functionName: 'fee' }),

    decimals: (contract) => read({ address: contract, abi: erc20Abi, functionName: 'decimals' }),

    async latestRound(feed) {
      const [roundId, answer, startedAt, updatedAt] = await read({
        address: feed,
        abi: aggregatorV3Abi,
        functionName: 'latestRoundData',
      });
      return { roundId, answer, startedAt, updatedAt };
    },

    async quoteBuy(token, fee, amountIn) {
      const { result } = await client.simulateContract({
        address: QUOTER,
        abi: quoterV2Abi,
        functionName: 'quoteExactInputSingle',
        args: [{ tokenIn: USDG, tokenOut: token, amountIn, fee, sqrtPriceLimitX96: 0n }],
      });
      return result[0];
    },

    calendarCoverageEnd: () =>
      read({ address: CALENDAR, abi: sessionCalendarExtensionAbi, functionName: 'coverageEnd' }),

    async simulate(call, from) {
      if (call.fn === 'split') {
        const { result } = await client.simulateContract({
          address: MODULE,
          abi: sleeveModuleAbi,
          functionName: 'split',
          args: [call.account, call.pool, call.quote],
          account: from,
        });
        return result;
      }
      const { result } = await client.simulateContract({
        address: MODULE,
        abi: sleeveModuleAbi,
        functionName: 'settle',
        args: [call.account, call.tickerId, call.pool, call.quote],
        account: from,
      });
      return result;
    },

    estimateGas: (request, from) => client.estimateGas({ account: from, to: request.to, data: request.data }),

    balance: (address) => client.getBalance({ address }),

    pendingNonce: (address) => client.getTransactionCount({ address, blockTag: 'pending' }),

    sendRawTransaction: (serialized) => client.sendRawTransaction({ serializedTransaction: serialized }),

    waitForReceipt: (hash, timeoutMs) =>
      client.waitForTransactionReceipt({ hash, timeout: timeoutMs, pollingInterval: 500, retryCount: 3 }),
  };
}
