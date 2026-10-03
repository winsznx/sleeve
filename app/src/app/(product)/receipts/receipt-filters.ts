import { LAUNCH_TICKERS, STATUSES, tickerById, tickerBySymbol, type Status, type TickerId } from '@sleeve/core';

/**
 * The receipt list's filters (PRD 7.10) and how they live in the URL: ?ticker=SPY&status=FILLED. The URL is the
 * source of truth, so a filtered list survives a reload, a shared link and the back button from a receipt.
 */

export interface ReceiptFilters {
  tickerId: TickerId | undefined;
  status: Status | undefined;
}

export const NO_FILTERS: ReceiptFilters = { tickerId: undefined, status: undefined };

export const TICKER_PARAM = 'ticker';
export const STATUS_PARAM = 'status';

/** Tickers a receipt can name: the launch list, in TokenSource order. */
export const FILTER_TICKERS = LAUNCH_TICKERS.map((ticker) => ({ id: ticker.id, symbol: ticker.symbol }));

/** Select labels in sentence case. The tags in the list keep the onchain names in capitals. */
export const STATUS_OPTION_LABEL: Record<Status, string> = {
  FILLED: 'Filled',
  QUEUED: 'Queued',
  SETTLED: 'Settled',
  REFUSED_TICKER: 'Refused ticker',
  REFUSED_ACCOUNT: 'Refused account',
  RELEASED: 'Released',
  PART_SOLD: 'Part sold',
  SOLD: 'Sold',
  RECONCILED: 'Reconciled',
};

function readTicker(value: string | null): TickerId | undefined {
  if (value === null) return undefined;
  return tickerBySymbol(value.trim().toUpperCase())?.id;
}

function readStatus(value: string | null): Status | undefined {
  if (value === null) return undefined;
  const wanted = value.trim().toUpperCase().replace(/[\s-]+/g, '_');
  return STATUSES.find((status) => status === wanted);
}

/** Unknown or malformed values read as no filter, so an old or hand-edited link still opens the list. */
export function readReceiptFilters(params: { get(name: string): string | null }): ReceiptFilters {
  return { tickerId: readTicker(params.get(TICKER_PARAM)), status: readStatus(params.get(STATUS_PARAM)) };
}

/** The query string for a set of filters: '' when none is set, otherwise '?ticker=SPY&status=FILLED'. */
export function receiptFiltersQuery(filters: ReceiptFilters): string {
  const params = new URLSearchParams();
  const symbol = filters.tickerId === undefined ? undefined : tickerById(filters.tickerId)?.symbol;
  if (symbol !== undefined) params.set(TICKER_PARAM, symbol);
  if (filters.status !== undefined) params.set(STATUS_PARAM, filters.status);
  const query = params.toString();
  return query === '' ? '' : `?${query}`;
}

export function hasFilters(filters: ReceiptFilters): boolean {
  return filters.tickerId !== undefined || filters.status !== undefined;
}
