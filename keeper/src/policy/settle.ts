import type { Reason } from '@sleeve/core';

import type { FeedRound, SettlePreview } from '../chain/gateway';

/**
 * When the keeper looks at a waiting bucket again, and what previewSettle says to do with it (PRD 7.4, SPEC 10).
 * settle buys a whole bucket when the guard clears; the keeper calls it at each session open once the first fresh
 * round arrives, and again when new rounds arrive, and the module's own simulation stays the authority.
 */

export type WaitReason = Exclude<Reason, 'NONE'>;

/** What the last look at a bucket found. FAILED is a settle that was tried and did not land. */
export type SettleOutcome = WaitReason | 'FAILED';

export interface SettleMemory {
  /** Chain time of the look. */
  at: bigint;
  amount: bigint;
  since: bigint;
  ruleVersion: number;
  outcome: SettleOutcome;
  /** The ticker feed's round id at the look. */
  roundId: bigint | null;
  /** Whether the packages/core calendar had the session open at the look. */
  sessionOpen: boolean;
}

/** The ticker's session from the packages/core calendar at the head's time. */
export interface SessionView {
  open: boolean;
  /** The start of the open stretch (sessionOpenedAt), null while closed. */
  openedAt: bigint | null;
}

export interface SettleTiming {
  /** Look again at least this often whatever happened, which also refreshes bucket_waits. */
  refreshSeconds: bigint;
  /** Retry for reasons a new round does not clear: PAUSED, ORACLE_PAUSED, MULTIPLIER, DEPEG, a failed send. */
  retrySeconds: bigint;
  /** PREMIUM also clears when the pool moves, which no round announces. */
  premiumRetrySeconds: bigint;
}

export const SETTLE_TIMING: SettleTiming = { refreshSeconds: 300n, retrySeconds: 60n, premiumRetrySeconds: 30n };

export interface SettleDueInputs {
  bucket: { amount: bigint; since: bigint };
  ruleVersion: number;
  memory: SettleMemory | undefined;
  now: bigint;
  session: SessionView;
  round: FeedRound | null;
  timing?: SettleTiming;
}

export interface SettleDue {
  due: boolean;
  why: string;
}

const due = (why: string): SettleDue => ({ due: true, why });
const notDue = (why: string): SettleDue => ({ due: false, why });

/**
 * A round observed and transmitted at or after the session's opening (B2-2, audit A1-10). Before one arrives the
 * guard reads STALE, so there is nothing to ask the module.
 */
export function freshAfterOpening(round: FeedRound | null, session: SessionView): boolean {
  if (round === null || !session.open || session.openedAt === null) return false;
  return round.startedAt >= session.openedAt && round.updatedAt >= session.openedAt;
}

export function settleEvaluationDue(inputs: SettleDueInputs): SettleDue {
  const timing = inputs.timing ?? SETTLE_TIMING;
  const { memory, bucket } = inputs;
  if (bucket.amount === 0n) return notDue('empty bucket');
  if (memory === undefined) return due('first look');
  if (memory.amount !== bucket.amount || memory.since !== bucket.since || memory.ruleVersion !== inputs.ruleVersion) {
    return due('bucket or rule changed');
  }
  const age = inputs.now - memory.at;
  if (age >= timing.refreshSeconds) return due('refresh');
  if (!inputs.session.open) return notDue('session closed');
  if (!freshAfterOpening(inputs.round, inputs.session)) return notDue('waiting for the first round after the opening');
  const newRound = inputs.round !== null && inputs.round.roundId !== memory.roundId;
  switch (memory.outcome) {
    case 'SESSION':
      // SESSION while the port said open means the chain calendar knows a closure the port does not.
      if (!memory.sessionOpen) return due('session opened with a fresh round');
      return age >= timing.retrySeconds ? due('retry') : notDue('closed onchain');
    case 'STALE':
      return newRound ? due('new round') : notDue('no new round');
    case 'PREMIUM':
      if (newRound) return due('new round');
      return age >= timing.premiumRetrySeconds ? due('retry premium') : notDue('premium above the cap');
    case 'CLIP':
      return notDue('below the clip');
    default:
      return age >= timing.retrySeconds ? due('retry') : notDue(`waiting on ${memory.outcome}`);
  }
}

export type SettlePlan =
  | { kind: 'skip'; why: 'RULE_NOT_ACTIVE' | 'EMPTY' | 'SHORTFALL' | 'UNEXPECTED_PREVIEW' }
  | { kind: 'wait'; reason: WaitReason }
  | { kind: 'settle'; expect: 'SETTLED' | 'REFUSED_TICKER' | 'REFUSED_ACCOUNT' };

/** What to do with a bucket, from previewSettle, which follows settle's own order (SPEC 15). */
export function planSettle(preview: SettlePreview): SettlePlan {
  // settle reverts RuleNotActive for a paused or unset rule; the owner can still release (SPEC 6).
  if (preview.ruleStatus !== 'ACTIVE') return { kind: 'skip', why: 'RULE_NOT_ACTIVE' };
  if (preview.amount === 0n) return { kind: 'skip', why: 'EMPTY' };
  // settle reverts LedgersAboveBalance until a split reconciles the outside pull (audit I-02); the split comes first.
  if (preview.shortfall > 0n) return { kind: 'skip', why: 'SHORTFALL' };
  if (preview.status === 'REFUSED_TICKER' || preview.status === 'REFUSED_ACCOUNT') {
    return { kind: 'settle', expect: preview.status };
  }
  if (preview.status === 'SETTLED' && preview.buy) return { kind: 'settle', expect: 'SETTLED' };
  if (preview.status === 'QUEUED' && preview.reason !== 'NONE') return { kind: 'wait', reason: preview.reason };
  return { kind: 'skip', why: 'UNEXPECTED_PREVIEW' };
}
