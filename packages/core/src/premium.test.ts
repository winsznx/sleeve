import { describe, expect, it } from 'vitest';
import {
  discountBps,
  exceedsDiscount,
  exceedsPremium,
  execPriceBuy,
  execPriceSell,
  minOutForBuy,
  minOutForSell,
  premiumBps,
  PriceMathError,
} from './premium';

const ONE_TOKEN = 10n ** 18n;
/** 100.00000000 USD per token, 8 decimals. */
const HUNDRED = 10_000_000_000n;
const USDG_100 = 100_000_000n;

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return error instanceof PriceMathError ? error.code : 'not a PriceMathError';
  }
  return undefined;
}

/** xorshift64, so the property runs are the same on every machine. */
function generator(seed: bigint): (max: bigint) => bigint {
  let state = seed;
  return (max) => {
    state ^= (state << 13n) & 0xffff_ffff_ffff_ffffn;
    state ^= state >> 7n;
    state ^= (state << 17n) & 0xffff_ffff_ffff_ffffn;
    return (state % max) + 1n;
  };
}

describe('buy side', () => {
  it('reads zero premium at the feed price, and equality passes the cap', () => {
    expect(premiumBps(USDG_100, ONE_TOKEN, HUNDRED)).toBe(0n);
    expect(exceedsPremium(USDG_100, ONE_TOKEN, HUNDRED, 0)).toBe(false);
    expect(execPriceBuy(USDG_100, ONE_TOKEN)).toBe(USDG_100);
  });

  it('rounds the premium up against the owner', () => {
    expect(premiumBps(USDG_100, ONE_TOKEN - 1n, HUNDRED)).toBe(1n);
    expect(exceedsPremium(USDG_100, ONE_TOKEN - 1n, HUNDRED, 0)).toBe(true);
    expect(exceedsPremium(USDG_100, ONE_TOKEN - 1n, HUNDRED, 1)).toBe(false);
  });

  it('goes negative when the fill beats the feed', () => {
    expect(premiumBps(USDG_100, 1_010_000_000_000_000_000n, HUNDRED)).toBe(-99n);
  });

  it('rounds the execution price up for buys and down for sells', () => {
    expect(execPriceBuy(1n, 3n)).toBe(333_333_333_333_333_334n);
    expect(execPriceSell(1n, 3n)).toBe(333_333_333_333_333_333n);
  });

  it('prices the QuoterV2 reading for 100 USDG of SPY at the D-008 weekend block', () => {
    expect(execPriceBuy(USDG_100, 129_538_580_347_000_000n)).toBe(771_970_789n);
  });
});

describe('sell side', () => {
  it('reads the discount below the feed, rounded up against the owner', () => {
    expect(discountBps(99_000_000n, ONE_TOKEN, HUNDRED)).toBe(100n);
    expect(discountBps(99_000_001n, ONE_TOKEN, HUNDRED)).toBe(100n);
    expect(discountBps(101_000_000n, ONE_TOKEN, HUNDRED)).toBe(-100n);
  });

  it('lets a sale exactly at the cap stand', () => {
    expect(exceedsDiscount(99_000_000n, ONE_TOKEN, HUNDRED, 100)).toBe(false);
    expect(exceedsDiscount(99_000_000n, ONE_TOKEN, HUNDRED, 99)).toBe(true);
    expect(exceedsDiscount(1n, ONE_TOKEN, HUNDRED, 10_000)).toBe(false);
  });
});

describe('cap tests agree with the receipt figures', () => {
  it('premiumBps > cap exactly when exceedsPremium, and discountBps > cap exactly when exceedsDiscount', () => {
    const next = generator(0x5eed_1e5en);
    for (let run = 0; run < 3_000; run += 1) {
      const usdg = next(5_000_000_000n);
      const answer = 50_000_000n + next(200_000_000_000n);
      const fair = (usdg * 10n ** 20n) / answer;
      const tokens = fair + next(fair / 20n + 1n) - fair / 40n;
      const cap = Number(next(501n) - 1n);
      expect(premiumBps(usdg, tokens, answer) > BigInt(cap)).toBe(exceedsPremium(usdg, tokens, answer, cap));
      expect(discountBps(usdg, tokens, answer) > BigInt(cap)).toBe(exceedsDiscount(usdg, tokens, answer, cap));
    }
  });
});

describe('decimals read at runtime', () => {
  it('rescales when a token reports other decimals', () => {
    const decimals = { usdg: 6, token: 6, feed: 8 };
    expect(premiumBps(USDG_100, 1_000_000n, HUNDRED, decimals)).toBe(0n);
    expect(exceedsPremium(USDG_100, 999_999n, HUNDRED, 0, decimals)).toBe(true);
  });
});

describe('errors carry the PriceGuard names', () => {
  it('refuses inputs the library reverts on', () => {
    expect(codeOf(() => premiumBps(USDG_100, 0n, HUNDRED))).toBe('ZeroTokenAmount');
    expect(codeOf(() => execPriceSell(USDG_100, 0n))).toBe('ZeroTokenAmount');
    expect(codeOf(() => premiumBps(USDG_100, ONE_TOKEN, 0n))).toBe('AnswerNotPositive');
    expect(codeOf(() => exceedsPremium(USDG_100, ONE_TOKEN, -1n, 100))).toBe('AnswerNotPositive');
    expect(codeOf(() => exceedsDiscount(USDG_100, ONE_TOKEN, HUNDRED, 10_001))).toBe('DiscountCapAboveTotal');
    expect(codeOf(() => premiumBps(USDG_100, ONE_TOKEN, HUNDRED, { usdg: 30, token: 18, feed: 8 }))).toBe(
      'UnsupportedDecimals',
    );
  });

  it('checks decimals before amounts, as the library does', () => {
    expect(codeOf(() => premiumBps(USDG_100, 0n, 0n, { usdg: 30, token: 18, feed: 8 }))).toBe('UnsupportedDecimals');
    expect(codeOf(() => premiumBps(USDG_100, 0n, 0n))).toBe('ZeroTokenAmount');
  });

  it('refuses caps and slippage that are not uint16', () => {
    expect(() => exceedsPremium(USDG_100, ONE_TOKEN, HUNDRED, 1.5)).toThrow(RangeError);
    expect(() => exceedsPremium(USDG_100, ONE_TOKEN, HUNDRED, -1)).toThrow(RangeError);
    expect(() => minOutForBuy(USDG_100, 1n, 10_001)).toThrow(RangeError);
  });
});

describe('minimum out', () => {
  it('follows the module order: amount times quote over the unit, then the slippage cut', () => {
    expect(minOutForBuy(80_000_000n, 1_350_000_000_000_000n, 50)).toBe(107_460_000_000_000_000n);
    expect(minOutForBuy(1n, 1n, 0)).toBe(0n);
    expect(minOutForSell(ONE_TOKEN / 2n, 740_000_000n, 100)).toBe(366_300_000n);
  });
});
