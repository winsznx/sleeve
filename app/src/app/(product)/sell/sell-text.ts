import { EXPECTED_DECIMALS, RULE_LIMITS, formatUnits, formatUsdg, parseStockToken, type Reason } from '@sleeve/core';

import { percentWords, tokenText } from '@/components/sleeve/text';
import { REASON_LABEL } from '@/components/ui/badge';
import { formatNewYork, formatUtc } from '@/components/ui/format-time';
import { walletSigningFailureText } from '@/components/wallet/wallet-problems';
import { isDataLayerError } from '@/data/errors';
import type { Holding, LotView, SellBlock, SellQuote, SellRequest, TickerMarket } from '@/data/types';

/**
 * The sell screen's plain words and the arithmetic behind its form. Everything here is pure, so the sentences are
 * tested against the copy lint and the limits against the mock's lots.
 */

export type SellWait = NonNullable<SellQuote['waits']>;

function minBig(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

/** What Sleeve can sell of a holding: tokens in lots only (D-009 Q30), and never more than the balance. */
export function sellableTokens(holding: Holding): bigint {
  return minBig(holding.inLots, holding.balance);
}

/** What one lot can give, bounded by the balance in case tokens left the account outside Sleeve. */
export function lotSellableTokens(lot: LotView, holding: Holding): bigint {
  return minBig(lot.tokensRemaining, holding.balance);
}

/** Tokens the account holds that no lot covers. Sleeve cannot sell these in M0. */
export function tokensOutsideLots(holding: Holding): bigint {
  return holding.balance > holding.inLots ? holding.balance - holding.inLots : 0n;
}

/** A token amount as the amount field holds it: every digit and no grouping, so it parses back exactly. */
export function amountFieldText(tokens: bigint): string {
  return formatUnits(tokens, EXPECTED_DECIMALS.STOCK_TOKEN, { grouping: false });
}

export type AmountCheck = { ok: true; amount: bigint } | { ok: false; problem: string };

/**
 * Reads what the owner typed. `overLimit` is the sentence for an amount above `max`, because the limit reads
 * differently for a holding and for one lot.
 */
export function checkSellAmount(text: string, max: bigint, symbol: string, overLimit: string): AmountCheck {
  const parsed = parseStockToken(text);
  if (!parsed.ok) {
    switch (parsed.error) {
      case 'EMPTY':
        return { ok: false, problem: `Enter how much ${symbol} to sell.` };
      case 'TOO_MANY_DECIMALS':
        return { ok: false, problem: `${symbol} has at most 18 digits after the point.` };
      case 'NEGATIVE':
      case 'NOT_A_NUMBER':
        return { ok: false, problem: 'Enter a number, such as 0.05.' };
    }
  }
  if (parsed.value === 0n) return { ok: false, problem: `Enter more than 0 ${symbol}.` };
  if (parsed.value > max) return { ok: false, problem: overLimit };
  return { ok: true, amount: parsed.value };
}

export function holdingLimitSentence(max: bigint, symbol: string): string {
  return `You can sell up to ${tokenText(max, symbol)} here.`;
}

export function lotLimitSentence(lotId: bigint, max: bigint, symbol: string): string {
  return `Lot ${lotId} has ${tokenText(max, symbol)} left.`;
}

export function sameSellRequest(a: SellRequest | null, b: SellRequest | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.tickerId === b.tickerId &&
    a.amount === b.amount &&
    a.lotId === b.lotId &&
    a.overrideClosed === b.overrideClosed &&
    a.overrideCapBps === b.overrideCapBps
  );
}

/** "0.16 percent below the market reference". PriceGuard's discountBps is negative when a sale beats the feed. */
export function discountWords(discountBps: bigint): string {
  if (discountBps === 0n) return 'at the market reference';
  return `${percentWords(discountBps)} ${discountBps > 0n ? 'below' : 'above'} the market reference`;
}

/** The PRD 15 error line for a sell: say that nothing moved, in the owner's own terms. */
export function stillHereSentence(symbol: string): string {
  return `Nothing moved. Your ${symbol} and your USDG are still in your account.`;
}

export function waitTitle(wait: SellWait): string {
  return wait.reason === 'SESSION' ? 'This sell waits for the market' : 'This sell waits for a fresh price';
}

/** Why the sell waits and until when (B2-13). Waiting is the default; the override is a separate, explicit step. */
export function waitSentence(wait: SellWait, symbol: string): string {
  if (wait.reason === 'STALE') {
    return `The Chainlink reference for ${symbol} is more than 25 hours old, or has not updated since the market reopened. Sleeve does not sell until a fresh price arrives.`;
  }
  const opening = `The market is closed, so the Chainlink reference for ${symbol} still shows its last price.`;
  return wait.reopensAt === null
    ? `${opening} Sleeve does not sell until the market reopens.`
    : `${opening} Sleeve does not sell until the market reopens, ${formatNewYork(wait.reopensAt)}.`;
}

/** What the owner can do about a waiting sell. Nothing moves either way until they press Sell. */
export function waitNextStep(wait: SellWait, symbol: string): string {
  const retry = wait.reason === 'SESSION' ? 'Refresh the quote after the reopen' : 'Refresh the quote once a fresh price arrives';
  return `Nothing has moved, and your ${symbol} stays in your account. ${retry}, or choose not to wait for this sell once you have seen the risk.`;
}

/**
 * The gap risk in plain words, shown before the owner may skip the wait (PRD 7.5). The cap is measured against the
 * last reference price, which is exactly what a reopen can leave behind.
 */
export function gapRiskSentences(wait: SellWait, symbol: string, referenceAt: bigint): string[] {
  if (wait.reason === 'STALE') {
    return [
      `The Chainlink reference for ${symbol} has not updated since ${formatUtc(referenceAt)}. The pool price can be far from where the market is now, and the price can move once a fresh reference arrives.`,
      'Your cap compares this sell with that old price only. If the fresh price is higher, you will have sold for less than it.',
    ];
  }
  const reopen =
    wait.reopensAt === null
      ? 'When the market reopens, the price can move'
      : `When the market reopens, ${formatNewYork(wait.reopensAt)}, the price can move`;
  return [
    `The Chainlink reference for ${symbol} still shows its last price, from ${formatUtc(referenceAt)}. ${reopen}, sometimes by more than your cap.`,
    'Your cap compares this sell with that last price only. If the market reopens higher, you will have sold for less than the new price.',
  ];
}

/** Steps for the one-off cap of a sell that does not wait (B2-14). The first choice is always the rule's own cap. */
const OVERRIDE_CAP_STEPS_BPS = [100, 200, 300, 500] as const;

export function overrideCapChoices(ruleCapBps: number): number[] {
  const max = RULE_LIMITS.sellOverrideCapBpsMax;
  const wider = OVERRIDE_CAP_STEPS_BPS.filter((bps) => bps > ruleCapBps && bps <= max);
  return ruleCapBps > max ? [...wider] : [ruleCapBps, ...wider];
}

/** Why a guard step stops a sell. The override never skips these (docs/research/prd-questions.md Q29). */
export function sellGuardSentence(reason: Reason, symbol: string): string {
  switch (reason) {
    case 'PAUSED':
      return `The issuer has paused the ${symbol} token, so it cannot be sold through Sleeve until it is unpaused.`;
    case 'ORACLE_PAUSED':
      return `The issuer has flagged price updates for ${symbol} as paused. Selling waits until the flag clears.`;
    case 'MULTIPLIER':
      return `A corporate action changes the ${symbol} multiplier within 24 hours. Selling waits until the change takes effect.`;
    case 'DEPEG':
      return 'The USDG price reference is more than 0.5 percent away from 1 US dollar, or more than 25 hours old. Selling waits until it is back in range.';
    case 'NONE':
      return `A price check for ${symbol} has not cleared yet. Selling waits until it does.`;
    default:
      return `Selling waits: ${REASON_LABEL[reason].toLowerCase()}.`;
  }
}

/** A failed read, in words a person can act on. */
export function readErrorSentence(error: Error): string {
  if (isDataLayerError(error)) {
    if (error.code === 'SourceUnavailable') return 'Sleeve could not reach Robinhood Chain. Try again in a moment.';
    if (error.code === 'NotSignedIn') return 'Sign in first.';
  }
  return 'Try again in a moment.';
}

/** Why a sell did not go through. Each named failure maps to what happened, never to a code. */
export function sellErrorSentence(error: Error, symbol: string): string {
  const wallet = walletSigningFailureText(error);
  if (wallet !== null) return wallet;
  if (!isDataLayerError(error)) return 'Try again in a moment.';
  const detail = error.detail;
  switch (detail.code) {
    case 'SellWaits':
      if (detail.reason === 'STALE') return `The Chainlink reference for ${symbol} went out of date before the sell ran.`;
      return detail.reopensAt === null
        ? 'The market closed before the sell ran.'
        : `The market closed before the sell ran. It reopens ${formatNewYork(detail.reopensAt)}.`;
    case 'DiscountAboveCap':
      return 'The price moved further below the market reference than your cap allows.';
    case 'GuardNotClear':
      return sellGuardSentence(detail.reason, symbol);
    case 'ExceedsLots':
      return 'Your lots no longer cover this amount.';
    case 'AccountBlocked':
      return "The issuer's blocklist includes this account.";
    case 'OverrideCapOutOfRange':
      return `The cap for one sell can be at most ${percentWords(RULE_LIMITS.sellOverrideCapBpsMax)}.`;
    case 'PasskeyCancelled':
      return 'The passkey prompt closed before the sell was signed.';
    case 'NotSignedIn':
      return 'Sign in first.';
    case 'SourceUnavailable':
      return 'Sleeve could not reach Robinhood Chain.';
    default:
      return 'Try again in a moment.';
  }
}

/** The market for the token a sell would move, as the swap card's pill says it. */
export interface MarketState {
  tone: 'open' | 'closed' | 'paused';
  label: string;
  /** When the state changes next, or what it means. */
  detail: string | null;
}

export function marketState(market: TickerMarket | undefined): MarketState | null {
  if (market === undefined) return null;
  if (market.paused) return { tone: 'paused', label: 'Token paused', detail: 'The issuer has paused this token.' };
  if (market.oraclePaused) {
    return { tone: 'paused', label: 'Price updates paused', detail: 'The issuer has flagged its price updates as paused.' };
  }
  if (!market.session.open) {
    return {
      tone: 'closed',
      label: 'Market closed',
      detail: market.session.nextOpenAt === null ? null : `Reopens ${formatNewYork(market.session.nextOpenAt)}`,
    };
  }
  return {
    tone: 'open',
    label: 'Market open',
    detail: market.session.openedAt === null ? null : `Open since ${formatNewYork(market.session.openedAt)}`,
  };
}

/** "1 SPY = 771.16 USDG": the quoted pool price, all in, for one whole token. */
export function quotePriceLine(quote: SellQuote, symbol: string): string {
  return `1 ${symbol} = ${formatUsdg(quote.quote)} USDG`;
}

/** What the swap card's main button says, and whether it sells. Only `sell` is enabled. */
export type SellCta =
  | { kind: 'enter' }
  | { kind: 'fix' }
  | { kind: 'quoting' }
  | { kind: 'retry' }
  | { kind: 'waits'; reason: SellWait['reason'] }
  | { kind: 'blocked'; block: SellBlock }
  | { kind: 'sell'; amount: bigint };

const BLOCKED_CTA: Record<SellBlock['code'], string> = {
  ExceedsLots: 'More than your lots hold',
  DiscountAboveCap: 'Discount is over your cap',
  AccountBlocked: 'Blocked by the issuer',
  GuardNotClear: 'A guard check is not clear',
  OverrideCapOutOfRange: 'That cap is too wide',
};

export function ctaLabel(cta: SellCta, symbol: string): string {
  switch (cta.kind) {
    case 'enter':
      return 'Enter an amount';
    case 'fix':
      return 'Check the amount';
    case 'quoting':
      return 'Getting a quote';
    case 'retry':
      return 'Try the quote again';
    case 'waits':
      return cta.reason === 'SESSION' ? 'Waiting for the market' : 'Waiting for a fresh price';
    case 'blocked':
      return BLOCKED_CTA[cta.block.code];
    case 'sell':
      return `Sell ${tokenText(cta.amount, symbol)}`;
  }
}

/** "Oldest lots first" or "Lot 455, 0.155872 SPY left": one option of the lot picker. */
export function lotOptionLabel(lot: LotView, holding: Holding, symbol: string): string {
  return `Lot ${lot.id}, ${tokenText(lotSellableTokens(lot, holding), symbol)} left`;
}
