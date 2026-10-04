import type { SplitPreview } from '../chain/gateway';

/**
 * When the keeper splits (PRD 7.2, D-009 Q35, audit A1-29 and A1-30). Keeper policy only: none of it changes an
 * onchain rule, and the owner and, after the grace, anyone can still split.
 */

/**
 * Below this much unsorted USDG the keeper waits (audit A1-30): one base unit would otherwise buy a full receipt
 * with the keeper's gas. It is SPEC 8's OBSERVE_RESTART_GROWTH, the growth that restarts the public clock, so forcing
 * a keeper split costs the sender at least what it pays the owner.
 */
export const DUST_FLOOR = 1_000_000n;

/** PRD 7.2: sort anyway once a payment has waited this long, above the gas ceiling or under the dust floor. */
export const OVERRIDE_AGE_SECONDS = 86_400n;

export type SplitDecision =
  | { kind: 'none'; why: 'RULE_NOT_ACTIVE' | 'NOTHING_UNSORTED' }
  | { kind: 'hold'; why: 'DUST' | 'GAS_CEILING'; waitedSeconds: bigint }
  | { kind: 'split'; mode: 'RECONCILE' | 'SORT'; override: 'AGE' | null; waitedSeconds: bigint };

export interface SplitInputs {
  preview: SplitPreview;
  baseFeePerGas: bigint;
  gasCeilingWei: bigint;
  /** Chain time: the head block's timestamp. */
  now: bigint;
  /** Chain time since when the unsorted USDG has waited (waitingSince), or null when unknown. */
  waitingSince: bigint | null;
}

export function decideSplit(inputs: SplitInputs): SplitDecision {
  const { preview } = inputs;
  // split reverts RuleNotActive for a paused or unset rule, before it reconciles anything (SPEC 6, 9).
  if (preview.ruleStatus !== 'ACTIVE') return { kind: 'none', why: 'RULE_NOT_ACTIVE' };
  const since = inputs.waitingSince;
  const waited = since === null || since > inputs.now ? 0n : inputs.now - since;
  // An outside pull the ledgers have not booked: reconcile on every poll, before income can be netted against it
  // (A1-29). It sorts nothing, so the sorting ceiling does not hold it.
  if (preview.shortfall > 0n) return { kind: 'split', mode: 'RECONCILE', override: null, waitedSeconds: waited };
  if (preview.unsorted === 0n) return { kind: 'none', why: 'NOTHING_UNSORTED' };
  const aged = waited >= OVERRIDE_AGE_SECONDS;
  if (preview.unsorted < DUST_FLOOR && !aged) return { kind: 'hold', why: 'DUST', waitedSeconds: waited };
  const aboveCeiling = inputs.baseFeePerGas > inputs.gasCeilingWei;
  if (aboveCeiling && !aged) return { kind: 'hold', why: 'GAS_CEILING', waitedSeconds: waited };
  return {
    kind: 'split',
    mode: 'SORT',
    override: aged && (aboveCeiling || preview.unsorted < DUST_FLOOR) ? 'AGE' : null,
    waitedSeconds: waited,
  };
}

export interface WaitingSinceInputs {
  /** Block timestamp of the oldest indexed payment of the current install that no split has sorted. */
  oldestPayment: bigint | null;
  /** Chain time the keeper first saw unsorted USDG since it last saw none. */
  firstSeenUnsorted: bigint | null;
  /** Chain time the keeper last saw no unsorted USDG on the account. */
  lastSeenEmpty: bigint | null;
}

/**
 * Since when the account's unsorted USDG has waited. A payment older than the last time the account had nothing
 * unsorted was sorted or spent since, so it does not count: the index keeps such payments unsorted forever when the
 * owner spends income before any split (supabase/README.md, limits).
 */
export function waitingSince(inputs: WaitingSinceInputs): bigint | null {
  const floor = inputs.lastSeenEmpty;
  const candidates = [inputs.oldestPayment, inputs.firstSeenUnsorted].filter(
    (time): time is bigint => time !== null && (floor === null || time >= floor),
  );
  if (candidates.length === 0) return inputs.firstSeenUnsorted;
  return candidates.reduce((earliest, time) => (time < earliest ? time : earliest));
}
