import {
  EXPECTED_DECIMALS,
  formatStockToken,
  formatUnits,
  isPoolAllowlisted,
  type Reason,
  type Receipt,
} from '@sleeve/core';

import { premiumSentence, type PremiumSide } from '@/components/sleeve/premium-line';
import { receiptSentence, tickerSymbol, tokenText, usdgExact, usdgExactText, waitCause } from '@/components/sleeve/text';
import { tickerTokenKey } from '@/components/token/ticker-icon';
import type { TokenKey } from '@/components/token/registry';
import { formatNewYork, formatUtc } from '@/components/ui/format-time';
import type { ReceiptRecord } from '@/data/types';

import { isLotCorrection, isSettleRefusal } from '../_lib/outcome';
import { poolFacts, venueName, venuePath, type PoolFacts } from '../_lib/pool';
import { calendarWords, isZeroHex, premiumWords, roundWords } from './receipt-sections';

/**
 * The details page's panels as data (PRD 10, docs/DESIGN.md 12.4, D-024): the split a payday made, the move a buy
 * after a wait, a release or a sale made, the price against the market reference, the route through the pool and
 * the market session the guard read. Every value comes from the receipt's own fields; anything read from logs or
 * the rule's history is marked derived. Nothing here touches React, so the words and the arithmetic are tested on
 * their own.
 */

const BUY = new Set<Receipt['status']>(['FILLED', 'SETTLED']);
const SELL = new Set<Receipt['status']>(['PART_SOLD', 'SOLD']);

export function isBuy(receipt: Receipt): boolean {
  return BUY.has(receipt.status);
}

export function isSell(receipt: Receipt): boolean {
  return SELL.has(receipt.status);
}

const tokenExact = (value: bigint): string => formatUnits(value, EXPECTED_DECIMALS.STOCK_TOKEN, { minFractionDigits: 2 });
const feedExact = (value: bigint): string => formatUnits(value, EXPECTED_DECIMALS.FEED, { minFractionDigits: 2 });

/** "90 percent", "9.99 percent": a part of a payday, rounded half up to a hundredth of a percent. */
export function percentOf(part: bigint, whole: bigint): string {
  if (whole <= 0n) return '0 percent';
  const hundredths = (part * 10_000n * 2n + whole) / (whole * 2n);
  return `${formatUnits(hundredths, 2, { minFractionDigits: 0 })} percent`;
}

/** One leg of a payday split, as the split hero draws it. */
export type SplitLeg =
  | { kind: 'spend'; amount: bigint; percent: string }
  | { kind: 'equity'; amount: bigint; percent: string; tokens: bigint; symbol: string; token: TokenKey | null; lotId: bigint }
  | { kind: 'waiting'; amount: bigint; percent: string; reason: Reason; symbol: string; sentence: string }
  | { kind: 'refused'; amount: bigint; percent: string; symbol: string; token: TokenKey | null; sentence: string };

export interface SplitModel {
  usdgIn: bigint;
  legs: SplitLeg[];
  /** The bar across the hero: spendable money (refused equity included), bought, waiting. */
  parts: { spend: bigint; equity: bigint; waiting: bigint };
  /** "Bought 0.04 percent above the market reference." on a fill, otherwise null. */
  premium: string | null;
}

function refusedSentence(receipt: Receipt, symbol: string): string {
  if (receipt.status === 'REFUSED_ACCOUNT') {
    return `The issuer's blocklist includes this account, so Sleeve could not buy ${symbol}. The equity share went to spend.`;
  }
  return isPoolAllowlisted(receipt.tickerId, receipt.pool)
    ? `${symbol} is no longer on Sleeve's ticker list, so the equity share went to spend.`
    : `The pool this split named is not on the ${symbol} allowlist, so the equity share went to spend.`;
}

/** Why a settle refused a waiting bucket, which then went to spend. */
function settleRefusalSentence(receipt: Receipt, symbol: string): string {
  if (receipt.status === 'REFUSED_ACCOUNT') {
    return `The issuer's blocklist includes this account, so Sleeve could not buy ${symbol}. The waiting USDG went to spend.`;
  }
  return `${symbol} is no longer on Sleeve's ticker list, so the waiting USDG went to spend.`;
}

/** The split a payday made: what stayed spendable and what became, waits for or could not buy the Stock Token. */
export function splitModel(record: ReceiptRecord): SplitModel | null {
  const r = record.receipt;
  const symbol = tickerSymbol(r.tickerId);
  const token = tickerTokenKey(r.tickerId);
  const legs: SplitLeg[] = [];
  const spend = (amount: bigint): SplitLeg => ({ kind: 'spend', amount, percent: percentOf(amount, r.usdgIn) });
  switch (r.status) {
    case 'FILLED':
      if (r.usdgToSpend > 0n) legs.push(spend(r.usdgToSpend));
      legs.push({
        kind: 'equity',
        amount: r.usdgSpent,
        percent: percentOf(r.usdgSpent, r.usdgIn),
        tokens: r.tokensOut,
        symbol,
        token,
        lotId: r.lotId,
      });
      return {
        usdgIn: r.usdgIn,
        legs,
        parts: { spend: r.usdgToSpend, equity: r.usdgSpent, waiting: 0n },
        premium: r.execPrice === 0n ? null : premiumSentence('buy', r.premiumBps),
      };
    case 'QUEUED':
      if (r.usdgToSpend > 0n) legs.push(spend(r.usdgToSpend));
      legs.push({
        kind: 'waiting',
        amount: r.usdgQueued,
        percent: percentOf(r.usdgQueued, r.usdgIn),
        reason: r.reason,
        symbol,
        sentence: `Kept as USDG in the account because ${waitCause(r.reason)}. Sleeve buys ${symbol} with it once the guard clears, unless it moves to spend first.`,
      });
      return { usdgIn: r.usdgIn, legs, parts: { spend: r.usdgToSpend, equity: 0n, waiting: r.usdgQueued }, premium: null };
    case 'REFUSED_TICKER':
    case 'REFUSED_ACCOUNT': {
      if (isSettleRefusal(r)) return null;
      const kept = r.usdgIn - r.usdgToEquity;
      if (kept > 0n) legs.push(spend(kept));
      legs.push({
        kind: 'refused',
        amount: r.usdgToEquity,
        percent: percentOf(r.usdgToEquity, r.usdgIn),
        symbol,
        token,
        sentence: refusedSentence(r, symbol),
      });
      return { usdgIn: r.usdgIn, legs, parts: { spend: r.usdgIn, equity: 0n, waiting: 0n }, premium: null };
    }
    default:
      return null;
  }
}

/** One side of a move: what went in or came out, with its token. */
export interface MoveSide {
  label: string;
  token: TokenKey | null;
  symbol: string;
  /** The amount without its unit, every digit the receipt holds for USDG, two to six places for Stock Tokens. */
  amount: string;
  /** A quiet line under the amount. */
  note: string | null;
  /** A Stock Token side carries the debt security line directly under its amount. */
  debtSecurity: boolean;
  /** The details of the buy that opened the lot a sale drew from. */
  lotHref: string | null;
}

export interface MoveModel {
  /** The hero's heading: "The buy", "The release", "The sale". */
  heading: string;
  from: MoveSide;
  to: MoveSide;
  /** "Sold 0.09 percent below the market reference." when a swap ran, otherwise null. */
  premium: string | null;
  /** Plain lines under the move: why a release runs no check, an off-hours override. */
  notes: string[];
}

/** The move a buy after a wait, a release or a sale made: one side in, one side out. Null for other receipts. */
export function moveModel(record: ReceiptRecord): MoveModel | null {
  const r = record.receipt;
  const symbol = tickerSymbol(r.tickerId);
  const token = tickerTokenKey(r.tickerId);
  const usdgSide = (label: string, amount: bigint, note: string | null): MoveSide => ({
    label,
    token: 'USDG',
    symbol: 'USDG',
    amount: usdgExact(amount),
    note,
    debtSecurity: false,
    lotHref: null,
  });
  const tokenSide = (label: string, amount: bigint, note: string | null, lotHref: string | null = null): MoveSide => ({
    label,
    token,
    symbol,
    amount: formatStockToken(amount),
    note,
    debtSecurity: true,
    lotHref,
  });
  switch (r.status) {
    case 'SETTLED':
      return {
        heading: 'The buy',
        from: usdgSide('Waited as USDG', r.usdgSpent, r.queuedSince > 0n ? `Waiting since ${formatUtc(r.queuedSince)}` : null),
        to: tokenSide(`Became ${symbol}`, r.tokensOut, r.lotId === 0n ? null : `Lot ${r.lotId.toString()}`),
        premium: r.execPrice === 0n ? null : premiumSentence('buy', r.premiumBps),
        notes: [],
      };
    case 'RELEASED':
      return {
        heading: 'The release',
        from: usdgSide(`Waited to buy ${symbol}`, r.usdgToSpend, r.queuedSince > 0n ? `Waiting since ${formatUtc(r.queuedSince)}` : null),
        to: usdgSide('Moved to spend', r.usdgToSpend, 'Spendable at once. Sleeve never splits it again.'),
        premium: null,
        notes: ['A release runs no price check. The owner can move waiting USDG to spend at any time.'],
      };
    case 'REFUSED_TICKER':
    case 'REFUSED_ACCOUNT':
      if (!isSettleRefusal(r)) return null;
      return {
        heading: 'The refused buy',
        from: usdgSide(`Waited to buy ${symbol}`, r.usdgToSpend, `Waiting since ${formatUtc(r.queuedSince)}`),
        to: usdgSide('Moved to spend', r.usdgToSpend, 'Spendable at once. Sleeve never splits it again.'),
        premium: null,
        notes: [settleRefusalSentence(r, symbol)],
      };
    case 'PART_SOLD':
    case 'SOLD': {
      const notes = r.overrideClosed ? ["Sold while the market reference was not live, by the owner's one-time override."] : [];
      return {
        heading: 'The sale',
        from: tokenSide(
          r.lotId === 0n ? `Sold ${symbol}` : `Sold from lot ${r.lotId.toString()}`,
          r.tokensIn,
          r.status === 'SOLD' ? 'Nothing is left in the lot.' : 'The rest of the lot is still held.',
          r.lotId === 0n ? null : `/receipts/${r.lotId.toString()}`,
        ),
        to: usdgSide('Went to spend', r.usdgOut, 'Sleeve never splits the USDG from a sale.'),
        premium: r.execPrice === 0n ? null : premiumSentence('sell', r.premiumBps),
        notes,
      };
    }
    default:
      return null;
  }
}

export interface CorrectionCut {
  id: string;
  label: string;
  amount: bigint;
  kind: 'spend' | 'waiting';
}

export interface LotCut {
  lotId: bigint;
  /** Stock Token base units trimmed off the lot (the receipt's tokensIn). */
  tokens: bigint;
  symbol: string;
  token: TokenKey | null;
}

export interface CorrectionModel {
  /** What happened, in one sentence from the receipt's own numbers. */
  sentence: string;
  /** USDG the ledgers had to cut, read from the RECONCILED event. Null when the logs did not have it, or for a lot. */
  shortfall: bigint | null;
  cuts: CorrectionCut[];
  /** A lot's correction: the Stock Tokens trimmed off one lot. Null for a split's correction. */
  lot: LotCut | null;
  /** The order the correction cuts in. */
  order: string;
}

/** How a correction cut the ledgers, in the fixed order: spend first, then waiting USDG, lowest ticker first. */
export function correctionModel(record: ReceiptRecord): CorrectionModel | null {
  const r = record.receipt;
  if (r.status !== 'RECONCILED') return null;
  if (isLotCorrection(r)) {
    const symbol = tickerSymbol(r.tickerId);
    return {
      sentence: `${symbol} left the account outside Sleeve, for example in a transfer signed elsewhere. To match the balance, Sleeve trimmed lot ${r.lotId.toString()} by ${tokenText(r.tokensIn, symbol)}. Nothing moved.`,
      shortfall: null,
      cuts: [],
      lot: { lotId: r.lotId, tokens: r.tokensIn, symbol, token: tickerTokenKey(r.tickerId) },
      order: 'Lots are trimmed oldest first, the order a sell takes them in.',
    };
  }
  const sentence = receiptSentence(record);
  const order = 'The ledgers come down in a fixed order: spend first, then USDG waiting to buy, lowest ticker first.';
  const reconciliation = record.reconciliation;
  if (reconciliation === null) return { sentence, shortfall: null, cuts: [], lot: null, order };
  const cuts: CorrectionCut[] = [];
  if (reconciliation.fromSpend > 0n) cuts.push({ id: 'spend', label: 'Taken from spend', amount: reconciliation.fromSpend, kind: 'spend' });
  for (const bucket of reconciliation.fromBuckets) {
    cuts.push({
      id: `bucket-${bucket.tickerId}`,
      label: `Taken from USDG waiting to buy ${tickerSymbol(bucket.tickerId)}`,
      amount: bucket.amount,
      kind: 'waiting',
    });
  }
  return { sentence, shortfall: reconciliation.shortfall, cuts, lot: null, order };
}

export interface CapCheck {
  bps: number;
  /** override: widened on this sell, stored on the receipt. rule: the rule version's cap, read from rule events. */
  source: 'override' | 'rule';
  derived: boolean;
  within: boolean;
}

/** What a fill paid or took, measured from the account's balances. Null on receipts where no swap ran. */
export interface FillPrice {
  side: PremiumSide;
  /** The all-in price, every digit the receipt holds, in USDG per whole token. */
  execPrice: string;
  filledAt: bigint;
  premiumBps: bigint;
  /** "Bought 0.04 percent above the market reference." */
  sentence: string;
  /** "4 basis points above the market reference" */
  words: string;
  /** Seconds from the reference's publication to the fill. Never negative. */
  referenceAge: bigint;
  cap: CapCheck | null;
}

export interface PriceModel {
  symbol: string;
  /** The Chainlink answer, every digit, in USD per whole token. */
  reference: string;
  referenceAt: bigint;
  roundId: bigint;
  /** "Phase 1, round 131 of that phase." */
  round: string;
  fill: FillPrice | null;
  /** uiMultiplier when the guard read it, every digit. */
  multiplier: string | null;
  usdg: { answer: string; roundId: bigint; round: string } | null;
}

/** How far the fill sits on the owner's side of the cap. A buy pays a premium; a sale takes a discount. */
function capCheck(record: ReceiptRecord, side: PremiumSide): CapCheck | null {
  const { receipt } = record;
  const premium = receipt.premiumBps;
  const against = side === 'buy' ? premium : -premium;
  if (side === 'sell' && receipt.overrideCapBps > 0) {
    return { bps: receipt.overrideCapBps, source: 'override', derived: false, within: against <= BigInt(receipt.overrideCapBps) };
  }
  const rule = record.derived.rule;
  if (rule === null) return null;
  return { bps: rule.premiumCapBps, source: 'rule', derived: true, within: against <= BigInt(rule.premiumCapBps) };
}

function fillPrice(record: ReceiptRecord): FillPrice | null {
  const { receipt } = record;
  const side: PremiumSide | null = isBuy(receipt) ? 'buy' : isSell(receipt) ? 'sell' : null;
  if (side === null || receipt.execPrice === 0n) return null;
  const age = receipt.timestamp - receipt.updatedAt;
  return {
    side,
    execPrice: usdgExact(receipt.execPrice),
    filledAt: receipt.timestamp,
    premiumBps: receipt.premiumBps,
    sentence: premiumSentence(side, receipt.premiumBps),
    words: premiumWords(receipt.premiumBps),
    referenceAge: age < 0n ? 0n : age,
    cap: capCheck(record, side),
  };
}

/**
 * The market reference the guard read, and the fill against it when a swap ran. Null when the guard stopped before
 * it read the price. Pool and feed stay apart (PRD 7.11).
 */
export function priceModel(record: ReceiptRecord): PriceModel | null {
  const { receipt } = record;
  if (receipt.roundId === 0n) return null;
  return {
    symbol: tickerSymbol(receipt.tickerId),
    reference: feedExact(receipt.answer),
    referenceAt: receipt.updatedAt,
    roundId: receipt.roundId,
    round: roundWords(receipt.roundId),
    fill: fillPrice(record),
    multiplier: receipt.uiMultiplier === 0n ? null : formatUnits(receipt.uiMultiplier, 18, { minFractionDigits: 1 }),
    usdg:
      receipt.usdgRoundId === 0n
        ? null
        : { answer: feedExact(receipt.usdgAnswer), roundId: receipt.usdgRoundId, round: roundWords(receipt.usdgRoundId) },
  };
}

export interface RouteEnd {
  token: TokenKey | null;
  symbol: string;
  /** What moved at this end, when a swap ran: "120.00 USDG", "0.155872693654184832 SPY". */
  amount: string | null;
}

export interface RouteModel {
  from: RouteEnd;
  to: RouteEnd;
  /** False when the guard stopped before any swap: the pool is what the trigger named. */
  swapRan: boolean;
  venue: string | null;
  venuePath: string | null;
  pool: PoolFacts | null;
  /** The trigger's quote, with its unit. */
  quote: string | null;
  /** The least the swap accepted, with its unit. The swap reverts below it. */
  minOut: string | null;
}

/** The route a buy or sale took, or was meant to take, through an allowlisted pool. Null when no pool was named. */
export function routeModel(record: ReceiptRecord): RouteModel | null {
  const { receipt } = record;
  if (isZeroHex(receipt.pool) && receipt.venueId === 0) return null;
  const symbol = tickerSymbol(receipt.tickerId);
  const ticker = tickerTokenKey(receipt.tickerId);
  const sell = isSell(receipt);
  const swapRan = receipt.venueId !== 0 && (isBuy(receipt) || sell);
  const usdgEnd: RouteEnd = { token: 'USDG', symbol: 'USDG', amount: null };
  const tokenEnd: RouteEnd = { token: ticker, symbol, amount: null };
  let from = sell ? tokenEnd : usdgEnd;
  let to = sell ? usdgEnd : tokenEnd;
  let quote: string | null = null;
  let minOut: string | null = null;
  if (swapRan && sell) {
    from = { ...tokenEnd, amount: tokenText(receipt.tokensIn, symbol) };
    to = { ...usdgEnd, amount: usdgExactText(receipt.usdgOut) };
    quote = `${usdgExact(receipt.quote)} USDG per ${symbol}`;
    minOut = usdgExactText(receipt.minOut);
  } else if (swapRan) {
    from = { ...usdgEnd, amount: usdgExactText(receipt.usdgSpent) };
    to = { ...tokenEnd, amount: `${tokenExact(receipt.tokensOut)} ${symbol}` };
    quote = `${tokenExact(receipt.quote)} ${symbol} per USDG`;
    minOut = `${tokenExact(receipt.minOut)} ${symbol}`;
  }
  return {
    from,
    to,
    swapRan,
    venue: venueName(receipt.venueId),
    venuePath: venuePath(receipt.venueId),
    pool: isZeroHex(receipt.pool) ? null : poolFacts(receipt.tickerId, receipt.pool),
    quote,
    minOut,
  };
}

export type SessionCheck = 'open' | 'closed' | 'skipped' | 'not-reached' | 'none';

export interface SessionModel {
  /** Block time in New York, where the US session is defined. */
  newYork: string;
  check: SessionCheck;
  /** What the session step said for this receipt, in one sentence. */
  checkText: string;
  calendarVersion: number;
  calendar: string;
  /** When the USDG began to wait, for receipts about a wait. */
  waitingSince: bigint | null;
  /** Seconds from waitingSince to this receipt. */
  waited: bigint | null;
}

/** Guard steps after the session check, named as the guard reads them (SPEC 9 step 5). */
const LATER_STEP: Partial<Record<Reason, string>> = {
  MULTIPLIER: 'the multiplier check',
  STALE: 'the price age check',
  DEPEG: 'the USDG price check',
  CLIP: 'the minimum buy',
  PREMIUM: 'the premium cap',
};

/** Guard steps before the session check. */
const EARLIER_STEP: Partial<Record<Reason, string>> = {
  PAUSED: 'the token pause check',
  ORACLE_PAUSED: 'the price update check',
};

function sessionCheck(receipt: Receipt): { check: SessionCheck; text: string } {
  switch (receipt.status) {
    case 'FILLED':
      return { check: 'open', text: 'Open. The buy ran inside the session.' };
    case 'SETTLED':
      return { check: 'open', text: 'Open. The waiting USDG bought inside the session.' };
    case 'PART_SOLD':
    case 'SOLD':
      return receipt.overrideClosed
        ? { check: 'skipped', text: 'Skipped for this sell only, by the off-hours override the owner chose.' }
        : { check: 'open', text: 'Open. The sell ran inside the session.' };
    case 'QUEUED': {
      if (receipt.reason === 'SESSION') return { check: 'closed', text: 'Closed, so the equity share waits as USDG.' };
      const earlier = EARLIER_STEP[receipt.reason];
      if (earlier !== undefined) {
        return { check: 'not-reached', text: `Not reached. The guard stopped earlier, at ${earlier}.` };
      }
      const later = LATER_STEP[receipt.reason];
      return later === undefined
        ? { check: 'open', text: 'Open. The guard passed the session check.' }
        : { check: 'open', text: `Open. The guard passed the session check and stopped later, at ${later}.` };
    }
    case 'REFUSED_TICKER':
      return { check: 'not-reached', text: 'Not reached. The guard stopped first, at the ticker and pool check.' };
    case 'REFUSED_ACCOUNT':
      return { check: 'not-reached', text: 'Not reached. The guard stopped first, at the account check.' };
    case 'RELEASED':
      return { check: 'none', text: 'Not checked. A release runs no guard.' };
    case 'RECONCILED':
      return { check: 'none', text: 'Not checked. A correction runs no guard.' };
  }
}

export function sessionModel(receipt: Receipt): SessionModel {
  const { check, text } = sessionCheck(receipt);
  const waitingSince = receipt.queuedSince > 0n ? receipt.queuedSince : null;
  return {
    newYork: formatNewYork(receipt.timestamp),
    check,
    checkText: text,
    calendarVersion: receipt.calendarVersion,
    calendar: calendarWords(receipt.calendarVersion),
    waitingSince,
    waited: waitingSince === null ? null : receipt.timestamp - waitingSince,
  };
}

/** What a page calls the action when it offers to check it: "Check this split", "Check this sale". */
export function actionNoun(receipt: Receipt): string {
  if (isSettleRefusal(receipt)) return 'refused buy';
  switch (receipt.status) {
    case 'FILLED':
    case 'QUEUED':
    case 'REFUSED_TICKER':
    case 'REFUSED_ACCOUNT':
      return 'split';
    case 'SETTLED':
      return 'buy';
    case 'RELEASED':
      return 'release';
    case 'PART_SOLD':
    case 'SOLD':
      return 'sale';
    case 'RECONCILED':
      return 'correction';
  }
}
