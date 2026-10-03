import { MODULE_PARAMS, formatUnits, tickerById, type Address, type TickerId } from '@sleeve/core';

/**
 * What Sleeve knows about the pool a buy or sell names: whether the ticker's allowlist holds it (D-010) and, when it
 * does, its v3 fee tier. A pool off the allowlist has no fee tier here, because Sleeve never read one for it.
 */

export interface PoolFacts {
  address: Address;
  allowlisted: boolean;
  /** Uniswap v3 fee in hundredths of a basis point (500 is 0.05 percent). Null off the allowlist. */
  fee: number | null;
}

export function poolFacts(tickerId: TickerId, pool: Address): PoolFacts {
  const wanted = pool.toLowerCase();
  const listed = tickerById(tickerId)?.pools.find((candidate) => candidate.address.toLowerCase() === wanted);
  return { address: pool, allowlisted: listed !== undefined, fee: listed?.fee ?? null };
}

/** "0.05%": a v3 fee tier for a chip. */
export function feeTierPercent(fee: number): string {
  return `${formatUnits(BigInt(fee), 4, { minFractionDigits: 2 })}%`;
}

/** "0.05 percent": a v3 fee tier in a sentence. */
export function feeTierWords(fee: number): string {
  return `${formatUnits(BigInt(fee), 4, { minFractionDigits: 2 })} percent`;
}

/** The venue a receipt names (SPEC 13 venueId), or null when no swap ran. */
export function venueName(venueId: number): string | null {
  if (venueId === 0) return null;
  if (venueId === MODULE_PARAMS.venueUniswapV3) return 'Uniswap v3';
  return `Venue ${venueId}`;
}

/** How the venue is reached, under its name. */
export function venuePath(venueId: number): string | null {
  return venueId === MODULE_PARAMS.venueUniswapV3 ? 'through SwapRouter02' : null;
}
