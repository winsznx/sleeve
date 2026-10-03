import { formatUnits, formatUsdg, premiumBps, tickerById, type TickerId } from '@sleeve/core';

import { percentWords, tickerSymbol } from '@/components/sleeve/text';
import { tickerTokenKey } from '@/components/token/ticker-icon';
import type { TokenKey } from '@/components/token/registry';
import { formatNewYork } from '@/components/ui/format-time';
import type { Holding, LotView, PoolPrice, SessionState } from '@/data/types';

/**
 * The holdings screen's arithmetic and words: how the Stock Tokens divide by value, what each lot cost against the
 * market reference, and where the pool sits against that reference right now. Values are balance times the
 * Chainlink answer (PRD 7.11), never a pool price, and nothing here speaks of gains or losses: Sleeve makes no
 * performance claims.
 */

/** Tenths of a percent in a whole. */
const PER_MILLE = 1_000n;

export interface AllocationSlice {
  tickerId: TickerId;
  symbol: string;
  token: TokenKey | null;
  /** USDG base units at the Chainlink reference. */
  value: bigint;
  /** Tenths of a percent of the total, summing to exactly 1,000 across slices. */
  tenths: number;
  /** "91.8 percent" */
  percent: string;
}

export interface Allocation {
  total: bigint;
  slices: AllocationSlice[];
}

/** "10 percent", "12.5 percent": basis points in words, without padding zeros. */
export function bpsWords(bps: number): string {
  return `${formatUnits(BigInt(bps), 2, { minFractionDigits: 0 })} percent`;
}

/** "91.8 percent": tenths of a percent in words. */
export function tenthsWords(tenths: number): string {
  return `${formatUnits(BigInt(tenths), 1, { minFractionDigits: 0 })} percent`;
}

/**
 * How the Stock Tokens divide by value, largest first. Parts are rounded to a tenth of a percent by the largest
 * remainder, so they always add up to 100 percent; a holding with no value is left out of the bar.
 */
export function allocationOf(holdings: readonly Holding[]): Allocation {
  const valued = holdings.filter((holding) => holding.value > 0n);
  const total = valued.reduce((sum, holding) => sum + holding.value, 0n);
  if (total === 0n) return { total: 0n, slices: [] };
  const parts = valued.map((holding) => {
    const scaled = holding.value * PER_MILLE;
    return { holding, floor: scaled / total, remainder: scaled % total };
  });
  let left = PER_MILLE - parts.reduce((sum, part) => sum + part.floor, 0n);
  const byRemainder = [...parts].sort((a, b) => (a.remainder === b.remainder ? a.holding.tickerId - b.holding.tickerId : a.remainder > b.remainder ? -1 : 1));
  const bonus = new Set<TickerId>();
  for (const part of byRemainder) {
    if (left <= 0n) break;
    bonus.add(part.holding.tickerId);
    left -= 1n;
  }
  return {
    total,
    slices: parts
      .map(({ holding, floor }) => {
        const tenths = Number(floor + (bonus.has(holding.tickerId) ? 1n : 0n));
        return {
          tickerId: holding.tickerId,
          symbol: tickerSymbol(holding.tickerId),
          token: tickerTokenKey(holding.tickerId),
          value: holding.value,
          tenths,
          percent: tenthsWords(tenths),
        };
      })
      .sort((a, b) => (a.value === b.value ? a.tickerId - b.tickerId : a.value > b.value ? -1 : 1)),
  };
}

/** Holdings in the order of the allocation bar: largest value first, then ticker order. */
export function byValue(holdings: readonly Holding[]): Holding[] {
  return [...holdings].sort((a, b) => (a.value === b.value ? a.tickerId - b.tickerId : a.value > b.value ? -1 : 1));
}

/** "SPDR S&P 500 ETF Trust": what the Stock Token gives exposure to, as its onchain name gives it. */
export function underlyingName(tickerId: TickerId): string | null {
  return tickerById(tickerId)?.name ?? null;
}

/** Tokens the lots hold, never more than the balance. Only these can be sold through Sleeve in M0 (D-009 Q30). */
export function sellableTokens(holding: Holding): bigint {
  return holding.inLots < holding.balance ? holding.inLots : holding.balance;
}

/** Tokens no lot covers: they arrived outside Sleeve, so Sleeve cannot sell them. */
export function tokensOutsideLots(holding: Holding): bigint {
  return holding.balance > holding.inLots ? holding.balance - holding.inLots : 0n;
}

/** "1 lot", "3 lots" */
export function lotCount(count: number): string {
  return count === 1 ? '1 lot' : `${count} lots`;
}

/** "0.04 percent above the reference": what a lot's buy paid against the Chainlink price at the time. */
export function lotPremiumWords(lot: LotView): string {
  if (lot.premiumBps === 0n) return 'at the reference';
  return `${percentWords(lot.premiumBps)} ${lot.premiumBps > 0n ? 'above' : 'below'} the reference`;
}

/** "769.85 USDG per SPY": the all-in price a lot paid, two places. */
export function lotPriceWords(lot: LotView, symbol: string): string {
  return `${formatUsdg(lot.execPrice)} USDG per ${symbol}`;
}

export interface PoolGap {
  /** "771.97 USDG per SPY" */
  price: string;
  /** Signed basis points of the pool against the reference, as a buy would pay. */
  bps: bigint;
  /** "The pool is 0.05 percent below the reference." */
  sentence: string;
}

/**
 * Where the pool sits against the Chainlink reference right now, from the pool quote the market snapshot carries.
 * The two prices stay separate lines with their own times (PRD 7.11); this only names the gap between them.
 */
export function poolGap(pool: PoolPrice, referenceAnswer: bigint, symbol: string): PoolGap | null {
  if (pool.tokensOut === 0n || referenceAnswer <= 0n) return null;
  const bps = premiumBps(pool.usdgIn, pool.tokensOut, referenceAnswer);
  const sentence =
    bps === 0n ? 'The pool is at the reference.' : `The pool is ${percentWords(bps)} ${bps > 0n ? 'above' : 'below'} the reference.`;
  return { price: `${formatUsdg(pool.execPrice)} USDG per ${symbol}`, bps, sentence };
}

export interface SessionWords {
  open: boolean;
  /** "Market open", "Market closed", "Market hours unknown" */
  label: string;
  /** "Opens Sun 27 Sep, 20:00 New York time" */
  detail: string | null;
}

/** The US market session the guard reads, as a person says it (docs/design/inspiration.md 5.2). */
export function sessionWords(session: SessionState): SessionWords {
  if (session.open) {
    return { open: true, label: 'Market open', detail: session.openedAt === null ? null : `Open since ${formatNewYork(session.openedAt)}` };
  }
  if (session.reason === 'NO_SESSION' || session.reason === 'OUT_OF_RANGE') {
    return { open: false, label: 'Market hours unknown', detail: "Sleeve's calendar has no session for now, so buys wait." };
  }
  const label = session.reason === 'HOLIDAY' ? 'Closed for a holiday' : session.reason === 'EARLY_CLOSE' ? 'Closed early today' : 'Market closed';
  return { open: false, label, detail: session.nextOpenAt === null ? null : `Opens ${formatNewYork(session.nextOpenAt)}` };
}
