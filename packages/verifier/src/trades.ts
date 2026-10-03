import { erc20Abi, type Address, type Hex, type Receipt } from '@sleeve/core';
import { decodeEventLog, encodeEventTopics } from 'viem';

import { uniswapV3SwapAbi } from './abi';
import type { RawLog } from './evidence';
import { decodeReceiptLog, isReceiptLog } from './receipt';

/**
 * The swaps behind a receipt, read from the logs of its transaction. A buy and a sell each run one exactInputSingle
 * on an allowlisted v3 pool (SPEC 11): the pool pays out first, takes its input in the router's callback, then logs
 * Swap, so a swap's two Transfer logs sit between the previous Swap or receipt log and its own Swap log. A
 * transaction can hold several actions, an owner batch or a bundle of UserOps, so nothing here sums over the whole
 * transaction.
 */

export const SWAP_TOPIC: Hex = encodeEventTopics({ abi: uniswapV3SwapAbi, eventName: 'Swap' })[0];
export const TRANSFER_TOPIC: Hex = encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer' })[0];

export interface SwapLog {
  pool: Address;
  recipient: Address;
  /** The pool's token0 delta: positive is what the pool received. */
  amount0: bigint;
  amount1: bigint;
  index: number;
  logIndex: number;
}

interface Transfer {
  token: Address;
  from: Address;
  to: Address;
  value: bigint;
}

function same(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** Hex length of n ABI words of data, with the 0x prefix. */
function words(n: number): number {
  return 2 + 64 * n;
}

/**
 * A Swap log in the v3 shape: two indexed addresses and five static words. Anything else carrying the topic is not a
 * v3 pool's Swap and is skipped. Static words always decode, so the shape check is the whole validation.
 */
function decodeSwap(log: RawLog, index: number): SwapLog | null {
  const [signature, sender, recipient] = log.topics;
  if (signature !== SWAP_TOPIC || sender === undefined || recipient === undefined || log.topics.length !== 3) return null;
  if (log.data.length !== words(5)) return null;
  const { args } = decodeEventLog({
    abi: uniswapV3SwapAbi,
    eventName: 'Swap',
    topics: [signature, sender, recipient],
    data: log.data,
  });
  return { pool: log.address, recipient: args.recipient, amount0: args.amount0, amount1: args.amount1, index, logIndex: log.logIndex };
}

/** An ERC-20 Transfer log: two indexed addresses and the value. */
function decodeTransfer(log: RawLog): Transfer | null {
  const [signature, from, to] = log.topics;
  if (signature !== TRANSFER_TOPIC || from === undefined || to === undefined || log.topics.length !== 3) return null;
  if (log.data.length !== words(1)) return null;
  const { args } = decodeEventLog({ abi: erc20Abi, eventName: 'Transfer', topics: [signature, from, to], data: log.data });
  return { token: log.address, from: args.from, to: args.to, value: args.value };
}

/** The index of the log in `logs` with this logIndex, or -1. */
export function indexOfLog(logs: readonly RawLog[], logIndex: number): number {
  return logs.findIndex((log) => log.logIndex === logIndex);
}

/** The first log index after the module's previous receipt log before `end`, or 0. */
function actionStart(logs: readonly RawLog[], end: number, module: Address): number {
  for (let i = end - 1; i >= 0; i -= 1) {
    const log = logs[i];
    if (log !== undefined && isReceiptLog(log, module)) return i + 1;
  }
  return 0;
}

/** The first log index after the previous Swap or module receipt log before `swapIndex`. */
function swapSegmentStart(logs: readonly RawLog[], swapIndex: number, module: Address): number {
  for (let i = swapIndex - 1; i >= 0; i -= 1) {
    const log = logs[i];
    if (log !== undefined && (log.topics[0] === SWAP_TOPIC || isReceiptLog(log, module))) return i + 1;
  }
  return 0;
}

function sumTransfers(
  logs: readonly RawLog[],
  start: number,
  end: number,
  token: Address,
  from: Address,
  to: Address,
): { total: bigint; count: number } {
  let total = 0n;
  let count = 0;
  for (let i = start; i < end; i += 1) {
    const log = logs[i];
    const transfer = log === undefined ? null : decodeTransfer(log);
    if (transfer === null) continue;
    if (same(transfer.token, token) && same(transfer.from, from) && same(transfer.to, to)) {
      total += transfer.value;
      count += 1;
    }
  }
  return { total, count };
}

export interface BuyFill {
  swap: SwapLog;
  /** USDG Transfer logs from the account to the pool in the swap's segment. */
  usdgSpent: bigint;
  /** Stock Token Transfer logs from the pool to the account in the swap's segment. */
  tokensOut: bigint;
  usdgTransfers: number;
  tokenTransfers: number;
}

/**
 * The buy a FILLED or SETTLED receipt records: the last Swap log paying the account between the module's previous
 * receipt log and this one, and the USDG and Stock Token Transfer logs of that swap.
 */
export function findBuyFill(
  logs: readonly RawLog[],
  receiptLogIndex: number,
  parties: { module: Address; account: Address; usdg: Address; token: Address },
): BuyFill | null {
  const end = indexOfLog(logs, receiptLogIndex);
  if (end < 0) return null;
  const start = actionStart(logs, end, parties.module);
  for (let i = end - 1; i >= start; i -= 1) {
    const log = logs[i];
    const swap = log === undefined ? null : decodeSwap(log, i);
    if (swap === null || !same(swap.recipient, parties.account)) continue;
    const segment = swapSegmentStart(logs, i, parties.module);
    const usdg = sumTransfers(logs, segment, i, parties.usdg, parties.account, swap.pool);
    const tokens = sumTransfers(logs, segment, i, parties.token, swap.pool, parties.account);
    return {
      swap,
      usdgSpent: usdg.total,
      tokensOut: tokens.total,
      usdgTransfers: usdg.count,
      tokenTransfers: tokens.count,
    };
  }
  return null;
}

/** Receipt fields every receipt of one sell shares (SPEC 13, D-027). */
export const WHOLE_SELL_FIELDS = [
  'execPrice',
  'premiumBps',
  'roundId',
  'answer',
  'updatedAt',
  'usdgRoundId',
  'usdgAnswer',
  'quote',
  'minOut',
  'pool',
  'overrideClosed',
  'overrideCapBps',
] as const satisfies readonly (keyof Receipt)[];

function sharesWholeSell(a: Receipt, b: Receipt): boolean {
  return WHOLE_SELL_FIELDS.every((field) => {
    const left = a[field];
    const right = b[field];
    return typeof left === 'string' && typeof right === 'string' ? same(left, right) : left === right;
  });
}

export interface SellRunEntry {
  logIndex: number;
  receipt: Receipt;
}

export interface SellRun {
  swap: SwapLog;
  /** The run, in log order. */
  entries: readonly SellRunEntry[];
  containsTarget: boolean;
  /** Sums over the run's receipts. */
  tokensIn: bigint;
  usdgOut: bigint;
  /** Stock Token Transfer logs from the account to the pool, and USDG Transfer logs from the pool to the account. */
  tokensTransferred: bigint;
  usdgTransferred: bigint;
  tokenTransfers: number;
  usdgTransfers: number;
}

function isSellReceipt(receipt: Receipt): boolean {
  return receipt.status === 'PART_SOLD' || receipt.status === 'SOLD';
}

function fitsRun(previous: Receipt, next: Receipt): boolean {
  return (
    isSellReceipt(next) &&
    next.id === previous.id + 1n &&
    same(next.account, previous.account) &&
    next.tickerId === previous.tickerId &&
    sharesWholeSell(previous, next)
  );
}

/**
 * SPEC 13's grouping of a sell's receipts: the run of consecutive PART_SOLD and SOLD receipts with sequential ids,
 * the same account and tickerId, written after one Swap log of the receipt's pool and sharing every whole-sell
 * field. The run starts at the first receipt log after the last Swap log of the target's pool before the target, and
 * ends at the first log that does not continue it.
 */
export function findSellRun(
  logs: readonly RawLog[],
  receiptLogIndex: number,
  target: Receipt,
  parties: { module: Address; usdg: Address },
): SellRun | null {
  const targetIndex = indexOfLog(logs, receiptLogIndex);
  if (targetIndex < 0) return null;
  let swap: SwapLog | null = null;
  for (let i = targetIndex - 1; i >= 0 && swap === null; i -= 1) {
    const log = logs[i];
    const candidate = log === undefined ? null : decodeSwap(log, i);
    if (candidate !== null && same(candidate.pool, target.pool)) swap = candidate;
  }
  if (swap === null) return null;

  const entries: SellRunEntry[] = [];
  for (let i = swap.index + 1; i < logs.length; i += 1) {
    const log = logs[i];
    if (log === undefined) break;
    if (!isReceiptLog(log, parties.module)) {
      if (entries.length === 0) continue;
      break;
    }
    const decoded = decodeReceiptLog(log);
    if (!decoded.ok) break;
    const receipt = decoded.value.receipt;
    const previous = entries[entries.length - 1];
    if (previous === undefined ? !isSellReceipt(receipt) : !fitsRun(previous.receipt, receipt)) break;
    entries.push({ logIndex: log.logIndex, receipt });
  }

  const segment = swapSegmentStart(logs, swap.index, parties.module);
  const first = entries[0]?.receipt;
  const account = first?.account ?? target.account;
  const token = first?.token ?? target.token;
  const tokens = sumTransfers(logs, segment, swap.index, token, account, swap.pool);
  const usdg = sumTransfers(logs, segment, swap.index, parties.usdg, swap.pool, account);
  return {
    swap,
    entries,
    containsTarget: entries.some((entry) => entry.logIndex === receiptLogIndex),
    tokensIn: entries.reduce((total, entry) => total + entry.receipt.tokensIn, 0n),
    usdgOut: entries.reduce((total, entry) => total + entry.receipt.usdgOut, 0n),
    tokensTransferred: tokens.total,
    usdgTransferred: usdg.total,
    tokenTransfers: tokens.count,
    usdgTransfers: usdg.count,
  };
}

/**
 * Each lot's share of a sell's proceeds as SleeveSell writes it: usdgOut * tokensIn / tokenAmount rounded down, with
 * the last lot taking what is left, so the shares sum to usdgOut.
 */
export function proRataShares(usdgOut: bigint, parts: readonly bigint[], tokenAmount: bigint): bigint[] {
  if (tokenAmount === 0n) return parts.map(() => 0n);
  let paid = 0n;
  return parts.map((part, index) => {
    const share = index === parts.length - 1 ? usdgOut - paid : (usdgOut * part) / tokenAmount;
    paid += share;
    return share;
  });
}

/**
 * The pool's deltas in USDG and Stock Token terms from its Swap log, given which of its two tokens is USDG: positive
 * is what the pool received.
 */
export function poolDeltas(swap: SwapLog, token0: Address, usdg: Address): { usdg: bigint; token: bigint } {
  return same(token0, usdg) ? { usdg: swap.amount0, token: swap.amount1 } : { usdg: swap.amount1, token: swap.amount0 };
}
