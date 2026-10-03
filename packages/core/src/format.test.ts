import { describe, expect, it } from 'vitest';
import {
  formatBps,
  formatFeedPrice,
  formatStockToken,
  formatUnits,
  formatUsdg,
  parseStockToken,
  parseUnits,
  parseUsdg,
  secondsToDate,
  shortAddress,
  tokenValueUsdg,
} from './format';

const UINT256_MAX = 2n ** 256n - 1n;

describe('formatUnits', () => {
  it('prints every digit by default and trims trailing zeros', () => {
    expect(formatUnits(1_500_000n, 6)).toBe('1.5');
    expect(formatUnits(1_000_000n, 6)).toBe('1');
    expect(formatUnits(1n, 6)).toBe('0.000001');
    expect(formatUnits(0n, 6)).toBe('0');
  });

  it('groups thousands in the whole part only', () => {
    expect(formatUnits(1_234_567_891_234n, 6)).toBe('1,234,567.891234');
    expect(formatUnits(1_234_567_891_234n, 6, { grouping: false })).toBe('1234567.891234');
    expect(formatUnits(999n, 0)).toBe('999');
    expect(formatUnits(1_000n, 0)).toBe('1,000');
  });

  it('pads to minFractionDigits and caps at maxFractionDigits', () => {
    expect(formatUnits(5n, 0, { minFractionDigits: 2, maxFractionDigits: 2 })).toBe('5.00');
    expect(formatUnits(1_230_000n, 6, { minFractionDigits: 2 })).toBe('1.23');
    expect(formatUnits(1_200_000n, 6, { minFractionDigits: 2 })).toBe('1.20');
    expect(formatUnits(1_234_567n, 6, { maxFractionDigits: 3 })).toBe('1.234');
  });

  it('truncates toward zero by default so a balance never reads high', () => {
    expect(formatUnits(999_999n, 6, { maxFractionDigits: 2 })).toBe('0.99');
    expect(formatUnits(-999_999n, 6, { maxFractionDigits: 2 })).toBe('-0.99');
  });

  it('rounds half away from zero on request, carrying into the whole part', () => {
    expect(formatUnits(995_000n, 6, { maxFractionDigits: 2, rounding: 'half-up' })).toBe('1');
    expect(formatUnits(994_999n, 6, { maxFractionDigits: 2, rounding: 'half-up' })).toBe('0.99');
    expect(formatUnits(-995_000n, 6, { maxFractionDigits: 2, minFractionDigits: 2, rounding: 'half-up' })).toBe(
      '-1.00',
    );
    expect(formatUnits(999_999_500_000n, 6, { maxFractionDigits: 0, rounding: 'half-up' })).toBe('1,000,000');
  });

  it('never prints a sign on a value that shows as zero', () => {
    expect(formatUnits(-1n, 6, { maxFractionDigits: 2, minFractionDigits: 2 })).toBe('0.00');
    expect(formatUnits(0n, 2, { signDisplay: 'exceptZero' })).toBe('0');
    expect(formatUnits(1n, 6, { maxFractionDigits: 2, signDisplay: 'exceptZero' })).toBe('0');
  });

  it('signs positives only when asked', () => {
    expect(formatUnits(150n, 2, { signDisplay: 'exceptZero' })).toBe('+1.5');
    expect(formatUnits(-150n, 2, { signDisplay: 'exceptZero' })).toBe('-1.5');
    expect(formatUnits(150n, 2)).toBe('1.5');
  });

  it('formats the full uint256 range exactly', () => {
    expect(formatUnits(UINT256_MAX, 18, { grouping: false })).toBe(
      '115792089237316195423570985008687907853269984665640564039457.584007913129639935',
    );
  });

  it('rejects impossible options instead of guessing', () => {
    expect(() => formatUnits(1n, -1)).toThrow(RangeError);
    expect(() => formatUnits(1n, 6.5)).toThrow(RangeError);
    expect(() => formatUnits(1n, 6, { minFractionDigits: 3, maxFractionDigits: 2 })).toThrow(RangeError);
    expect(() => formatUnits(1n, 78)).toThrow(RangeError);
  });
});

describe('token formatters', () => {
  it('formats USDG with two places, truncated', () => {
    expect(formatUsdg(3_530_355_000n)).toBe('3,530.35');
    expect(formatUsdg(450_000_000n)).toBe('450.00');
    expect(formatUsdg(1n)).toBe('0.00');
    expect(formatUsdg(1n, { maxFractionDigits: 6 })).toBe('0.000001');
  });

  it('formats execPrice, which is USDG base units per whole token', () => {
    expect(formatUsdg(771_970_800n)).toBe('771.97');
  });

  it('formats Stock Tokens with two to six places', () => {
    expect(formatStockToken(84_461_234_567_890_123n)).toBe('0.084461');
    expect(formatStockToken(10n ** 18n)).toBe('1.00');
    expect(formatStockToken(1n)).toBe('0.00');
    expect(formatStockToken(1n, { maxFractionDigits: 18 })).toBe('0.000000000000000001');
  });

  it('formats feed answers with two places', () => {
    expect(formatFeedPrice(77_232_802_713n)).toBe('772.32');
    expect(formatFeedPrice(77_232_802_713n, { maxFractionDigits: 8 })).toBe('772.32802713');
    expect(formatFeedPrice(99_992_581n, { maxFractionDigits: 8 })).toBe('0.99992581');
  });
});

describe('formatBps', () => {
  it('prints basis points as a percent', () => {
    expect(formatBps(1_000)).toBe('10%');
    expect(formatBps(100)).toBe('1%');
    expect(formatBps(50)).toBe('0.5%');
    expect(formatBps(5)).toBe('0.05%');
    expect(formatBps(0)).toBe('0%');
    expect(formatBps(10_000)).toBe('100%');
  });

  it('handles signed bigint premiums', () => {
    expect(formatBps(11n, { signDisplay: 'exceptZero' })).toBe('+0.11%');
    expect(formatBps(-12n, { signDisplay: 'exceptZero' })).toBe('-0.12%');
    expect(formatBps(0n, { signDisplay: 'exceptZero' })).toBe('0%');
    expect(formatBps(-463n)).toBe('-4.63%');
  });

  it('pads and rounds on request', () => {
    expect(formatBps(100, { minFractionDigits: 2 })).toBe('1.00%');
    expect(formatBps(15, { maxFractionDigits: 1 })).toBe('0.2%');
  });

  it('refuses fractional basis points', () => {
    expect(() => formatBps(1.5)).toThrow(RangeError);
  });
});

describe('parseUnits', () => {
  it('parses whole and fractional input', () => {
    expect(parseUsdg('25')).toEqual({ ok: true, value: 25_000_000n });
    expect(parseUsdg('25.5')).toEqual({ ok: true, value: 25_500_000n });
    expect(parseUsdg(' 0.000001 ')).toEqual({ ok: true, value: 1n });
    expect(parseUsdg('.5')).toEqual({ ok: true, value: 500_000n });
    expect(parseUsdg('5.')).toEqual({ ok: true, value: 5_000_000n });
    expect(parseUnits('7', 0)).toEqual({ ok: true, value: 7n });
    expect(parseStockToken('0.084461234567890123')).toEqual({ ok: true, value: 84_461_234_567_890_123n });
  });

  it('round-trips with formatUnits', () => {
    const value = 1_234_567_891_234n;
    const parsed = parseUnits(formatUnits(value, 6, { grouping: false }), 6);
    expect(parsed).toEqual({ ok: true, value });
  });

  it('names what is wrong with bad input', () => {
    expect(parseUsdg('')).toEqual({ ok: false, error: 'EMPTY' });
    expect(parseUsdg('   ')).toEqual({ ok: false, error: 'EMPTY' });
    expect(parseUsdg('-1')).toEqual({ ok: false, error: 'NEGATIVE' });
    expect(parseUsdg('1,000')).toEqual({ ok: false, error: 'NOT_A_NUMBER' });
    expect(parseUsdg('1e6')).toEqual({ ok: false, error: 'NOT_A_NUMBER' });
    expect(parseUsdg('1.2.3')).toEqual({ ok: false, error: 'NOT_A_NUMBER' });
    expect(parseUsdg('.')).toEqual({ ok: false, error: 'NOT_A_NUMBER' });
    expect(parseUsdg('0.0000001')).toEqual({ ok: false, error: 'TOO_MANY_DECIMALS' });
    expect(parseUnits('1.5', 0)).toEqual({ ok: false, error: 'TOO_MANY_DECIMALS' });
  });
});

describe('tokenValueUsdg', () => {
  it('multiplies the raw balance by the feed answer without applying the multiplier again', () => {
    expect(tokenValueUsdg(10n ** 18n, 77_232_802_713n)).toBe(772_328_027n);
    expect(tokenValueUsdg(84_461_234_567_890_123n, 77_232_802_713n)).toBe(65_231_778n);
    expect(tokenValueUsdg(0n, 77_232_802_713n)).toBe(0n);
  });

  it('follows decimals read at runtime', () => {
    expect(tokenValueUsdg(2n, 3n, { token: 0, feed: 0, usdg: 6 })).toBe(6_000_000n);
  });
});

describe('shortAddress and secondsToDate', () => {
  it('shortens an address around an ellipsis', () => {
    expect(shortAddress('0x117cc2133c37B721F49dE2A7a74833232B3B4C0C')).toBe('0x117c…4C0C');
    expect(shortAddress('0x117cc2133c37B721F49dE2A7a74833232B3B4C0C', 6)).toBe('0x117cc2…3B4C0C');
    expect(shortAddress('0x1234')).toBe('0x1234');
  });

  it('turns unix seconds into a Date', () => {
    expect(secondsToDate(1_790_445_600n).toISOString()).toBe('2026-09-26T18:00:00.000Z');
    expect(secondsToDate(0).toISOString()).toBe('1970-01-01T00:00:00.000Z');
  });
});
