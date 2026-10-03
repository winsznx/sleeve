import { exceedsPremium, MODULE_PARAMS, TOTAL_BPS, type Reason, type TickerId } from '@sleeve/core';

import type { FeedReading, TickerMarket } from '@/data/types';

import type { SessionView } from './market-session';

/**
 * What a payment arriving now would do, for the menus' "if a payment arrived now" card. It runs the split and the
 * guard steps of docs/SPEC.md section 9 in their order (PRD 7.4) on the data layer's market snapshot, using the
 * pool quote the snapshot carries in place of a fill. It is a preview: the real split checks the real fill.
 */

export interface PreviewRule {
  equityBps: number;
  tickerId: TickerId;
  premiumCapBps: number;
  minClip: bigint;
}

export type PaydayOutcome =
  | { kind: 'buys' }
  | { kind: 'waits'; reason: Exclude<Reason, 'NONE'>; until: bigint | null }
  | { kind: 'refused' };

export interface PaydayPreview {
  amount: bigint;
  spend: bigint;
  equity: bigint;
  /** Null when the rule sends nothing to equity, so there is nothing to buy or wait. */
  outcome: PaydayOutcome | null;
}

const ONE_DOLLAR = 100_000_000n;
const BPS = BigInt(TOTAL_BPS);

/** LedgerMath.splitShares: the equity part rounds down, so any dust stays spendable. */
export function splitAmount(amount: bigint, equityBps: number): { spend: bigint; equity: bigint } {
  const equity = (amount * BigInt(equityBps)) / BPS;
  return { spend: amount - equity, equity };
}

function feedIsStale(feed: FeedReading, openedAt: bigint | null, now: bigint): boolean {
  if (feed.answer <= 0n || feed.updatedAt > now) return true;
  if (now - feed.updatedAt > MODULE_PARAMS.stockFeedMaxAgeSeconds) return true;
  return openedAt !== null && feed.updatedAt < openedAt;
}

function usdgIsOff(usdgUsd: FeedReading, now: bigint): boolean {
  if (usdgUsd.answer <= 0n || now - usdgUsd.updatedAt > MODULE_PARAMS.usdgFeedMaxAgeSeconds) return true;
  const gap = usdgUsd.answer > ONE_DOLLAR ? usdgUsd.answer - ONE_DOLLAR : ONE_DOLLAR - usdgUsd.answer;
  return gap * BPS > ONE_DOLLAR * BigInt(MODULE_PARAMS.depegToleranceBps);
}

function multiplierIsDue(market: TickerMarket, now: bigint): boolean {
  const pending = market.pendingMultiplier;
  if (pending === null || pending.value === market.uiMultiplier) return false;
  return pending.effectiveAt > now && pending.effectiveAt <= now + MODULE_PARAMS.multiplierWindowSeconds;
}

function outcomeOf(
  equity: bigint,
  rule: PreviewRule,
  market: TickerMarket,
  usdgUsd: FeedReading,
  session: SessionView,
  now: bigint,
): PaydayOutcome {
  if (!market.active) return { kind: 'refused' };
  if (market.paused) return { kind: 'waits', reason: 'PAUSED', until: null };
  if (market.oraclePaused) return { kind: 'waits', reason: 'ORACLE_PAUSED', until: null };
  if (session.state !== 'open') {
    return { kind: 'waits', reason: 'SESSION', until: session.state === 'closed' ? session.opensAt : null };
  }
  if (multiplierIsDue(market, now)) return { kind: 'waits', reason: 'MULTIPLIER', until: market.pendingMultiplier?.effectiveAt ?? null };
  if (feedIsStale(market.feed, session.openedAt, now)) return { kind: 'waits', reason: 'STALE', until: null };
  if (usdgIsOff(usdgUsd, now)) return { kind: 'waits', reason: 'DEPEG', until: null };
  if (equity < rule.minClip) return { kind: 'waits', reason: 'CLIP', until: null };
  const pool = market.poolPrice;
  if (pool !== null && pool.tokensOut > 0n && exceedsPremium(pool.usdgIn, pool.tokensOut, market.feed.answer, rule.premiumCapBps)) {
    return { kind: 'waits', reason: 'PREMIUM', until: null };
  }
  return { kind: 'buys' };
}

export function previewPayday(
  amount: bigint,
  rule: PreviewRule,
  market: TickerMarket,
  usdgUsd: FeedReading,
  session: SessionView,
  now: bigint,
): PaydayPreview {
  const { spend, equity } = splitAmount(amount, rule.equityBps);
  if (equity === 0n) return { amount, spend, equity, outcome: null };
  return { amount, spend, equity, outcome: outcomeOf(equity, rule, market, usdgUsd, session, now) };
}
