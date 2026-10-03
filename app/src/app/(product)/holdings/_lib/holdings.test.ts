import { tickerById } from '@sleeve/core';
import { describe, expect, it } from 'vitest';

import { NEXT_OPEN } from '@/data/mock';
import type { FeedReading, Holding, LotView, PoolPrice } from '@/data/types';

import {
  allocationOf,
  bpsWords,
  byValue,
  lotCount,
  lotPremiumWords,
  lotPriceWords,
  poolGap,
  sellableTokens,
  sessionWords,
  tenthsWords,
  tokensOutsideLots,
} from './holdings';

const TOKEN = 10n ** 18n;
const USDG = 1_000_000n;

const feed: FeedReading = {
  feed: tickerById(0)?.feed ?? '0x0',
  roundId: 1n,
  answer: 77_232_802_713n,
  updatedAt: 1_790_352_180n,
};

function holdingOf(tickerId: number, value: bigint, overrides: Partial<Holding> = {}): Holding {
  return { tickerId, balance: TOKEN, inLots: TOKEN, value, feed, lots: [], ...overrides };
}

function lotOf(overrides: Partial<LotView>): LotView {
  return {
    id: 455n,
    account: '0x3efEf72Ee9aF42fd90f193A1A64aC25384179b36',
    tickerId: 0,
    status: 'FILLED',
    tokensBought: TOKEN,
    tokensRemaining: TOKEN,
    boughtAt: 1_790_084_402n,
    usdgSpent: 120n * USDG,
    execPrice: 769_859_026n,
    premiumBps: 4n,
    uiMultiplierAtFill: TOKEN,
    ...overrides,
  };
}

describe('allocationOf', () => {
  it('divides by value, largest first, in tenths of a percent that always add up to 100 percent', () => {
    const allocation = allocationOf([holdingOf(0, 1n), holdingOf(1, 1n), holdingOf(2, 1n)]);
    expect(allocation.total).toBe(3n);
    expect(allocation.slices.map((slice) => slice.tenths)).toEqual([334, 333, 333]);
    expect(allocation.slices.reduce((sum, slice) => sum + slice.tenths, 0)).toBe(1_000);
    expect(allocation.slices[0]).toMatchObject({ symbol: 'SPY', token: 'SPY', percent: '33.4 percent' });
  });

  it('orders the parts by value and names them with their icons', () => {
    const allocation = allocationOf([holdingOf(1, 24_970_000n), holdingOf(0, 279_320_000n)]);
    expect(allocation.slices.map((slice) => [slice.symbol, slice.percent])).toEqual([
      ['SPY', '91.8 percent'],
      ['QQQ', '8.2 percent'],
    ]);
  });

  it('leaves a holding with no value out of the bar, and an empty set has no parts', () => {
    expect(allocationOf([holdingOf(0, 5n), holdingOf(1, 0n)]).slices.map((slice) => slice.symbol)).toEqual(['SPY']);
    expect(allocationOf([])).toEqual({ total: 0n, slices: [] });
  });
});

describe('holding arithmetic', () => {
  it('sorts by value, then by ticker', () => {
    expect(byValue([holdingOf(2, 5n), holdingOf(1, 9n), holdingOf(0, 5n)]).map((entry) => entry.tickerId)).toEqual([1, 0, 2]);
  });

  it('sells only from lots and never more than the balance, and counts what no lot covers', () => {
    expect(sellableTokens(holdingOf(0, 1n, { balance: 3n, inLots: 2n }))).toBe(2n);
    expect(sellableTokens(holdingOf(0, 1n, { balance: 1n, inLots: 2n }))).toBe(1n);
    expect(tokensOutsideLots(holdingOf(0, 1n, { balance: 3n, inLots: 2n }))).toBe(1n);
    expect(tokensOutsideLots(holdingOf(0, 1n, { balance: 1n, inLots: 2n }))).toBe(0n);
  });
});

describe('holding words', () => {
  it('writes shares of pay and of value in plain percent', () => {
    expect(bpsWords(1_000)).toBe('10 percent');
    expect(bpsWords(1_250)).toBe('12.5 percent');
    expect(tenthsWords(918)).toBe('91.8 percent');
    expect(tenthsWords(1_000)).toBe('100 percent');
    expect(lotCount(1)).toBe('1 lot');
    expect(lotCount(4)).toBe('4 lots');
  });

  it("says what a lot's buy paid against the reference, never as a gain or a loss", () => {
    expect(lotPremiumWords(lotOf({ premiumBps: 4n }))).toBe('0.04 percent above the reference');
    expect(lotPremiumWords(lotOf({ premiumBps: -9n }))).toBe('0.09 percent below the reference');
    expect(lotPremiumWords(lotOf({ premiumBps: 0n }))).toBe('at the reference');
    expect(lotPriceWords(lotOf({}), 'SPY')).toBe('769.85 USDG per SPY');
  });

  it('names where the pool sits against the reference, from the pool quote', () => {
    const pool: PoolPrice = {
      pool: '0xa7Bb1AC63BBaB0C44316E6c8C455213441689167',
      usdgIn: 100n * USDG,
      tokensOut: 129_538_580_347_000_000n,
      execPrice: 771_971_222n,
      at: { l2Block: 1n, timestamp: 1n },
    };
    expect(poolGap(pool, feed.answer, 'SPY')).toEqual({
      price: '771.97 USDG per SPY',
      bps: -4n,
      sentence: 'The pool is 0.04 percent below the reference.',
    });
    expect(poolGap({ ...pool, tokensOut: 0n }, feed.answer, 'SPY')).toBeNull();
  });
});

describe('sessionWords', () => {
  it('says when a closed market opens, in New York time', () => {
    expect(sessionWords({ open: false, reason: 'WEEKEND', openedAt: null, nextOpenAt: NEXT_OPEN })).toEqual({
      open: false,
      label: 'Market closed',
      detail: 'Opens Sun 27 Sep, 20:00 New York time',
    });
  });

  it('names holidays and early closes, and an open market with when it opened', () => {
    expect(sessionWords({ open: false, reason: 'HOLIDAY', openedAt: null, nextOpenAt: null }).label).toBe('Closed for a holiday');
    expect(sessionWords({ open: false, reason: 'EARLY_CLOSE', openedAt: null, nextOpenAt: null }).label).toBe('Closed early today');
    expect(sessionWords({ open: true, reason: 'OPEN', openedAt: NEXT_OPEN, nextOpenAt: null })).toEqual({
      open: true,
      label: 'Market open',
      detail: 'Open since Sun 27 Sep, 20:00 New York time',
    });
  });

  it('does not guess when the calendar has no session', () => {
    expect(sessionWords({ open: false, reason: 'OUT_OF_RANGE', openedAt: null, nextOpenAt: null })).toEqual({
      open: false,
      label: 'Market hours unknown',
      detail: "Sleeve's calendar has no session for now, so buys wait.",
    });
  });
});
