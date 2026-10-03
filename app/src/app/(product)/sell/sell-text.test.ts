import { parseStockToken, type Reason } from '@sleeve/core';
import { beforeAll, describe, expect, it } from 'vitest';

import { DataLayerError, type DataLayerErrorDetail } from '@/data/errors';
import { createMockDataLayer, NEXT_OPEN, SAMPLE_ACCOUNT } from '@/data/mock';
import type { Holding } from '@/data/types';

import { lintText } from '../../../../../scripts/copy-lint.mjs';

import {
  amountFieldText,
  checkSellAmount,
  discountWords,
  gapRiskSentences,
  holdingLimitSentence,
  lotLimitSentence,
  lotSellableTokens,
  overrideCapChoices,
  readErrorSentence,
  sameSellRequest,
  sellableTokens,
  sellErrorSentence,
  sellGuardSentence,
  stillHereSentence,
  tokensOutsideLots,
  waitNextStep,
  waitSentence,
  waitTitle,
} from './sell-text';

let spy: Holding;

beforeAll(async () => {
  const holdings = await createMockDataLayer().getHoldings(SAMPLE_ACCOUNT);
  const found = holdings.find((holding) => holding.tickerId === 0);
  if (found === undefined) throw new Error('the sample account holds SPY');
  spy = found;
});

const FEED_UPDATED_AT = 1_790_352_180n;

describe('what Sleeve can sell', () => {
  it('sells lots only, never more than the balance', () => {
    expect(sellableTokens(spy)).toBe(spy.inLots);
    const drained: Holding = { ...spy, balance: spy.inLots - 1n };
    expect(sellableTokens(drained)).toBe(spy.inLots - 1n);
    const topped: Holding = { ...spy, balance: spy.inLots + 5n };
    expect([sellableTokens(topped), tokensOutsideLots(topped)]).toEqual([spy.inLots, 5n]);
  });

  it('bounds one lot by the balance too', () => {
    const lot = spy.lots[0];
    if (lot === undefined) throw new Error('the sample SPY holding has lots');
    expect(lotSellableTokens(lot, spy)).toBe(lot.tokensRemaining);
    expect(lotSellableTokens(lot, { ...spy, balance: 7n })).toBe(7n);
  });

  it('writes amounts into the field with every digit, so they parse back exactly', () => {
    const text = amountFieldText(spy.inLots);
    expect(text).not.toContain(',');
    expect(parseStockToken(text)).toEqual({ ok: true, value: spy.inLots });
  });
});

describe('the amount check', () => {
  const max = 361_668_000_000_000_000n;
  const overLimit = holdingLimitSentence(max, 'SPY');

  it.each([
    ['', 'Enter how much SPY to sell.'],
    ['0', 'Enter more than 0 SPY.'],
    ['0.000', 'Enter more than 0 SPY.'],
    ['1', 'You can sell up to 0.361668 SPY here.'],
    ['.', 'Enter a number, such as 0.05.'],
  ])('refuses %j with %j', (text, problem) => {
    expect(checkSellAmount(text, max, 'SPY', overLimit)).toEqual({ ok: false, problem });
  });

  it('accepts an amount up to the limit, the limit included', () => {
    expect(checkSellAmount('0.1', max, 'SPY', overLimit)).toEqual({ ok: true, amount: 100_000_000_000_000_000n });
    expect(checkSellAmount('0.361668', max, 'SPY', overLimit)).toEqual({ ok: true, amount: max });
  });

  it('names the lot when the limit is a lot', () => {
    expect(lotLimitSentence(455n, 155_872_000_000_000_000n, 'SPY')).toBe('Lot 455 has 0.155872 SPY left.');
  });
});

describe('requests', () => {
  const base = { tickerId: 0, amount: 1n, lotId: 0n, overrideClosed: false, overrideCapBps: 0 };

  it('match only when every field matches', () => {
    expect(sameSellRequest(base, { ...base })).toBe(true);
    expect(sameSellRequest(base, { ...base, overrideClosed: true })).toBe(false);
    expect(sameSellRequest(base, { ...base, overrideCapBps: 200 })).toBe(false);
    expect(sameSellRequest(base, null)).toBe(false);
    expect(sameSellRequest(null, null)).toBe(true);
  });
});

describe('the override cap', () => {
  it('starts at the rule cap and offers only wider steps, up to 500 bps', () => {
    expect(overrideCapChoices(100)).toEqual([100, 200, 300, 500]);
    expect(overrideCapChoices(150)).toEqual([150, 200, 300, 500]);
    expect(overrideCapChoices(0)).toEqual([0, 100, 200, 300, 500]);
    expect(overrideCapChoices(500)).toEqual([500]);
  });
});

describe('sentences', () => {
  it('reads a discount by its sign, never as a gain or a loss', () => {
    expect(discountWords(16n)).toBe('0.16 percent below the market reference');
    expect(discountWords(-5n)).toBe('0.05 percent above the market reference');
    expect(discountWords(0n)).toBe('at the market reference');
  });

  it('says why a sell waits and when the market reopens', () => {
    const session = { reason: 'SESSION', reopensAt: NEXT_OPEN } as const;
    expect(waitTitle(session)).toBe('This sell waits for the market');
    expect(waitSentence(session, 'SPY')).toBe(
      'The market is closed, so the Chainlink reference for SPY still shows its last price. Sleeve does not sell until the market reopens, Sun 27 Sep, 20:00 New York time.',
    );
    expect(waitTitle({ reason: 'STALE', reopensAt: null })).toBe('This sell waits for a fresh price');
    expect(waitNextStep(session, 'SPY')).toBe(
      'Nothing has moved, and your SPY stays in your account. Get a new quote after the reopen, or choose not to wait for this sell once you have seen the risk.',
    );
  });

  it('puts the gap risk in plain words, with the time of the price the cap is measured against', () => {
    const [first, second] = gapRiskSentences({ reason: 'SESSION', reopensAt: NEXT_OPEN }, 'SPY', FEED_UPDATED_AT);
    expect(first).toBe(
      'The Chainlink reference for SPY still shows its last price, from 25 Sep 2026, 16:03 UTC. When the market reopens, Sun 27 Sep, 20:00 New York time, the price can move, sometimes by more than your cap.',
    );
    expect(second).toContain('If the market reopens higher, you will have sold for less than the new price.');
  });

  it('says that nothing moved, naming the token and the USDG', () => {
    expect(stillHereSentence('SPY')).toBe('Nothing moved. Your SPY and your USDG are still in your account.');
  });

  it('maps each failed sell to what happened', () => {
    const waits = new DataLayerError({ code: 'SellWaits', reason: 'SESSION', reopensAt: NEXT_OPEN }, 'waits');
    expect(sellErrorSentence(waits, 'SPY')).toBe('The market closed before the sell ran. It reopens Sun 27 Sep, 20:00 New York time.');
    const paused = new DataLayerError({ code: 'GuardNotClear', reason: 'PAUSED' }, 'paused');
    expect(sellErrorSentence(paused, 'SPY')).toBe(sellGuardSentence('PAUSED', 'SPY'));
    expect(sellErrorSentence(new Error('boom'), 'SPY')).toBe('Try again in a moment.');
    expect(readErrorSentence(new DataLayerError({ code: 'SourceUnavailable' }, 'down'))).toBe(
      'Sleeve could not reach Robinhood Chain. Try again in a moment.',
    );
  });
});

describe('copy rules', () => {
  const reasons: readonly Reason[] = ['NONE', 'PAUSED', 'ORACLE_PAUSED', 'SESSION', 'MULTIPLIER', 'STALE', 'DEPEG', 'CLIP', 'PREMIUM'];
  const details: readonly DataLayerErrorDetail[] = [
    { code: 'SellWaits', reason: 'SESSION', reopensAt: NEXT_OPEN },
    { code: 'SellWaits', reason: 'SESSION', reopensAt: null },
    { code: 'SellWaits', reason: 'STALE', reopensAt: null },
    { code: 'DiscountAboveCap' },
    { code: 'GuardNotClear', reason: 'DEPEG' },
    { code: 'ExceedsLots' },
    { code: 'AccountBlocked' },
    { code: 'OverrideCapOutOfRange' },
    { code: 'PasskeyCancelled' },
    { code: 'NotSignedIn' },
    { code: 'SourceUnavailable' },
    { code: 'NotFound' },
  ];

  it('every sentence the screen can show passes the copy lint', () => {
    const sentences = [
      ...reasons.map((reason) => sellGuardSentence(reason, 'SPY')),
      ...details.map((detail) => sellErrorSentence(new DataLayerError(detail, detail.code), 'SPY')),
      ...details.map((detail) => readErrorSentence(new DataLayerError(detail, detail.code))),
      ...gapRiskSentences({ reason: 'SESSION', reopensAt: NEXT_OPEN }, 'SPY', FEED_UPDATED_AT),
      ...gapRiskSentences({ reason: 'SESSION', reopensAt: null }, 'SPY', FEED_UPDATED_AT),
      ...gapRiskSentences({ reason: 'STALE', reopensAt: null }, 'SPY', FEED_UPDATED_AT),
      waitSentence({ reason: 'SESSION', reopensAt: null }, 'SPY'),
      waitSentence({ reason: 'STALE', reopensAt: null }, 'SPY'),
      waitNextStep({ reason: 'SESSION', reopensAt: NEXT_OPEN }, 'SPY'),
      waitNextStep({ reason: 'STALE', reopensAt: null }, 'SPY'),
      discountWords(16n),
      stillHereSentence('QQQ'),
    ];
    expect(sentences.flatMap((sentence) => lintText(sentence))).toEqual([]);
  });
});
