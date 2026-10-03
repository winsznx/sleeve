import { describe, expect, it } from 'vitest';

import type { MultiplierHistory, MultiplierUpdate } from '../src/evidence';
import { UNIT_MULTIPLIER, comparePositions, flagAtReceipt, multiplierAtReceipt, multiplierDue } from '../src/history';

const T = 1_791_212_400n;
const DAY = 86_400n;
const OLD = 1_001_000_000_000_000_000n;
const NEW = 1_002_000_000_000_000_000n;

function update(oldMultiplier: bigint, newMultiplier: bigint, effectiveAt: bigint, blockNumber: bigint): MultiplierUpdate {
  return { oldMultiplier, newMultiplier, effectiveAt, position: { blockNumber, logIndex: 0 }, transactionHash: `0x${'aa'.repeat(32)}` };
}

function history(overrides: Partial<MultiplierHistory>): MultiplierHistory {
  return { uiMultiplier: OLD, newUIMultiplier: OLD, effectiveAt: T - DAY, after: [], lastBefore: 'NOT_READ', ...overrides };
}

describe('the multiplier at a receipt', () => {
  it('is newUIMultiplier() now when nothing changed and the last change took effect before', () => {
    const at = multiplierAtReceipt(history({}), T, T + DAY);
    expect(at).toMatchObject({ known: true, value: OLD, pending: null });
  });

  it('is uiMultiplier() now while a change scheduled before the receipt is still pending', () => {
    // #given a change to NEW at T + 2 days, read now at T + 1 day
    const at = multiplierAtReceipt(history({ uiMultiplier: OLD, newUIMultiplier: NEW, effectiveAt: T + 2n * DAY }), T, T + DAY);
    // #then the receipt saw OLD with NEW pending
    expect(at).toMatchObject({ known: true, value: OLD, pending: { newMultiplier: NEW, effectiveAt: T + 2n * DAY } });
  });

  it('needs the scheduling update once a change pending at the receipt has taken effect', () => {
    const pending = history({ uiMultiplier: NEW, newUIMultiplier: NEW, effectiveAt: T + 600n });
    expect(multiplierAtReceipt(pending, T, T + DAY).known).toBe(false);
    const read = multiplierAtReceipt({ ...pending, lastBefore: update(OLD, NEW, T + 600n, 1n) }, T, T + DAY);
    expect(read).toMatchObject({ known: true, value: OLD, pending: { newMultiplier: NEW } });
    expect(multiplierAtReceipt({ ...pending, lastBefore: null }, T, T + DAY).known).toBe(false);
  });

  it('takes the last update before the receipt when updates follow it', () => {
    const later = [update(OLD, NEW, T + 30n * DAY, 10n)];
    expect(multiplierAtReceipt(history({ after: later }), T, T + DAY).known).toBe(false);
    expect(multiplierAtReceipt(history({ after: later, lastBefore: update(UNIT_MULTIPLIER, OLD, T - DAY, 1n) }), T, T + DAY)).toMatchObject({ value: OLD, pending: null });
    expect(multiplierAtReceipt(history({ after: later, lastBefore: null }), T, T + DAY)).toMatchObject({ value: UNIT_MULTIPLIER, pending: null });
  });
});

describe('a multiplier change due at a receipt', () => {
  it('is due inside the window and not past it', () => {
    const pendingSoon = multiplierAtReceipt(history({ uiMultiplier: OLD, newUIMultiplier: NEW, effectiveAt: T + 600n }), T, T + 60n);
    expect(multiplierDue(pendingSoon, T, DAY)).toBe(true);
    const pendingLate = multiplierAtReceipt(history({ uiMultiplier: OLD, newUIMultiplier: NEW, effectiveAt: T + DAY + 1n }), T, T + 60n);
    expect(multiplierDue(pendingLate, T, DAY)).toBe(false);
  });

  it('is not due when the scheduled value equals the current one', () => {
    const same = multiplierAtReceipt(history({ uiMultiplier: OLD, newUIMultiplier: OLD, effectiveAt: T + 600n }), T, T + 60n);
    expect(multiplierDue(same, T, DAY)).toBe(false);
  });

  it('is unknown when the multiplier is', () => {
    expect(multiplierDue({ known: false, basis: 'x' }, T, DAY)).toBeNull();
  });
});

describe('a pause flag at a receipt', () => {
  it('is the flag now with no switch since, and the opposite of the first switch otherwise', () => {
    const at = { blockNumber: 5n, logIndex: 0 };
    expect(flagAtReceipt({ now: true, after: [] })).toBe(true);
    expect(flagAtReceipt({ now: false, after: [{ set: false, position: at, transactionHash: '0x01' }] })).toBe(true);
    expect(flagAtReceipt({ now: true, after: [{ set: true, position: at, transactionHash: '0x01' }] })).toBe(false);
  });
});

describe('log positions', () => {
  it('order by block, then index', () => {
    expect(comparePositions({ blockNumber: 1n, logIndex: 9 }, { blockNumber: 2n, logIndex: 0 })).toBeLessThan(0);
    expect(comparePositions({ blockNumber: 2n, logIndex: 3 }, { blockNumber: 2n, logIndex: 1 })).toBeGreaterThan(0);
    expect(comparePositions({ blockNumber: 2n, logIndex: 1 }, { blockNumber: 2n, logIndex: 1 })).toBe(0);
  });
});
