import { describe, expect, it } from 'vitest';

import type { FeedRound, SettlePreview } from '../../src/chain/gateway';
import { sessionView } from '../../src/keeper';
import {
  SETTLE_TIMING,
  type SettleDueInputs,
  type SettleMemory,
  freshAfterOpening,
  planSettle,
  settleEvaluationDue,
} from '../../src/policy/settle';

/** Sunday 4 October 2026 20:00 EDT, the ALL_DAY reopen after the weekend. */
const REOPEN = 1_791_158_400n;
const SATURDAY = REOPEN - 25n * 3_600n;
const BUCKET = { amount: 5_000_000n, since: SATURDAY };

function round(roundId: bigint, at: bigint): FeedRound {
  return { roundId, answer: 77_071_210_575n, startedAt: at, updatedAt: at + 12n };
}

function memory(overrides: Partial<SettleMemory>): SettleMemory {
  return {
    at: REOPEN - 3_000n,
    amount: BUCKET.amount,
    since: BUCKET.since,
    ruleVersion: 1,
    outcome: 'SESSION',
    roundId: 100n,
    sessionOpen: false,
    ...overrides,
  };
}

function due(overrides: Partial<SettleDueInputs>): ReturnType<typeof settleEvaluationDue> {
  return settleEvaluationDue({
    bucket: BUCKET,
    ruleVersion: 1,
    memory: memory({}),
    now: REOPEN + 60n,
    session: sessionView('ALL_DAY', REOPEN + 60n),
    round: round(101n, REOPEN + 30n),
    ...overrides,
  });
}

describe('sessionView', () => {
  it('reads the packages/core calendar: closed on Saturday, open from the Sunday 20:00 reopen', () => {
    // #when
    const views = [sessionView('ALL_DAY', SATURDAY), sessionView('ALL_DAY', REOPEN - 1n), sessionView('ALL_DAY', REOPEN)];
    // #then
    expect(views).toEqual([
      { open: false, openedAt: null },
      { open: false, openedAt: null },
      { open: true, openedAt: REOPEN },
    ]);
  });
});

describe('freshAfterOpening', () => {
  it('needs a round observed and transmitted at or after the opening (A1-10)', () => {
    // #given
    const session = { open: true, openedAt: REOPEN };
    // #when
    const answers = [
      freshAfterOpening({ roundId: 1n, answer: 1n, startedAt: REOPEN - 12n, updatedAt: REOPEN + 1n }, session),
      freshAfterOpening({ roundId: 1n, answer: 1n, startedAt: REOPEN, updatedAt: REOPEN }, session),
      freshAfterOpening(null, session),
    ];
    // #then
    expect(answers).toEqual([false, true, false]);
  });
});

describe('settleEvaluationDue', () => {
  it('looks at a bucket it has not seen', () => {
    // #when
    const answer = due({ memory: undefined });
    // #then
    expect(answer).toEqual({ due: true, why: 'first look' });
  });

  it('looks again when the bucket or the rule changed', () => {
    // #when
    const answers = [
      due({ memory: memory({ amount: 1n, at: REOPEN + 50n }) }).due,
      due({ memory: memory({ since: 1n, at: REOPEN + 50n }) }).due,
      due({ ruleVersion: 2, memory: memory({ at: REOPEN + 50n }) }).due,
    ];
    // #then
    expect(answers).toEqual([true, true, true]);
  });

  it('waits while the session is closed', () => {
    // #when
    const answer = due({ now: SATURDAY + 60n, session: sessionView('ALL_DAY', SATURDAY + 60n), memory: memory({ at: SATURDAY }) });
    // #then
    expect(answer).toEqual({ due: false, why: 'session closed' });
  });

  it('refreshes even a closed session every five minutes', () => {
    // #when
    const answer = due({
      now: SATURDAY + SETTLE_TIMING.refreshSeconds,
      session: { open: false, openedAt: null },
      memory: memory({ at: SATURDAY }),
    });
    // #then
    expect(answer).toEqual({ due: true, why: 'refresh' });
  });

  it('waits at the reopen until the first round after the opening arrives', () => {
    // #when
    const answer = due({ now: REOPEN + 20n, session: sessionView('ALL_DAY', REOPEN + 20n), round: round(100n, REOPEN - 3_600n), memory: memory({ at: REOPEN - 10n }) });
    // #then
    expect(answer).toEqual({ due: false, why: 'waiting for the first round after the opening' });
  });

  it('settles at the reopen once a fresh round is in', () => {
    // #when
    const answer = due({ memory: memory({ at: REOPEN - 10n }) });
    // #then
    expect(answer).toEqual({ due: true, why: 'session opened with a fresh round' });
  });

  it('retries STALE only on a new round', () => {
    // #given
    const stale = memory({ at: REOPEN + 40n, outcome: 'STALE', roundId: 101n, sessionOpen: true });
    // #when
    const answers = [due({ memory: stale }).due, due({ memory: stale, round: round(102n, REOPEN + 50n) }).due];
    // #then
    expect(answers).toEqual([false, true]);
  });

  it('retries PREMIUM on a new round or after 30 seconds, since pool moves clear it too', () => {
    // #given
    const premium = memory({ at: REOPEN + 50n, outcome: 'PREMIUM', roundId: 101n, sessionOpen: true });
    // #when
    const answers = [
      due({ memory: premium, now: REOPEN + 60n }).due,
      due({ memory: premium, now: REOPEN + 60n, round: round(102n, REOPEN + 55n) }).due,
      due({ memory: premium, now: REOPEN + 50n + SETTLE_TIMING.premiumRetrySeconds }).due,
    ];
    // #then
    expect(answers).toEqual([false, true, true]);
  });

  it('leaves a below-clip bucket until it changes', () => {
    // #when
    const answer = due({ memory: memory({ at: REOPEN + 50n, outcome: 'CLIP', sessionOpen: true }) });
    // #then
    expect(answer).toEqual({ due: false, why: 'below the clip' });
  });

  it('retries a SESSION the chain calendar reported while the port said open, once a minute', () => {
    // #given
    const closure = memory({ at: REOPEN + 50n, outcome: 'SESSION', sessionOpen: true });
    // #when
    const answers = [due({ memory: closure }).due, due({ memory: closure, now: REOPEN + 50n + SETTLE_TIMING.retrySeconds }).due];
    // #then
    expect(answers).toEqual([false, true]);
  });

  it('retries PAUSED, DEPEG and failed sends once a minute', () => {
    // #when
    const answers = (['PAUSED', 'DEPEG', 'FAILED'] as const).map((outcome) => [
      due({ memory: memory({ at: REOPEN + 30n, outcome, sessionOpen: true }), now: REOPEN + 60n }).due,
      due({ memory: memory({ at: REOPEN + 30n, outcome, sessionOpen: true }), now: REOPEN + 90n }).due,
    ]);
    // #then
    expect(answers).toEqual([
      [false, true],
      [false, true],
      [false, true],
    ]);
  });

  it('skips an empty bucket', () => {
    // #when
    const answer = due({ bucket: { amount: 0n, since: 0n } });
    // #then
    expect(answer.due).toBe(false);
  });
});

function preview(overrides: Partial<SettlePreview>): SettlePreview {
  return {
    ruleStatus: 'ACTIVE',
    amount: 5_000_000n,
    since: SATURDAY,
    bucketReason: 'SESSION',
    minClip: 1_000_000n,
    status: 'SETTLED',
    reason: 'SESSION',
    buy: true,
    publicReadyAt: REOPEN + 3_600n,
    shortfall: 0n,
    ...overrides,
  };
}

describe('planSettle', () => {
  it('settles when the preview clears the guard', () => {
    // #when
    const plan = planSettle(preview({}));
    // #then
    expect(plan).toEqual({ kind: 'settle', expect: 'SETTLED' });
  });

  it.each(['REFUSED_TICKER', 'REFUSED_ACCOUNT'] as const)('settles a %s bucket into spend at any size', (status) => {
    // #when
    const plan = planSettle(preview({ status, buy: false, amount: 1n }));
    // #then
    expect(plan).toEqual({ kind: 'settle', expect: status });
  });

  it.each(['SESSION', 'STALE', 'CLIP', 'PAUSED', 'MULTIPLIER', 'DEPEG'] as const)('waits on QUEUED %s', (reason) => {
    // #when
    const plan = planSettle(preview({ status: 'QUEUED', reason, buy: false }));
    // #then
    expect(plan).toEqual({ kind: 'wait', reason });
  });

  it('leaves an unreconciled pull to the split (I-02)', () => {
    // #when
    const plan = planSettle(preview({ status: 'QUEUED', reason: 'NONE', shortfall: 7n, buy: false }));
    // #then
    expect(plan).toEqual({ kind: 'skip', why: 'SHORTFALL' });
  });

  it('leaves a paused rule alone', () => {
    // #when
    const plan = planSettle(preview({ ruleStatus: 'PAUSED' }));
    // #then
    expect(plan).toEqual({ kind: 'skip', why: 'RULE_NOT_ACTIVE' });
  });
});
