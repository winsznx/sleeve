import { EXPECTED_DECIMALS } from './chain';
import type { Address } from './spec';

/**
 * Display and input helpers for fixed-point amounts. Everything stays in bigint; nothing passes through a
 * float, so a uint256 formats exactly. Callers that read decimals() at runtime pass them in.
 */

export type Rounding = 'trunc' | 'half-up';

export interface FormatUnitsOptions {
  /** Fewest digits after the point. Default 0. */
  minFractionDigits?: number;
  /** Most digits after the point. Default: every digit `decimals` allows. */
  maxFractionDigits?: number;
  /**
   * trunc drops extra digits toward zero, so a balance never reads higher than it is (default).
   * half-up rounds a half away from zero.
   */
  rounding?: Rounding;
  /** Comma thousands separators in the whole part. Default true. */
  grouping?: boolean;
  /** auto signs negatives only (default). exceptZero also puts + on positives. A value that shows as zero never gets a sign. */
  signDisplay?: 'auto' | 'exceptZero';
}

const MAX_DECIMALS = 77;

function assertDigitCount(name: string, value: number, max: number): void {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new RangeError(`${name} must be a whole number from 0 to ${max}, got ${value}`);
  }
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatUnits(value: bigint, decimals: number, options: FormatUnitsOptions = {}): string {
  assertDigitCount('decimals', decimals, MAX_DECIMALS);
  const minFractionDigits = options.minFractionDigits ?? 0;
  const maxFractionDigits = options.maxFractionDigits ?? decimals;
  assertDigitCount('maxFractionDigits', maxFractionDigits, MAX_DECIMALS);
  assertDigitCount('minFractionDigits', minFractionDigits, maxFractionDigits);

  const negative = value < 0n;
  const magnitude = negative ? -value : value;

  let scaled: bigint;
  if (maxFractionDigits >= decimals) {
    scaled = magnitude * 10n ** BigInt(maxFractionDigits - decimals);
  } else {
    const divisor = 10n ** BigInt(decimals - maxFractionDigits);
    scaled = magnitude / divisor;
    if (options.rounding === 'half-up' && (magnitude % divisor) * 2n >= divisor) scaled += 1n;
  }

  const unit = 10n ** BigInt(maxFractionDigits);
  const whole = (scaled / unit).toString();
  let fraction = maxFractionDigits === 0 ? '' : (scaled % unit).toString().padStart(maxFractionDigits, '0');
  let end = fraction.length;
  while (end > minFractionDigits && fraction[end - 1] === '0') end -= 1;
  fraction = fraction.slice(0, end);

  const wholeText = options.grouping === false ? whole : groupThousands(whole);
  const body = fraction === '' ? wholeText : `${wholeText}.${fraction}`;

  if (scaled === 0n) return body;
  if (negative) return `-${body}`;
  return options.signDisplay === 'exceptZero' ? `+${body}` : body;
}

/** USDG, 6 decimals, two places by default. Also formats a receipt's execPrice, which is USDG per whole token. */
export function formatUsdg(amount: bigint, options: FormatUnitsOptions = {}): string {
  return formatUnits(amount, EXPECTED_DECIMALS.USDG, { minFractionDigits: 2, maxFractionDigits: 2, ...options });
}

/** Stock Token amounts, 18 decimals, two to six places by default. */
export function formatStockToken(amount: bigint, options: FormatUnitsOptions = {}): string {
  return formatUnits(amount, EXPECTED_DECIMALS.STOCK_TOKEN, { minFractionDigits: 2, maxFractionDigits: 6, ...options });
}

/** A Chainlink feed answer, 8 decimals, two places by default. */
export function formatFeedPrice(answer: bigint, options: FormatUnitsOptions = {}): string {
  return formatUnits(answer, EXPECTED_DECIMALS.FEED, { minFractionDigits: 2, maxFractionDigits: 2, ...options });
}

export interface FormatBpsOptions {
  minFractionDigits?: number;
  /** Default 2, which shows every basis point. */
  maxFractionDigits?: number;
  signDisplay?: 'auto' | 'exceptZero';
}

/** Basis points as a percent: 1000 is "10%", 11 is "0.11%", -12 is "-0.12%". */
export function formatBps(bps: number | bigint, options: FormatBpsOptions = {}): string {
  if (typeof bps === 'number' && !Number.isInteger(bps)) {
    throw new RangeError(`basis points must be a whole number, got ${bps}`);
  }
  const percent = formatUnits(BigInt(bps), 2, {
    minFractionDigits: options.minFractionDigits ?? 0,
    maxFractionDigits: options.maxFractionDigits ?? 2,
    rounding: 'half-up',
    signDisplay: options.signDisplay ?? 'auto',
  });
  return `${percent}%`;
}

export type ParseUnitsError = 'EMPTY' | 'NOT_A_NUMBER' | 'NEGATIVE' | 'TOO_MANY_DECIMALS';
export type ParseUnitsResult = { ok: true; value: bigint } | { ok: false; error: ParseUnitsError };

const DECIMAL_TEXT = /^(\d+)(?:\.(\d*))?$|^\.(\d+)$/;

/**
 * Parses what a person typed into base units. Digits and one dot only: no grouping commas, no exponent,
 * and no silent rounding, so a value with more places than the token allows is refused.
 */
export function parseUnits(text: string, decimals: number): ParseUnitsResult {
  assertDigitCount('decimals', decimals, MAX_DECIMALS);
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, error: 'EMPTY' };
  if (trimmed.startsWith('-')) return { ok: false, error: 'NEGATIVE' };
  const match = DECIMAL_TEXT.exec(trimmed);
  if (match === null) return { ok: false, error: 'NOT_A_NUMBER' };
  const whole = match[1] ?? '0';
  const fraction = match[2] ?? match[3] ?? '';
  if (fraction.length > decimals) return { ok: false, error: 'TOO_MANY_DECIMALS' };
  const value = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
  return { ok: true, value };
}

export function parseUsdg(text: string): ParseUnitsResult {
  return parseUnits(text, EXPECTED_DECIMALS.USDG);
}

export function parseStockToken(text: string): ParseUnitsResult {
  return parseUnits(text, EXPECTED_DECIMALS.STOCK_TOKEN);
}

export interface TokenValueDecimals {
  token?: number;
  feed?: number;
  usdg?: number;
}

/**
 * Value of a Stock Token balance in USDG base units: raw balance times the feed answer (PRD 7.11). The feed
 * already includes the multiplier, so it is never applied again. Rounds down.
 */
export function tokenValueUsdg(tokens: bigint, feedAnswer: bigint, decimals: TokenValueDecimals = {}): bigint {
  const tokenDecimals = decimals.token ?? EXPECTED_DECIMALS.STOCK_TOKEN;
  const feedDecimals = decimals.feed ?? EXPECTED_DECIMALS.FEED;
  const usdgDecimals = decimals.usdg ?? EXPECTED_DECIMALS.USDG;
  const shift = tokenDecimals + feedDecimals - usdgDecimals;
  const product = tokens * feedAnswer;
  return shift >= 0 ? product / 10n ** BigInt(shift) : product * 10n ** BigInt(-shift);
}

/** 0x1234…abcd. Returns the input unchanged when it is too short to shorten. */
export function shortAddress(address: Address, visible = 4): string {
  if (address.length <= 2 + visible * 2 + 1) return address;
  return `${address.slice(0, 2 + visible)}…${address.slice(-visible)}`;
}

/** Chain timestamps are unix seconds held as bigint. */
export function secondsToDate(seconds: bigint | number): Date {
  return new Date(Number(seconds) * 1000);
}
