import { describe, expect, it } from 'vitest';

import { bestPool, quotePerMillion } from '../../src/policy/pools';

const POOL_500 = '0xaae0d815ee56e4092a5e5c2911e676fea50b2d6d';
const POOL_3000 = '0x783c9bbb765047cfdd2b84b92b2ca9f11d34b7ed';

describe('bestPool', () => {
  it('takes the pool that pays the most tokens', () => {
    // #when
    const best = bestPool([
      { pool: POOL_500, fee: 500, amountOut: 6_500_000_000_000_000n },
      { pool: POOL_3000, fee: 3000, amountOut: 6_510_000_000_000_000n },
    ]);
    // #then
    expect(best?.pool).toBe(POOL_3000);
  });

  it('breaks a tie on the lower fee', () => {
    // #when
    const best = bestPool([
      { pool: POOL_3000, fee: 3000, amountOut: 10n },
      { pool: POOL_500, fee: 500, amountOut: 10n },
    ]);
    // #then
    expect(best?.pool).toBe(POOL_500);
  });

  it('skips pools that failed to quote or quoted nothing', () => {
    // #when
    const best = bestPool([
      { pool: POOL_500, fee: 500, amountOut: null, error: 'execution reverted' },
      { pool: POOL_3000, fee: 3000, amountOut: 0n },
    ]);
    // #then
    expect(best).toBeNull();
  });

  it('has nothing to pick from an empty allowlist', () => {
    // #when
    const best = bestPool([]);
    // #then
    expect(best).toBeNull();
  });
});

describe('quotePerMillion', () => {
  it('states the quote per 1e6 USDG base units, rounded down (D-009 Q21)', () => {
    // #when
    const quote = quotePerMillion(5_000_000n, 6_487_123_456_789_012n);
    // #then
    expect(quote).toBe(1_297_424_691_357_802n);
  });

  it('keeps the module minimum within what QuoterV2 promised', () => {
    // #given
    const amountIn = 3_333_333n;
    const amountOut = 4_321_987_654_321_000n;
    // #when
    const quote = quotePerMillion(amountIn, amountOut);
    // #then
    expect((amountIn * quote) / 1_000_000n <= amountOut).toBe(true);
  });

  it('refuses a zero amount in', () => {
    // #when
    const attempt = () => quotePerMillion(0n, 1n);
    // #then
    expect(attempt).toThrow(RangeError);
  });
});
