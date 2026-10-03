import { exceedsPremium, PriceMathError, type Receipt } from '@sleeve/core';

import { stockRound, usdgRound, type Context } from './context';
import { multiplierDue } from './history';

/**
 * The guard of PRD 7.4 re-run at a receipt's timestamp from chain data, one condition at a time, mirroring
 * PriceGuard.checkBuy and the module's step order (SPEC 9 and 10). Each condition says whether it failed, or why it
 * could not be judged.
 */

export type Judgement = { known: true; failed: boolean; detail: string } | { known: false; why: string };

function judged(failed: boolean, detail: string): Judgement {
  return { known: true, failed, detail };
}

/** Guard step 1: the ticker was active at the receipt and has a feed. Removal is one way, so active now means active then. */
export function tickerRefused(ctx: Context): Judgement {
  const ticker = ctx.ev.ticker;
  if (ticker === null) return { known: false, why: 'TokenSource.ticker was not read' };
  if (!ticker.ok) return { known: false, why: `TokenSource.ticker failed: ${ticker.error}` };
  const activeThen = ticker.value.active || ctx.ev.tickerRemovedAfter === true;
  if (!activeThen) return judged(true, 'removed from TokenSource before the receipt');
  if (/^0x0{40}$/i.test(ticker.value.feed)) return judged(true, 'listed without a feed');
  return judged(false, 'active with a feed');
}

export function pausedAt(ctx: Context): Judgement {
  if (ctx.paused === null) return { known: false, why: 'the token history was not read' };
  return judged(ctx.paused, ctx.paused ? 'paused' : 'not paused');
}

export function oraclePausedAt(ctx: Context): Judgement {
  if (ctx.oraclePaused === null) return { known: false, why: 'the token history was not read' };
  return judged(ctx.oraclePaused, ctx.oraclePaused ? 'oracle paused' : 'oracle not paused');
}

export function sessionClosedAt(ctx: Context): Judgement {
  if (ctx.session === null) return { known: false, why: "the ticker's session type was not read" };
  if (!ctx.session.ok) return { known: false, why: ctx.session.error };
  const { open, reason } = ctx.session.value;
  return judged(!open, open ? 'open' : `closed (${reason})`);
}

export function multiplierDueAt(ctx: Context): Judgement {
  if (ctx.multiplier === null) return { known: false, why: 'the token history was not read' };
  const due = multiplierDue(ctx.multiplier, ctx.t, ctx.ev.guardParams.multiplierWindow);
  if (due === null) return { known: false, why: ctx.multiplier.known ? 'unknown' : ctx.multiplier.basis };
  return judged(due, due ? 'a change takes effect inside the window' : 'no change due inside the window');
}

/** The session's opening instant at the receipt, for the fresh-round check. */
export function openedAtReceipt(ctx: Context): bigint | null {
  if (ctx.session === null || !ctx.session.ok) return null;
  return ctx.session.value.openedAt;
}

/**
 * Guard step 6 on the round the receipt names, re-read with getRoundData: STALE when the answer is not positive, the
 * round is from after the receipt, older than the maximum age, or observed or transmitted before the session opened.
 * With the sell override only the first two apply (SPEC 12).
 */
export function staleAt(ctx: Context, override: boolean): Judgement {
  const round = stockRound(ctx);
  if (!round.ok) return { known: false, why: round.error };
  const { answer, startedAt, updatedAt } = round.value;
  const t = ctx.t;
  if (answer <= 0n) return judged(true, 'answer not positive');
  if (updatedAt > t) return judged(true, 'round from after the receipt');
  if (override) return judged(false, 'positive and not from the future');
  if (t - updatedAt > ctx.ev.guardParams.stockFeedMaxAge) return judged(true, 'older than the maximum age');
  const openedAt = openedAtReceipt(ctx);
  if (openedAt === null) return { known: false, why: 'the session was not open, so it has no opening instant' };
  if (updatedAt < openedAt || startedAt < openedAt) return judged(true, 'observed or sent before the session opened');
  return judged(false, 'fresh');
}

/** Guard step 7, PriceGuard.checkUsdg: the USDG/USD answer within 1 plus or minus the tolerance, and fresh. */
export function depegAt(ctx: Context): Judgement {
  const round = usdgRound(ctx);
  if (!round.ok) return { known: false, why: round.error };
  const decimals = ctx.ev.decimals.usdgFeed;
  if (!decimals.ok) return { known: false, why: `USDG/USD decimals(): ${decimals.error}` };
  const { answer, updatedAt } = round.value;
  const t = ctx.t;
  if (answer <= 0n || updatedAt > t || t - updatedAt > ctx.ev.guardParams.usdgFeedMaxAge) {
    return judged(true, 'not positive, from the future or too old');
  }
  return judged(!usdgWithinBand(answer, decimals.value, ctx.ev.guardParams.depegToleranceBps), 'band');
}

const BPS = 10_000n;

export function usdgBand(decimals: number, toleranceBps: number): { low: bigint; high: bigint } {
  const one = 10n ** BigInt(decimals);
  const tolerance = BigInt(toleranceBps);
  return { low: (one * (BPS - tolerance)) / BPS, high: (one * (BPS + tolerance)) / BPS };
}

/** Both edges pass, at the feed's decimals, as checkUsdg compares price * 10,000 with one * (10,000 -+ tolerance). */
export function usdgWithinBand(answer: bigint, decimals: number, toleranceBps: number): boolean {
  const one = 10n ** BigInt(decimals);
  const tolerance = BigInt(toleranceBps);
  if (answer > 2n * one) return false;
  const scaled = answer * BPS;
  return scaled >= one * (BPS - tolerance) && scaled <= one * (BPS + tolerance);
}

/** What the guard would have written, as "STATUS" or "QUEUED REASON", or why the replay stopped. */
export type Replay =
  | { kind: 'outcome'; outcome: string; basis: string }
  | { kind: 'stopped'; why: string }
  /** The receipt says REFUSED_ACCOUNT, and the blocklist at the receipt is not re-read. */
  | { kind: 'blocklist' };

/** The outcome a receipt records, in the replay's terms. */
export function recordedOutcome(r: Receipt): string {
  if (r.status === 'QUEUED') return `QUEUED ${r.reason}`;
  return r.status;
}

const TIMING_STEPS = [
  ['PAUSED', pausedAt],
  ['ORACLE_PAUSED', oraclePausedAt],
  ['SESSION', sessionClosedAt],
  ['MULTIPLIER', multiplierDueAt],
] as const;

/**
 * Re-runs the guard for a split or settle receipt that did not buy: steps 1 and 2, the timing steps, the clip, and
 * the premium of the undone swap a QUEUED PREMIUM receipt records. A split queues on a failing timing step, and a
 * settle reverts on one, so for a settle receipt the replay names the revert.
 */
export function replayGuard(ctx: Context): Replay {
  const { r, kind } = ctx;
  const settle = kind === 'SETTLE_REFUSAL' || kind === 'SETTLE_FILL';
  const amount = r.usdgToEquity;
  if (!settle && amount === 0n) return { kind: 'outcome', outcome: 'QUEUED CLIP', basis: 'a zero equity part runs no guard' };

  const ticker = tickerRefused(ctx);
  if (!ticker.known) return { kind: 'stopped', why: ticker.why };
  if (ticker.failed) return { kind: 'outcome', outcome: 'REFUSED_TICKER', basis: ticker.detail };
  if (r.status === 'REFUSED_ACCOUNT') return { kind: 'blocklist' };

  const rule = ctx.rule;
  if (rule === null) return { kind: 'stopped', why: ctx.ruleProblem ?? 'no rule' };
  // A settle refuses a bucket below the clip before it looks at timing (SPEC 10 step 5); a split queues CLIP after it.
  if (settle && amount < rule.minClip) {
    return { kind: 'outcome', outcome: 'reverts BelowClip', basis: `below the ${rule.minClip} clip` };
  }
  const queue = (reason: string): string => (settle ? `reverts GuardNotClear(${reason})` : `QUEUED ${reason}`);
  for (const [reason, judge] of TIMING_STEPS) {
    const judgement = judge(ctx);
    if (!judgement.known) return { kind: 'stopped', why: `${reason}: ${judgement.why}` };
    if (judgement.failed) return { kind: 'outcome', outcome: queue(reason), basis: judgement.detail };
  }
  const stale = staleAt(ctx, false);
  if (!stale.known) return { kind: 'stopped', why: `STALE: ${stale.why}` };
  if (stale.failed) return { kind: 'outcome', outcome: queue('STALE'), basis: stale.detail };
  const depeg = depegAt(ctx);
  if (!depeg.known) return { kind: 'stopped', why: `DEPEG: ${depeg.why}` };
  if (depeg.failed) return { kind: 'outcome', outcome: queue('DEPEG'), basis: depeg.detail };

  if (!settle && amount < rule.minClip) {
    return { kind: 'outcome', outcome: 'QUEUED CLIP', basis: `below the ${rule.minClip} clip` };
  }
  if (!settle && r.status === 'QUEUED' && r.reason === 'PREMIUM') {
    const over = r.premiumBps > BigInt(rule.premiumCapBps);
    return over
      ? { kind: 'outcome', outcome: 'QUEUED PREMIUM', basis: `the undone swap's premium is above the ${rule.premiumCapBps} bps cap` }
      : { kind: 'outcome', outcome: 'FILLED', basis: `the undone swap's premium is within the ${rule.premiumCapBps} bps cap` };
  }
  return { kind: 'outcome', outcome: settle ? 'SETTLED' : 'FILLED', basis: 'every guard step passed' };
}

/** Whether a buy's fill paid more than the cap above the round's answer, or why that cannot be judged. */
export function premiumExceeded(ctx: Context, usdgSpent: bigint, tokensOut: bigint, capBps: number): Judgement {
  const round = stockRound(ctx);
  if (!round.ok) return { known: false, why: round.error };
  if (!ctx.decimals.ok) return { known: false, why: ctx.decimals.error };
  try {
    return judged(exceedsPremium(usdgSpent, tokensOut, round.value.answer, capBps, ctx.decimals.value), 'premium');
  } catch (error) {
    if (error instanceof PriceMathError) return { known: false, why: `${error.code}: ${error.message}` };
    throw error;
  }
}
