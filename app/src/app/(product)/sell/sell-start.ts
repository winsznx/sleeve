import { tickerBySymbol, type TickerId } from '@sleeve/core';

import { parseReceiptId } from '@/lib/receipt-id';

/**
 * Where the sell screen starts, from its URL: /sell?ticker=SPY from a holding, /sell?ticker=SPY&lot=455 from a buy's
 * details. Anything it cannot read is ignored, so a stale or hand-edited link still opens the screen on its first
 * sellable token.
 */
export interface SellStart {
  tickerId: TickerId | undefined;
  /** A lot only counts with its ticker, because lot numbers are global. */
  lotId: bigint | undefined;
}

export function readSellStart(params: { [key: string]: string | string[] | undefined }): SellStart {
  const ticker = typeof params.ticker === 'string' ? tickerBySymbol(params.ticker.trim().toUpperCase()) : undefined;
  if (ticker === undefined) return { tickerId: undefined, lotId: undefined };
  const lot = typeof params.lot === 'string' ? parseReceiptId(params.lot.trim()) : null;
  return { tickerId: ticker.id, lotId: lot ?? undefined };
}
