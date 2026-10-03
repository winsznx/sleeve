import {
  formatStockToken,
  formatUnits,
  formatUsdg,
  isPoolAllowlisted,
  tickerById,
  type Reason,
  type TickerId,
  type Trigger,
} from '@sleeve/core';

import { formatNewYork, formatUtc, formatUtcDate } from '@/components/ui/format-time';
import type { InboundState, ReceiptRecord, Reconciliation } from '@/data/types';

/**
 * The plain words Sleeve's components print, built from a receipt's or a bucket's own numbers. Every string here
 * passes the copy lint (scripts/copy-lint.mjs): no share as a noun, no yield or performance words, no dashes.
 * Amounts read number then unit, and the direction is a word: arrived, became, moved to spend.
 */

export function tickerSymbol(tickerId: TickerId): string {
  return tickerById(tickerId)?.symbol ?? `ticker ${tickerId}`;
}

/** "1,080.00 USDG": two places, cut down never up, for balances on cards. */
export function usdgText(amount: bigint): string {
  return `${formatUsdg(amount)} USDG`;
}

/**
 * Every digit a receipt holds, with at least two places: 93.725 stays 93.725. Receipts and split legends use it so
 * the parts of a payment always add up to the payment.
 */
export function usdgExact(amount: bigint): string {
  return formatUsdg(amount, { maxFractionDigits: 6 });
}

export function usdgExactText(amount: bigint): string {
  return `${usdgExact(amount)} USDG`;
}

/** "0.155872 SPY": two to six places. */
export function tokenText(amount: bigint, symbol: string): string {
  return `${formatStockToken(amount)} ${symbol}`;
}

/** Basis points as words with two places, sign dropped: 4 is "0.04 percent", -9 is "0.09 percent". */
export function percentWords(bps: bigint | number): string {
  const value = typeof bps === 'bigint' ? bps : BigInt(bps);
  const magnitude = value < 0n ? -value : value;
  return `${formatUnits(magnitude, 2, { minFractionDigits: 2, maxFractionDigits: 2 })} percent`;
}

const WAIT_CAUSE: Record<Exclude<Reason, 'NONE'>, string> = {
  PAUSED: 'the token was paused',
  ORACLE_PAUSED: 'price updates were paused',
  SESSION: 'the market was closed',
  MULTIPLIER: 'a multiplier change was due',
  STALE: 'the market reference was out of date',
  DEPEG: 'USDG was not at 1 dollar',
  CLIP: 'it was below your minimum buy',
  PREMIUM: 'the price was above your cap',
};

/** Why a past receipt queued, as the end of a sentence: "because the market was closed". */
export function waitCause(reason: Reason): string {
  return reason === 'NONE' ? 'the guard had not cleared' : WAIT_CAUSE[reason];
}

export interface ReasonContext {
  symbol: string;
  /** SESSION: when the market reopens (TickerMarket.session.nextOpenAt). */
  reopensAt?: bigint | null;
  /** CLIP: the rule's minimum buy, USDG base units. */
  minClip?: bigint;
  /** PREMIUM: the rule's cap. */
  premiumCapBps?: number;
}

/**
 * Why equity waits right now and what happens next, in plain words (PRD 15, Waiting). The guard steps and their
 * thresholds are SPEC 4 and 9: 25 hours of feed age, 0.5 percent of depeg tolerance, a 24 hour multiplier window.
 */
export function reasonSentence(reason: Reason, context: ReasonContext): string {
  const { symbol } = context;
  switch (reason) {
    case 'SESSION':
      return context.reopensAt === undefined || context.reopensAt === null
        ? `The market is closed. Sleeve buys ${symbol} after it reopens.`
        : `The market is closed. Sleeve buys ${symbol} after it reopens, ${formatNewYork(context.reopensAt)}.`;
    case 'PAUSED':
      return `The issuer has paused the ${symbol} token. Sleeve buys once it is unpaused.`;
    case 'ORACLE_PAUSED':
      return `The issuer has flagged price updates for ${symbol} as paused. Sleeve buys once the flag clears.`;
    case 'MULTIPLIER':
      return `A corporate action changes the ${symbol} multiplier within 24 hours. Sleeve buys after the change takes effect.`;
    case 'STALE':
      return `The Chainlink market reference for ${symbol} is more than 25 hours old or has not updated since the market reopened. Sleeve buys once a fresh price arrives.`;
    case 'DEPEG':
      return 'The USDG price reference is more than 0.5 percent away from 1 US dollar, or more than 25 hours old. Sleeve buys once it is back in range.';
    case 'CLIP':
      return context.minClip === undefined
        ? 'This is below your minimum buy, so it waits. Sleeve buys once the waiting amount reaches the minimum.'
        : `This is below your minimum buy of ${usdgText(context.minClip)}, so it waits. Sleeve buys once the waiting amount reaches the minimum.`;
    case 'PREMIUM':
      return context.premiumCapBps === undefined
        ? 'The price was further above the market reference than your cap allows. Sleeve tries again when it is within your cap.'
        : `The price was more than ${percentWords(context.premiumCapBps)} above the market reference, your cap. Sleeve tries again when it is within your cap.`;
    case 'NONE':
      return '';
  }
}

/** Who started the action a receipt records (SPEC 8). PAYLINK is M1 and never appears on an M0 receipt. */
export function triggerLabel(trigger: Trigger): string {
  switch (trigger) {
    case 'KEEPER':
      return "Sleeve's keeper";
    case 'OWNER':
      return 'You';
    case 'PUBLIC':
      return 'Anyone, after the one hour grace period';
    case 'PAYLINK':
      return 'Pay link, not available yet';
  }
}

function reconciledSentence(reconciliation: Reconciliation | null): string {
  const opening = 'USDG left the account outside Sleeve, for example through an old approval.';
  if (reconciliation === null) return `${opening} Sleeve lowered its ledgers to match the balance.`;
  const cuts: string[] = [];
  if (reconciliation.fromSpend > 0n) cuts.push(`spend by ${usdgExactText(reconciliation.fromSpend)}`);
  for (const bucket of reconciliation.fromBuckets) {
    cuts.push(`waiting ${tickerSymbol(bucket.tickerId)} by ${usdgExactText(bucket.amount)}`);
  }
  if (cuts.length === 0) return `${opening} Sleeve checked its ledgers against the balance.`;
  return `${opening} To match the balance, Sleeve lowered ${cuts.join(' and ')}.`;
}

/** One sentence that says what a receipt records, from its own numbers (docs/DESIGN.md 12.4). */
export function receiptSentence(record: ReceiptRecord): string {
  const receipt = record.receipt;
  const symbol = tickerSymbol(receipt.tickerId);
  switch (receipt.status) {
    case 'FILLED':
      return `${usdgExactText(receipt.usdgIn)} arrived. ${usdgExactText(receipt.usdgToSpend)} stayed spendable and ${usdgExactText(receipt.usdgSpent)} became ${tokenText(receipt.tokensOut, symbol)}.`;
    case 'QUEUED':
      return `${usdgExactText(receipt.usdgIn)} arrived. ${usdgExactText(receipt.usdgToSpend)} stayed spendable and ${usdgExactText(receipt.usdgQueued)} stayed as USDG to buy ${symbol} later, because ${waitCause(receipt.reason)}.`;
    case 'SETTLED':
      return receipt.queuedSince > 0n
        ? `${usdgExactText(receipt.usdgSpent)} that waited since ${formatUtcDate(receipt.queuedSince)} became ${tokenText(receipt.tokensOut, symbol)}.`
        : `${usdgExactText(receipt.usdgSpent)} that waited became ${tokenText(receipt.tokensOut, symbol)}.`;
    case 'REFUSED_TICKER':
      return isPoolAllowlisted(receipt.tickerId, receipt.pool)
        ? `${usdgExactText(receipt.usdgIn)} arrived and all of it stayed spendable. ${symbol} is no longer on Sleeve's ticker list, so the ${usdgExactText(receipt.usdgToEquity)} equity share went to spend.`
        : `${usdgExactText(receipt.usdgIn)} arrived and all of it stayed spendable. The pool this split named is not on the ${symbol} allowlist, so the ${usdgExactText(receipt.usdgToEquity)} equity share went to spend.`;
    case 'REFUSED_ACCOUNT':
      return `${usdgExactText(receipt.usdgIn)} arrived and all of it stayed spendable. The issuer's blocklist includes this account, so ${symbol} could not be bought and the ${usdgExactText(receipt.usdgToEquity)} equity share went to spend.`;
    case 'RELEASED':
      return `${usdgExactText(receipt.usdgIn)} that waited to buy ${symbol} moved to spend.`;
    case 'PART_SOLD':
      return `Sold ${tokenText(receipt.tokensIn, symbol)} from lot ${receipt.lotId} for ${usdgExactText(receipt.usdgOut)}, which went to spend. The rest of the lot is still held.`;
    case 'SOLD':
      return `Sold ${tokenText(receipt.tokensIn, symbol)} from lot ${receipt.lotId} for ${usdgExactText(receipt.usdgOut)}, which went to spend. Nothing is left in the lot.`;
    case 'RECONCILED':
      return reconciledSentence(record.reconciliation);
  }
}

/** A short title for a receipt in a list. */
export function receiptTitle(record: ReceiptRecord): string {
  const receipt = record.receipt;
  const symbol = tickerSymbol(receipt.tickerId);
  switch (receipt.status) {
    case 'FILLED':
      return `Bought ${symbol}`;
    case 'QUEUED':
      return `${symbol} buy waiting`;
    case 'SETTLED':
      return `Bought ${symbol} with waiting USDG`;
    case 'REFUSED_TICKER':
    case 'REFUSED_ACCOUNT':
      return `${symbol} buy refused`;
    case 'RELEASED':
      return 'Waiting USDG moved to spend';
    case 'PART_SOLD':
    case 'SOLD':
      return `Sold ${symbol}`;
    case 'RECONCILED':
      return 'Ledgers corrected';
  }
}

/** The one amount a receipt row leads with: what arrived, bought, moved or came back. */
export function receiptHeadline(record: ReceiptRecord): bigint {
  const receipt = record.receipt;
  switch (receipt.status) {
    case 'SETTLED':
      return receipt.usdgSpent;
    case 'PART_SOLD':
    case 'SOLD':
      return receipt.usdgOut;
    case 'RECONCILED':
      return record.reconciliation?.shortfall ?? 0n;
    default:
      return receipt.usdgIn;
  }
}

/** "Receipt 455, 23 Sep 2026, 21:00 UTC" */
export function receiptMeta(record: ReceiptRecord): string {
  return `Receipt ${record.receipt.id}, ${formatUtc(record.receipt.timestamp)}`;
}

export const INBOX_STATE_LABEL: Record<InboundState, string> = {
  RECEIVED: 'Not sorted yet',
  WAITING_GRACE: 'Waiting to sort',
  SORTED: 'Sorted',
};

/** What happens to an inbound transfer next, or what already did. */
export function inboxStateSentence(state: InboundState, graceEndsAt: bigint | null): string {
  switch (state) {
    case 'RECEIVED':
      return 'Not sorted yet. It stays spendable in your account until it is.';
    case 'WAITING_GRACE':
      return graceEndsAt === null
        ? 'Not sorted yet. It stays spendable in your account until it is.'
        : `Not sorted yet. If Sleeve's keeper has not sorted it by ${formatUtc(graceEndsAt)}, anyone can start the split.`;
    case 'SORTED':
      return 'Sorted by your rule.';
  }
}
