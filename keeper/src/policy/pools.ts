import type { Address } from '@sleeve/core';

/** One allowlisted pool's QuoterV2 answer for the equity part, or why it gave none. */
export interface PoolQuote {
  pool: Address;
  fee: number;
  amountOut: bigint | null;
  error?: string;
}

/**
 * The pool to trigger through: the most tokens for the USDG among the ticker's allowlisted pools (D-009 Q35). Ties go
 * to the lower fee, then the lower address, so the choice is stable. Null when no pool quoted anything.
 */
export function bestPool(quotes: readonly PoolQuote[]): PoolQuote | null {
  let best: PoolQuote | null = null;
  for (const quote of quotes) {
    if (quote.amountOut === null || quote.amountOut <= 0n) continue;
    if (best === null || best.amountOut === null) {
      best = quote;
      continue;
    }
    const better =
      quote.amountOut > best.amountOut ||
      (quote.amountOut === best.amountOut &&
        (quote.fee < best.fee || (quote.fee === best.fee && quote.pool.toLowerCase() < best.pool.toLowerCase())));
    if (better) best = quote;
  }
  return best;
}

/**
 * The trigger's quote argument: raw token units per 1e6 USDG base units (D-009 Q21), rounded down, so the module's
 * minimum, amountIn * quote / 1e6 less the slippage cap, never exceeds what QuoterV2 said the pool pays.
 */
export function quotePerMillion(amountIn: bigint, amountOut: bigint): bigint {
  if (amountIn <= 0n) throw new RangeError('amountIn must be above zero');
  return (amountOut * 1_000_000n) / amountIn;
}

/**
 * The quote for a split or settle whose preview says no swap runs (a zero or below-clip equity part, or a refusal):
 * the module still wants a non-zero quote and an allowlisted pool, and nothing reads them unless a swap runs.
 */
export const NO_SWAP_QUOTE = 1n;
