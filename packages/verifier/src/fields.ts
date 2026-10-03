import {
  RECEIPT_FIELDS,
  discountBps,
  execPriceBuy,
  execPriceSell,
  minOutForBuy,
  minOutForSell,
  premiumBps,
  PriceMathError,
  type Receipt,
} from '@sleeve/core';

import { stockRound, usdgRound, type Context } from './context';
import { replayGuard } from './guard';
import { isBuyKind, isSplitKind, type ReceiptKind } from './receipt';
import { ZERO_ADDRESS, fieldRow, fieldText, text, zeroOf, type Scalar } from './rows';
import { splitShares } from './shares';
import { proRataShares } from './trades';
import type { FieldRow, ValueUnit } from './types';

/**
 * One row per Receipt field, in SPEC 13 order. Each field is recomputed from a source other than the receipt where
 * one exists: the log's indexed topics, the transaction's Transfer and Swap logs, getRoundData, the rule's RuleSet
 * log, TokenSource, the token, the calendar, the block. A field SPEC 13 leaves zero for the receipt's kind must be
 * zero. A field nothing else records, such as the trigger's quote, is shown as the value the stored hash commits to,
 * which holds only while the stored hash matches.
 */

type Recompute =
  | { kind: 'value'; value: Scalar; source: string }
  | { kind: 'committed' }
  | { kind: 'unread'; reason: string; source: string };

const COMMITTED: Recompute = { kind: 'committed' };

function value(v: Scalar, source: string): Recompute {
  return { kind: 'value', value: v, source };
}

function unread(reason: string, source: string): Recompute {
  return { kind: 'unread', reason, source };
}

const KIND_NAMES: Record<ReceiptKind, string> = {
  SPLIT_FILL: 'split that filled',
  SPLIT_QUEUE: 'split that queued',
  SPLIT_REFUSAL: 'split refusal',
  SETTLE_FILL: 'settle',
  SETTLE_REFUSAL: 'settle refusal',
  RELEASE: 'release',
  SELL: 'sell',
  LEDGER_RECONCILE: 'ledger reconcile',
  LOT_RECONCILE: 'lot reconcile',
};

const ROUNDS = ['roundId', 'answer', 'updatedAt'] as const;
const USDG_ROUNDS = ['usdgRoundId', 'usdgAnswer'] as const;
const SWAP_FIELDS = ['quote', 'minOut', 'venueId', 'pool', 'premiumBps'] as const;
const NO_MARKET = [...ROUNDS, ...USDG_ROUNDS, ...SWAP_FIELDS, 'execPrice', 'uiMultiplier', 'tokenUid'] as const;
const NO_OVERRIDE = ['overrideClosed', 'overrideCapBps'] as const;

/** The fields SPEC 13 leaves zero for each kind, from what each writer in contracts/src/libraries sets. */
const ZERO_FIELDS: Record<ReceiptKind, readonly (keyof Receipt)[]> = {
  SPLIT_FILL: ['payer', 'reason', 'usdgQueued', 'tokensIn', 'usdgOut', 'queuedSince', ...NO_OVERRIDE],
  SPLIT_QUEUE: [
    'payer',
    'tokenUid',
    'usdgSpent',
    'tokensIn',
    'tokensOut',
    'usdgOut',
    'uiMultiplier',
    'execPrice',
    'lotId',
    'queuedSince',
    ...NO_OVERRIDE,
  ],
  SPLIT_REFUSAL: ['payer', 'reason', 'usdgSpent', 'usdgQueued', 'tokensIn', 'tokensOut', 'usdgOut', 'lotId', 'queuedSince', ...NO_MARKET, ...NO_OVERRIDE],
  SETTLE_FILL: ['payer', 'usdgIn', 'usdgToSpend', 'usdgQueued', 'tokensIn', 'usdgOut', ...NO_OVERRIDE],
  SETTLE_REFUSAL: ['payer', 'reason', 'usdgIn', 'usdgSpent', 'usdgQueued', 'tokensIn', 'tokensOut', 'usdgOut', 'lotId', ...NO_MARKET, ...NO_OVERRIDE],
  RELEASE: ['payer', 'usdgIn', 'usdgToEquity', 'usdgSpent', 'usdgQueued', 'tokensIn', 'tokensOut', 'usdgOut', 'lotId', ...NO_MARKET, ...NO_OVERRIDE],
  SELL: ['payer', 'reason', 'usdgIn', 'usdgToEquity', 'usdgSpent', 'usdgQueued', 'tokensOut', 'queuedSince'],
  LEDGER_RECONCILE: [
    'payer',
    'reason',
    'tickerId',
    'token',
    'usdgToSpend',
    'usdgToEquity',
    'tokensIn',
    'tokensOut',
    'usdgOut',
    'lotId',
    'queuedSince',
    ...NO_MARKET,
    ...NO_OVERRIDE,
  ],
  LOT_RECONCILE: [
    'payer',
    'reason',
    'usdgIn',
    'usdgToSpend',
    'usdgToEquity',
    'usdgSpent',
    'usdgQueued',
    'tokensOut',
    'usdgOut',
    'queuedSince',
    ...NO_MARKET,
    ...NO_OVERRIDE,
  ],
};

/**
 * A QUEUED receipt's rounds and swap fields depend on how far the guard got: no round before STALE, the stock round
 * from STALE on, the USDG/USD round from DEPEG on, and the swap fields only for PREMIUM, whose swap ran and was
 * undone. A zero equity part runs no guard at all (SPEC 9 step 4).
 */
function queuedZeroFields(r: Receipt): readonly (keyof Receipt)[] {
  const zero: (keyof Receipt)[] = [];
  const guardRan = r.usdgToEquity > 0n;
  const readStock = guardRan && ['STALE', 'DEPEG', 'CLIP', 'PREMIUM'].includes(r.reason);
  const readUsdg = guardRan && ['DEPEG', 'CLIP', 'PREMIUM'].includes(r.reason);
  if (!readStock) zero.push(...ROUNDS);
  if (!readUsdg) zero.push(...USDG_ROUNDS);
  if (r.reason !== 'PREMIUM') zero.push(...SWAP_FIELDS);
  return zero;
}

function mustBeZero(ctx: Context, field: keyof Receipt): boolean {
  if (ZERO_FIELDS[ctx.kind].includes(field)) return true;
  return ctx.kind === 'SPLIT_QUEUE' && queuedZeroFields(ctx.r).includes(field);
}

function math(run: () => bigint, source: string): Recompute {
  try {
    return value(run(), source);
  } catch (error) {
    if (error instanceof PriceMathError) return unread(`${error.code}: ${error.message}`, source);
    throw error;
  }
}

function shares(ctx: Context): { spendPart: bigint; equityPart: bigint } | null {
  return ctx.rule === null ? null : splitShares(ctx.r.usdgIn, ctx.rule.equityBps);
}

function noRule(ctx: Context): Recompute {
  return unread(ctx.ruleProblem ?? 'no rule', 'RuleSet logs');
}

/** The pro rata share of the run's proceeds the receipt's lot gets, as SleeveSell writes it. */
function sellShare(ctx: Context): Recompute {
  const run = ctx.sell;
  if (run === null) return unread('no Swap log of the pool before the receipt', 'Swap and Transfer logs');
  const position = run.entries.findIndex((entry) => entry.logIndex === ctx.ev.receiptLog.logIndex);
  if (position < 0) return unread('the receipt is not in its sell run', 'Sell run, SPEC 13');
  const parts = run.entries.map((entry) => entry.receipt.tokensIn);
  const share = proRataShares(run.usdgTransferred, parts, run.tokensTransferred)[position];
  if (share === undefined) return unread('no part for the lot', 'Sell run, SPEC 13');
  return value(share, "The lot's pro rata part of the USDG Transfer logs to the account");
}

function multiplierValue(ctx: Context): Recompute {
  const at = ctx.multiplier;
  if (at === null) return unread('the token history was not read', 'UIMultiplierUpdated logs');
  if (!at.known) return unread(at.basis, 'UIMultiplierUpdated logs');
  return value(at.value, `uiMultiplier() at the receipt's time, from ${at.basis}`);
}

function recompute(ctx: Context, field: keyof Receipt): Recompute {
  const { r, kind, ev } = ctx;
  if (mustBeZero(ctx, field)) return value(zeroOf(field), `SPEC 13: a ${KIND_NAMES[kind]} leaves it zero`);
  const buy = isBuyKind(kind);
  switch (field) {
    case 'id':
      return value(ctx.log.topicId === ev.id ? ev.id : `indexed id ${ctx.log.topicId}`, "The id asked for and the log's indexed id");
    case 'account':
      return value(ctx.log.topicAccount, "The ReceiptWritten log's indexed account");
    case 'ruleVersion':
      if (ctx.rule !== null && r.ruleVersion !== 0) return value(ctx.rule.version, 'RuleSet log for the account and version');
      if (ctx.ruleProblem !== null) return noRule(ctx);
      return COMMITTED;
    case 'trigger':
      if (kind === 'SELL' || kind === 'LOT_RECONCILE' || kind === 'RELEASE') {
        return value('OWNER', 'SPEC 13: only the account can sell, trim its lots or release');
      }
      if (r.trigger === 'PAYLINK') return unread('KEEPER, OWNER or PUBLIC', 'PRD 7.7: the PAYLINK trigger is not available yet');
      return COMMITTED;
    case 'payer':
      return value(ZERO_ADDRESS, 'D-009 Q26: zero in M0');
    case 'status':
      return value(ctx.log.topicStatus, "The ReceiptWritten log's indexed status");
    case 'reason':
      return reasonOf(ctx);
    case 'mode':
      return value('WRAPPED', 'PRD 7.2: every M0 receipt is WRAPPED');
    case 'tickerId':
      if (isSplitKind(kind)) return ctx.rule === null ? noRule(ctx) : value(ctx.rule.tickerId, "The rule's ticker");
      return COMMITTED;
    case 'token': {
      const ticker = ev.ticker;
      if (ticker === null) return unread('not read', 'TokenSource.ticker(tickerId)');
      return ticker.ok ? value(ticker.value.token, 'TokenSource.ticker(tickerId)') : unread(ticker.error, 'TokenSource.ticker(tickerId)');
    }
    case 'tokenUid': {
      const uid = ev.tokenUid;
      if (uid === null) return unread('not read', 'uid() on the Stock Token');
      return uid.ok ? value(uid.value, 'uid() on the Stock Token') : unread(uid.error, 'uid() on the Stock Token');
    }
    case 'usdgIn':
      if (kind === 'LEDGER_RECONCILE') return reconciledTotal(ctx);
      return COMMITTED;
    case 'usdgToSpend': {
      if (kind === 'SELL') return sellShare(ctx);
      if (kind === 'SETTLE_REFUSAL') return value(r.usdgToEquity, 'SPEC 13: the refused bucket goes to spend');
      if (!isSplitKind(kind)) return COMMITTED;
      const parts = shares(ctx);
      if (parts === null) return noRule(ctx);
      return kind === 'SPLIT_REFUSAL'
        ? value(parts.spendPart + parts.equityPart, 'splitShares of usdgIn: the spend part and the refused equity part')
        : value(parts.spendPart, "splitShares of usdgIn by the rule's equity share");
    }
    case 'usdgToEquity': {
      if (!isSplitKind(kind)) return COMMITTED;
      const parts = shares(ctx);
      return parts === null ? noRule(ctx) : value(parts.equityPart, "splitShares of usdgIn by the rule's equity share");
    }
    case 'usdgSpent':
      if (kind === 'LEDGER_RECONCILE') return reconciledPart(ctx, 'spend');
      if (ctx.buy === null) return unread('no swap paying the account before the receipt', 'Swap and Transfer logs');
      return value(ctx.buy.usdgSpent, 'USDG Transfer logs from the account to the pool');
    case 'usdgQueued': {
      if (kind === 'LEDGER_RECONCILE') return reconciledPart(ctx, 'buckets');
      const parts = shares(ctx);
      return parts === null ? noRule(ctx) : value(parts.equityPart, 'The equity part, which waits in the bucket');
    }
    case 'tokensIn':
      return COMMITTED;
    case 'tokensOut':
      if (ctx.buy === null) return unread('no swap paying the account before the receipt', 'Swap and Transfer logs');
      return value(ctx.buy.tokensOut, 'Stock Token Transfer logs from the pool to the account');
    case 'usdgOut':
      return sellShare(ctx);
    case 'uiMultiplier':
      return multiplierValue(ctx);
    case 'execPrice':
      return execPrice(ctx);
    case 'premiumBps':
      if (kind === 'SPLIT_QUEUE') return COMMITTED;
      return premium(ctx);
    case 'roundId':
    case 'usdgRoundId':
    case 'quote':
      return COMMITTED;
    case 'answer':
    case 'updatedAt': {
      const round = stockRound(ctx);
      const source = "getRoundData(roundId) on the ticker's feed";
      return round.ok ? value(round.value[field], source) : unread(round.error, source);
    }
    case 'usdgAnswer': {
      const round = usdgRound(ctx);
      const source = 'getRoundData(usdgRoundId) on the USDG/USD feed';
      return round.ok ? value(round.value.answer, source) : unread(round.error, source);
    }
    case 'minOut':
      return minOut(ctx);
    case 'venueId':
      if (kind === 'SPLIT_QUEUE') return value(1, 'SPEC 13: venue 1 ran the swap, which was undone');
      return swapFound(ctx) ? value(1, 'A Swap log of a Uniswap v3 pool, venue 1') : unread('no Swap log', 'Swap logs');
    case 'pool': {
      if (kind === 'SPLIT_QUEUE') return COMMITTED;
      const swap = buy ? ctx.buy?.swap : ctx.sell?.swap;
      return swap === undefined ? unread('no Swap log', 'Swap logs') : value(swap.pool, 'The address that logged the Swap');
    }
    case 'calendarVersion':
      return value(ctx.calendarVersion, 'version() on the calendar extension, less the writes since the receipt');
    case 'disclosureHash':
      return value(ev.disclosureHash, 'disclosureHash() on the module');
    case 'l2Block':
      return value(ev.receiptLog.blockNumber, 'The block of the ReceiptWritten log');
    case 'timestamp':
      return value(ev.block.timestamp, "The block's timestamp");
    case 'lotId':
      if (buy) return value(r.id, "SPEC 14: a lot takes its buy receipt's id");
      return COMMITTED;
    case 'queuedSince':
    case 'overrideClosed':
    case 'overrideCapBps':
      return COMMITTED;
  }
}

function swapFound(ctx: Context): boolean {
  return isBuyKind(ctx.kind) ? ctx.buy !== null : ctx.sell !== null;
}

function reasonOf(ctx: Context): Recompute {
  const { kind } = ctx;
  if (kind === 'SETTLE_FILL' || kind === 'RELEASE') return COMMITTED;
  const replay = replayGuard(ctx);
  const source = 'The guard steps of PRD 7.4 re-run on chain data';
  if (replay.kind === 'stopped') return unread(`not judged: ${replay.why}`, source);
  if (replay.kind === 'blocklist') return value('NONE', source);
  const outcome = replay.outcome;
  const reason = outcome.startsWith('QUEUED ') ? outcome.slice('QUEUED '.length) : outcome;
  return value(reason, `${source}: ${replay.basis}`);
}

function reconciledTotal(ctx: Context): Recompute {
  const event = ctx.reconciled;
  if (event === null) return unread('no Reconciled log for the receipt', 'Reconciled log');
  return value(event.fromSpend + event.fromBuckets.reduce((sum, part) => sum + part, 0n), 'Reconciled log: the cuts summed');
}

function reconciledPart(ctx: Context, part: 'spend' | 'buckets'): Recompute {
  const event = ctx.reconciled;
  if (event === null) return unread('no Reconciled log for the receipt', 'Reconciled log');
  return part === 'spend'
    ? value(event.fromSpend, 'Reconciled log: the cut from spend')
    : value(event.fromBuckets.reduce((sum, cut) => sum + cut, 0n), 'Reconciled log: the cuts from the buckets');
}

function execPrice(ctx: Context): Recompute {
  if (isBuyKind(ctx.kind)) {
    const fill = ctx.buy;
    if (fill === null) return unread('no swap paying the account before the receipt', 'Swap and Transfer logs');
    return math(() => execPriceBuy(fill.usdgSpent, fill.tokensOut), 'execPriceBuy on the Transfer logs, rounded up');
  }
  const run = ctx.sell;
  if (run === null) return unread('no Swap log of the pool before the receipt', 'Swap and Transfer logs');
  return math(() => execPriceSell(run.usdgTransferred, run.tokensTransferred), "execPriceSell on the run's Transfer logs, rounded down");
}

function premium(ctx: Context): Recompute {
  const round = stockRound(ctx);
  if (!round.ok) return unread(round.error, 'getRoundData');
  const decimals = ctx.decimals;
  if (!decimals.ok) return unread(decimals.error, 'decimals()');
  const answer = round.value.answer;
  if (isBuyKind(ctx.kind)) {
    const fill = ctx.buy;
    if (fill === null) return unread('no swap paying the account before the receipt', 'Swap and Transfer logs');
    return math(
      () => premiumBps(fill.usdgSpent, fill.tokensOut, answer, decimals.value),
      'premiumBps on the Transfer logs and the re-read answer',
    );
  }
  const run = ctx.sell;
  if (run === null) return unread('no Swap log of the pool before the receipt', 'Swap and Transfer logs');
  return math(
    () => discountBps(run.usdgTransferred, run.tokensTransferred, answer, decimals.value),
    "discountBps on the run's Transfer logs and the re-read answer",
  );
}

function minOut(ctx: Context): Recompute {
  const rule = ctx.rule;
  if (rule === null) return noRule(ctx);
  const { r } = ctx;
  if (ctx.kind === 'SELL') {
    const run = ctx.sell;
    if (run === null) return unread('no Swap log of the pool before the receipt', 'Swap and Transfer logs');
    return value(minOutForSell(run.tokensTransferred, r.quote, rule.slippageBps), "minOutForSell on the run's tokens, the quote and the rule's slippage");
  }
  return value(minOutForBuy(r.usdgToEquity, r.quote, rule.slippageBps), "minOutForBuy on usdgToEquity, the quote and the rule's slippage");
}

const LABELS: Record<keyof Receipt, string> = {
  id: 'Receipt id',
  account: 'Account',
  ruleVersion: 'Rule version',
  trigger: 'Trigger',
  payer: 'Payer',
  status: 'Status',
  reason: 'Reason',
  mode: 'Accounting mode',
  tickerId: 'Ticker id',
  token: 'Stock Token',
  tokenUid: 'Stock Token uid',
  usdgIn: 'USDG in',
  usdgToSpend: 'USDG to spend',
  usdgToEquity: 'USDG to equity',
  usdgSpent: 'USDG spent',
  usdgQueued: 'USDG queued',
  tokensIn: 'Stock Tokens in',
  tokensOut: 'Stock Tokens out',
  usdgOut: 'USDG out',
  uiMultiplier: 'Multiplier',
  execPrice: 'Execution price',
  premiumBps: 'Premium over the feed price',
  roundId: 'Feed round',
  answer: 'Feed answer',
  updatedAt: 'Feed round time',
  usdgRoundId: 'USDG/USD round',
  usdgAnswer: 'USDG/USD answer',
  quote: 'Quote',
  minOut: 'Minimum out',
  venueId: 'Venue',
  pool: 'Pool',
  calendarVersion: 'Calendar version',
  disclosureHash: 'Disclosure hash',
  l2Block: 'L2 block',
  timestamp: 'Block time',
  lotId: 'Lot',
  queuedSince: 'Waiting since',
  overrideClosed: 'Sold while closed',
  overrideCapBps: 'Override cap',
};

function labelOf(kind: ReceiptKind, field: keyof Receipt): string {
  if (kind === 'SELL' && field === 'premiumBps') return 'Discount below the feed price';
  return LABELS[field];
}

const UNITS: Partial<Record<keyof Receipt, ValueUnit>> = {
  account: 'address',
  payer: 'address',
  token: 'address',
  pool: 'address',
  tokenUid: 'hash',
  disclosureHash: 'hash',
  usdgIn: 'usdg',
  usdgToSpend: 'usdg',
  usdgToEquity: 'usdg',
  usdgSpent: 'usdg',
  usdgQueued: 'usdg',
  usdgOut: 'usdg',
  execPrice: 'usdg',
  tokensIn: 'token',
  tokensOut: 'token',
  uiMultiplier: 'multiplier',
  premiumBps: 'bps',
  overrideCapBps: 'bps',
  answer: 'feed',
  usdgAnswer: 'feed',
  updatedAt: 'timestamp',
  timestamp: 'timestamp',
  queuedSince: 'timestamp',
  l2Block: 'block',
};

/**
 * A buy's minimum is in Stock Token units and its quote in token units per 1 USDG; a sell's minimum is in USDG and
 * its quote in USDG per whole token, a price (D-009 Q21).
 */
function unitOf(kind: ReceiptKind, field: keyof Receipt): ValueUnit {
  if (field === 'minOut') return kind === 'SELL' ? 'usdg' : 'token';
  if (field === 'quote') return kind === 'SELL' ? 'usdg' : 'text';
  return UNITS[field] ?? 'text';
}

const HASH_DIFFERS = 'not committed: the stored hash differs';

function toRow(ctx: Context, field: keyof Receipt, result: Recompute): FieldRow {
  const base = { field, label: labelOf(ctx.kind, field), unit: unitOf(ctx.kind, field), receipt: fieldText(ctx.r, field) };
  switch (result.kind) {
    case 'value':
      return fieldRow({ ...base, recomputed: text(result.value), source: result.source });
    case 'unread':
      return fieldRow({ ...base, recomputed: result.reason, status: 'MISMATCH', source: result.source });
    case 'committed':
      return fieldRow({
        ...base,
        recomputed: ctx.hashMatches ? base.receipt : HASH_DIFFERS,
        status: ctx.hashMatches ? 'MATCH' : 'MISMATCH',
        source: 'receiptHash(id) commits to it; no other source records it',
      });
  }
}

export function fieldRows(ctx: Context): FieldRow[] {
  return (Object.keys(RECEIPT_FIELDS) as (keyof Receipt)[]).map((field) => toRow(ctx, field, recompute(ctx, field)));
}
