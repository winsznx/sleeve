import { EXPECTED_DECIMALS, TOTAL_BPS } from './chain';

/**
 * The receipt price arithmetic of contracts/src/libraries/PriceGuard.sol, ported to bigint for the keeper,
 * the verifier, the app and the replay (D-014). Formulas, rounding directions and error names follow the
 * library. bigint is exact at any size, so PriceGuard's 512-bit products need no special handling here, and
 * its PriceOutOfRange revert, which no real fill reaches, has no counterpart.
 *
 * Amounts are base units: USDG 6 decimals, Stock Tokens 18, feed answers 8 (already including the multiplier,
 * so it is never applied again). Pass the decimals read at runtime when they are known.
 */

const BPS = BigInt(TOTAL_BPS);

/** Execution prices are USDG base units per this many Stock Token base units, one whole token. */
export const PRICE_UNIT = 10n ** 18n;

/** PriceGuard.MAX_SCALE_EXPONENT: the largest tokenDecimals + feedDecimals - usdgDecimals it accepts. */
const MAX_SCALE_EXPONENT = 73;

export type PriceMathErrorCode = 'ZeroTokenAmount' | 'AnswerNotPositive' | 'DiscountCapAboveTotal' | 'UnsupportedDecimals';

/** A PriceGuard revert, by its Solidity error name. */
export class PriceMathError extends RangeError {
  readonly code: PriceMathErrorCode;

  constructor(code: PriceMathErrorCode, message: string) {
    super(message);
    this.name = 'PriceMathError';
    this.code = code;
  }
}

export interface PriceDecimals {
  usdg: number;
  token: number;
  feed: number;
}

const DEFAULT_DECIMALS: PriceDecimals = {
  usdg: EXPECTED_DECIMALS.USDG,
  token: EXPECTED_DECIMALS.STOCK_TOKEN,
  feed: EXPECTED_DECIMALS.FEED,
};

/** 10^(token + feed - usdg) * 10,000: USDG base units on the scale of token units times answer units, in bps. */
function usdgScale(decimals: PriceDecimals): bigint {
  const exponent = decimals.token + decimals.feed - decimals.usdg;
  const valid = [decimals.usdg, decimals.token, decimals.feed].every((d) => Number.isInteger(d) && d >= 0 && d <= 255);
  if (!valid || exponent < 0 || exponent > MAX_SCALE_EXPONENT) {
    throw new PriceMathError(
      'UnsupportedDecimals',
      `decimals usdg ${decimals.usdg}, token ${decimals.token}, feed ${decimals.feed} are outside what PriceGuard takes`,
    );
  }
  return 10n ** BigInt(exponent) * BPS;
}

function positive(answer: bigint): bigint {
  if (answer <= 0n) throw new PriceMathError('AnswerNotPositive', `feed answer must be above zero, got ${answer}`);
  return answer;
}

function nonZeroTokens(amount: bigint): bigint {
  if (amount === 0n) throw new PriceMathError('ZeroTokenAmount', 'token amount must be above zero');
  return amount;
}

function uint16(name: string, value: number): bigint {
  if (!Number.isInteger(value) || value < 0 || value > 65_535) {
    throw new RangeError(`${name} must be a uint16, got ${value}`);
  }
  return BigInt(value);
}

function divide(numerator: bigint, denominator: bigint, roundUp: boolean): bigint {
  const quotient = numerator / denominator;
  return roundUp && numerator % denominator !== 0n ? quotient + 1n : quotient;
}

/**
 * The exact test that decides a buy: true when the fill paid more than capBps above the feed price, that is
 * usdgSpent * 10^(token + feed - usdg) * 10,000 > tokensOut * answer * (10,000 + capBps). Equality passes.
 */
export function exceedsPremium(
  usdgSpent: bigint,
  tokensOut: bigint,
  answer: bigint,
  capBps: number,
  decimals: PriceDecimals = DEFAULT_DECIMALS,
): boolean {
  const cap = uint16('capBps', capBps);
  const paid = usdgSpent * usdgScale(decimals);
  return paid > tokensOut * positive(answer) * (BPS + cap);
}

/**
 * The mirror test for a sell: true when the proceeds sit more than capBps below the feed price, that is
 * usdgOut * 10^(token + feed - usdg) * 10,000 < tokensIn * answer * (10,000 - capBps). Equality passes.
 */
export function exceedsDiscount(
  usdgOut: bigint,
  tokensIn: bigint,
  answer: bigint,
  capBps: number,
  decimals: PriceDecimals = DEFAULT_DECIMALS,
): boolean {
  const cap = uint16('capBps', capBps);
  if (cap > BPS) {
    throw new PriceMathError('DiscountCapAboveTotal', `a discount cap is at most ${TOTAL_BPS} bps, got ${capBps}`);
  }
  const received = usdgOut * usdgScale(decimals);
  return tokensIn * positive(answer) * (BPS - cap) > received;
}

/** A buy's execution price on its receipt: ceil(usdgSpent * 1e18 / tokensOut), rounded against the owner. */
export function execPriceBuy(usdgSpent: bigint, tokensOut: bigint): bigint {
  return divide(usdgSpent * PRICE_UNIT, nonZeroTokens(tokensOut), true);
}

/** A sell's execution price on its receipt: floor(usdgOut * 1e18 / tokensIn), rounded against the owner. */
export function execPriceSell(usdgOut: bigint, tokensIn: bigint): bigint {
  return divide(usdgOut * PRICE_UNIT, nonZeroTokens(tokensIn), false);
}

/**
 * A buy's premium over the feed price in signed basis points, rounded up against the owner:
 * ceil(10,000 * usdgSpent * scale / (tokensOut * answer)) - 10,000. Negative when the fill beat the feed.
 * Because of the ceiling, premiumBps > capBps exactly when exceedsPremium is true.
 */
export function premiumBps(
  usdgSpent: bigint,
  tokensOut: bigint,
  answer: bigint,
  decimals: PriceDecimals = DEFAULT_DECIMALS,
): bigint {
  const scale = usdgScale(decimals);
  const value = nonZeroTokens(tokensOut) * positive(answer);
  return divide(usdgSpent * scale, value, true) - BPS;
}

/**
 * A sell's discount below the feed price in signed basis points, rounded up against the owner:
 * 10,000 - floor(10,000 * usdgOut * scale / (tokensIn * answer)). Negative when the sale beat the feed.
 * discountBps > capBps exactly when exceedsDiscount is true.
 */
export function discountBps(
  usdgOut: bigint,
  tokensIn: bigint,
  answer: bigint,
  decimals: PriceDecimals = DEFAULT_DECIMALS,
): bigint {
  const scale = usdgScale(decimals);
  const value = nonZeroTokens(tokensIn) * positive(answer);
  return BPS - divide(usdgOut * scale, value, false);
}

/**
 * SPEC 11 and D-009 Q21: the least a buy must return. The quote is raw token units per 1e6 USDG base units, and
 * the order of operations is the module's: amountIn * quote / 1e6, then times (10,000 - slippageBps) / 10,000.
 */
export function minOutForBuy(amountIn: bigint, quote: bigint, slippageBps: number): bigint {
  return afterSlippage((amountIn * quote) / 1_000_000n, slippageBps);
}

/** The sell mirror of minOutForBuy. The quote is USDG base units per 1e18 token base units. */
export function minOutForSell(tokensIn: bigint, quote: bigint, slippageBps: number): bigint {
  return afterSlippage((tokensIn * quote) / PRICE_UNIT, slippageBps);
}

function afterSlippage(expected: bigint, slippageBps: number): bigint {
  const slippage = uint16('slippageBps', slippageBps);
  if (slippage > BPS) throw new RangeError(`slippageBps is at most ${TOTAL_BPS}, got ${slippageBps}`);
  return (expected * (BPS - slippage)) / BPS;
}
