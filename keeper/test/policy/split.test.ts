import { describe, expect, it } from 'vitest';

import type { SplitPreview } from '../../src/chain/gateway';
import { DUST_FLOOR, OVERRIDE_AGE_SECONDS, decideSplit, waitingSince } from '../../src/policy/split';

const NOW = 1_791_158_460n;
const CEILING = 100_000_000n;

function preview(overrides: Partial<SplitPreview> = {}): SplitPreview {
  return {
    ruleStatus: 'ACTIVE',
    tickerId: 0,
    shortfall: 0n,
    unsorted: 10_000_000n,
    spendPart: 5_000_000n,
    equityPart: 5_000_000n,
    status: 'FILLED',
    reason: 'NONE',
    buy: true,
    publicReadyAt: 0n,
    ...overrides,
  };
}

function decide(overrides: Partial<SplitPreview>, baseFee: bigint, waitedSeconds: bigint | null) {
  return decideSplit({
    preview: preview(overrides),
    baseFeePerGas: baseFee,
    gasCeilingWei: CEILING,
    now: NOW,
    waitingSince: waitedSeconds === null ? null : NOW - waitedSeconds,
  });
}

describe('decideSplit', () => {
  it('splits new income at once under the ceiling', () => {
    // #when
    const decision = decide({}, 22_000_000n, 3n);
    // #then
    expect(decision).toEqual({ kind: 'split', mode: 'SORT', override: null, waitedSeconds: 3n });
  });

  it.each(['PAUSED', 'NONE'] as const)('leaves a %s rule alone, since split would revert RuleNotActive', (ruleStatus) => {
    // #when
    const decision = decide({ ruleStatus, shortfall: 5n }, 22_000_000n, null);
    // #then
    expect(decision).toEqual({ kind: 'none', why: 'RULE_NOT_ACTIVE' });
  });

  it('does nothing with nothing unsorted', () => {
    // #when
    const decision = decide({ unsorted: 0n }, 22_000_000n, null);
    // #then
    expect(decision).toEqual({ kind: 'none', why: 'NOTHING_UNSORTED' });
  });

  it('reconciles an outside pull on every poll, above the ceiling too (A1-29)', () => {
    // #when
    const decision = decide({ unsorted: 0n, shortfall: 150_000_000n }, 5_000_000_000n, null);
    // #then
    expect(decision).toMatchObject({ kind: 'split', mode: 'RECONCILE', override: null });
  });

  describe('the gas ceiling (PRD 7.2)', () => {
    it('holds sorting while the base fee is above it', () => {
      // #when
      const decision = decide({}, CEILING + 1n, 3_600n);
      // #then
      expect(decision).toEqual({ kind: 'hold', why: 'GAS_CEILING', waitedSeconds: 3_600n });
    });

    it('sorts at a base fee equal to it', () => {
      // #when
      const decision = decide({}, CEILING, 0n);
      // #then
      expect(decision.kind).toBe('split');
    });

    it('sorts anyway once a payment has waited 24 hours', () => {
      // #when
      const justUnder = decide({}, CEILING * 10n, OVERRIDE_AGE_SECONDS - 1n);
      const atTheMark = decide({}, CEILING * 10n, OVERRIDE_AGE_SECONDS);
      // #then
      expect(justUnder.kind).toBe('hold');
      expect(atTheMark).toEqual({ kind: 'split', mode: 'SORT', override: 'AGE', waitedSeconds: OVERRIDE_AGE_SECONDS });
    });

    it('holds when it cannot tell how long the payment waited', () => {
      // #when
      const decision = decide({}, CEILING * 10n, null);
      // #then
      expect(decision).toEqual({ kind: 'hold', why: 'GAS_CEILING', waitedSeconds: 0n });
    });
  });

  describe('the dust floor (A1-30)', () => {
    it('waits while unsorted is under 1 USDG', () => {
      // #when
      const decision = decide({ unsorted: DUST_FLOOR - 1n }, 22_000_000n, 60n);
      // #then
      expect(decision).toEqual({ kind: 'hold', why: 'DUST', waitedSeconds: 60n });
    });

    it('splits at 1 USDG', () => {
      // #when
      const decision = decide({ unsorted: DUST_FLOOR }, 22_000_000n, 0n);
      // #then
      expect(decision.kind).toBe('split');
    });

    it('splits dust once it has waited 24 hours', () => {
      // #when
      const decision = decide({ unsorted: 1n }, 22_000_000n, OVERRIDE_AGE_SECONDS);
      // #then
      expect(decision).toEqual({ kind: 'split', mode: 'SORT', override: 'AGE', waitedSeconds: OVERRIDE_AGE_SECONDS });
    });
  });
});

describe('waitingSince', () => {
  it('takes the oldest unsorted payment the index holds', () => {
    // #when
    const since = waitingSince({ oldestPayment: NOW - 500n, firstSeenUnsorted: NOW - 5n, lastSeenEmpty: NOW - 900n });
    // #then
    expect(since).toBe(NOW - 500n);
  });

  it('ignores a payment older than the last time nothing was unsorted: it was spent or sorted since', () => {
    // #when
    const since = waitingSince({ oldestPayment: NOW - 100_000n, firstSeenUnsorted: NOW - 5n, lastSeenEmpty: NOW - 60n });
    // #then
    expect(since).toBe(NOW - 5n);
  });

  it('falls back to when the keeper first saw it before the index has the payment', () => {
    // #when
    const since = waitingSince({ oldestPayment: null, firstSeenUnsorted: NOW - 5n, lastSeenEmpty: null });
    // #then
    expect(since).toBe(NOW - 5n);
  });

  it('is unknown with neither', () => {
    // #when
    const since = waitingSince({ oldestPayment: null, firstSeenUnsorted: null, lastSeenEmpty: null });
    // #then
    expect(since).toBeNull();
  });
});
