import { describe, expect, it } from 'vitest';
import { isPoolAllowlisted, LAUNCH_TICKERS, tickerById, tickerBySymbol } from './tickers';

describe('launch tickers', () => {
  it('lists SPY, QQQ, NVDA and AAPL as ids 0 to 3 (SPEC 3)', () => {
    expect(LAUNCH_TICKERS.map((ticker) => [ticker.id, ticker.symbol])).toEqual([
      [0, 'SPY'],
      [1, 'QQQ'],
      [2, 'NVDA'],
      [3, 'AAPL'],
    ]);
  });

  it('gives every ticker a 32-byte uid, a feed and at least one pool', () => {
    for (const ticker of LAUNCH_TICKERS) {
      expect(ticker.tokenUid).toMatch(/^0x[0-9a-f]{64}$/);
      expect(ticker.token).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(ticker.feed).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(ticker.pools.length).toBeGreaterThan(0);
    }
  });

  it('looks tickers up by id and symbol', () => {
    expect(tickerById(2)?.symbol).toBe('NVDA');
    expect(tickerBySymbol('AAPL')?.id).toBe(3);
    expect(tickerById(4)).toBeUndefined();
    expect(tickerBySymbol('HOOD')).toBeUndefined();
  });

  it('checks pools against the D-010 allowlist, ignoring address case', () => {
    expect(isPoolAllowlisted(0, '0xa7bb1ac63bbab0c44316e6c8c455213441689167')).toBe(true);
    expect(isPoolAllowlisted(3, '0x783C9bbB765047CFdD2b84b92b2Ca9F11D34b7Ed')).toBe(true);
    expect(isPoolAllowlisted(0, '0xA43b424Bc609495AED4BCD88d654934b510B0aD9')).toBe(false);
    expect(isPoolAllowlisted(9, '0xa7Bb1AC63BBaB0C44316E6c8C455213441689167')).toBe(false);
  });
});
