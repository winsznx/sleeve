import { RULE_DEFAULTS } from '@sleeve/core';
import { describe, expect, it } from 'vitest';

import type { FeedReading, TickerMarket } from '@/data/types';

import type { SessionView } from './market-session';
import { previewPayday, splitAmount } from './payday-preview';
import { equityLine, verdictSentence } from './payday-words';

const NOW = 1_790_600_000n;
const OPENED = 1_790_553_600n;
const OPEN: SessionView = { state: 'open', openedAt: OPENED, closesAt: 1_790_985_600n };
const CLOSED: SessionView = { state: 'closed', reason: 'WEEKEND', opensAt: OPENED };
const PAYMENT = 500_000_000n;
/** 770.00 USD per token, 8 decimals. */
const ANSWER = 77_000_000_000n;

const USDG_AT_PAR: FeedReading = {
  feed: '0x61B7e5650328764B076A108EFF5fa7282a1B9aD2',
  roundId: 7n,
  answer: 100_000_000n,
  updatedAt: NOW - 600n,
};

/** A market whose pool sells 100 USDG of the token at `premiumBps` over the feed. */
function market(overrides: Partial<TickerMarket> = {}, premiumBps = 10n): TickerMarket {
  const usdgIn = 100_000_000n;
  // PriceGuard prices 1e18 token units in 1e8 feed units against 1e6 USDG units, so the premium is
  // usdg * 1e24 / (tokens * answer) - 1e4 basis points; solve that for tokens.
  const tokensOut = (usdgIn * 10n ** 24n) / (ANSWER * (10_000n + premiumBps));
  return {
    tickerId: 0,
    active: true,
    session: { open: true, reason: 'OPEN', openedAt: OPENED, nextOpenAt: null },
    feed: { feed: '0x319724394D3A0e3669269846abE664Cd621f9f6A', roundId: 3n, answer: ANSWER, updatedAt: OPENED + 41n },
    uiMultiplier: 10n ** 18n,
    pendingMultiplier: null,
    paused: false,
    oraclePaused: false,
    poolPrice: { pool: '0xa7Bb1AC63BBaB0C44316E6c8C455213441689167', usdgIn, tokensOut, execPrice: 0n, at: { l2Block: 1n, timestamp: NOW } },
    ...overrides,
  };
}

describe('the split a payment would get', () => {
  it('keeps the dust spendable, as LedgerMath does', () => {
    expect(splitAmount(PAYMENT, 1_000)).toEqual({ spend: 450_000_000n, equity: 50_000_000n });
    expect(splitAmount(1n, 3_333)).toEqual({ spend: 1n, equity: 0n });
    expect(splitAmount(7n, 5_000)).toEqual({ spend: 4n, equity: 3n });
  });

  it('has no equity outcome when the rule sends nothing to equity', () => {
    const preview = previewPayday(PAYMENT, { ...RULE_DEFAULTS, equityBps: 0 }, market(), USDG_AT_PAR, OPEN, NOW);
    expect(preview).toMatchObject({ spend: PAYMENT, equity: 0n, outcome: null });
    expect(verdictSentence(preview.outcome, 'SPY', 100)).toBe('A payment that arrives now stays spendable in full.');
  });
});

describe('the guard steps, in order', () => {
  it('buys while the market is open and the pool sits inside the cap', () => {
    const preview = previewPayday(PAYMENT, RULE_DEFAULTS, market(), USDG_AT_PAR, OPEN, NOW);
    expect(preview.outcome).toEqual({ kind: 'buys' });
    expect(equityLine({ kind: 'buys' }, 'SPY', 100)).toBe('would buy SPY now');
  });

  it('waits for the open while the market is closed, and says until when', () => {
    const preview = previewPayday(PAYMENT, RULE_DEFAULTS, market(), USDG_AT_PAR, CLOSED, NOW);
    expect(preview.outcome).toEqual({ kind: 'waits', reason: 'SESSION', until: OPENED });
    if (preview.outcome === null) throw new Error('expected an outcome');
    expect(equityLine(preview.outcome, 'SPY', 100)).toBe('would wait as USDG until Sun 27 Sep, 20:00 New York time');
  });

  it('waits when the pool is more than the cap above the reference', () => {
    const preview = previewPayday(PAYMENT, RULE_DEFAULTS, market({}, 150n), USDG_AT_PAR, OPEN, NOW);
    expect(preview.outcome).toEqual({ kind: 'waits', reason: 'PREMIUM', until: null });
    if (preview.outcome === null) throw new Error('expected an outcome');
    expect(equityLine(preview.outcome, 'SPY', 100)).toBe('would wait: the pool is more than 1.00 percent above the reference');
  });

  it('stops at the first failing step: a paused token before a closed market', () => {
    const preview = previewPayday(PAYMENT, RULE_DEFAULTS, market({ paused: true }), USDG_AT_PAR, CLOSED, NOW);
    expect(preview.outcome).toEqual({ kind: 'waits', reason: 'PAUSED', until: null });
  });

  it('waits for a fresh round after the reopen and for USDG back near 1 dollar', () => {
    const stale = market({ feed: { ...market().feed, updatedAt: OPENED - 1n } });
    expect(previewPayday(PAYMENT, RULE_DEFAULTS, stale, USDG_AT_PAR, OPEN, NOW).outcome).toMatchObject({ reason: 'STALE' });
    const offPeg = { ...USDG_AT_PAR, answer: 99_400_000n };
    expect(previewPayday(PAYMENT, RULE_DEFAULTS, market(), offPeg, OPEN, NOW).outcome).toMatchObject({ reason: 'DEPEG' });
    const atEdge = { ...USDG_AT_PAR, answer: 99_500_000n };
    expect(previewPayday(PAYMENT, RULE_DEFAULTS, market(), atEdge, OPEN, NOW).outcome).toEqual({ kind: 'buys' });
  });

  it('waits when a multiplier change is due within a day, and below the minimum buy', () => {
    const due = market({ pendingMultiplier: { value: 2n * 10n ** 18n, effectiveAt: NOW + 3_600n } });
    expect(previewPayday(PAYMENT, RULE_DEFAULTS, due, USDG_AT_PAR, OPEN, NOW).outcome).toMatchObject({ reason: 'MULTIPLIER' });
    const small = previewPayday(100_000_000n, RULE_DEFAULTS, market(), USDG_AT_PAR, OPEN, NOW);
    expect(small.outcome).toMatchObject({ reason: 'CLIP' });
  });

  it('sends the equity share to spend when the ticker left the list', () => {
    const preview = previewPayday(PAYMENT, RULE_DEFAULTS, market({ active: false }), USDG_AT_PAR, OPEN, NOW);
    expect(preview.outcome).toEqual({ kind: 'refused' });
  });
});
