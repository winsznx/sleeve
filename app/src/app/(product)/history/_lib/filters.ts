import { LAUNCH_TICKERS, STATUSES, tickerById, tickerBySymbol, type Status, type TickerId } from '@sleeve/core';

import { STATUS_ORDER, STATUS_WORDS, statusTone } from '@/app/(product)/receipts/_lib/outcome';
import type { BadgeTone } from '@/components/ui/badge';

/**
 * The history's filters (PRD 7.10) and how they live in the URL: ?ticker=SPY&status=FILLED. The URL is the source
 * of truth, so a filtered list survives a reload, a shared link and the back button from an action's details.
 */

export interface HistoryFilters {
  tickerId: TickerId | undefined;
  status: Status | undefined;
}

export const NO_FILTERS: HistoryFilters = { tickerId: undefined, status: undefined };

export const TICKER_PARAM = 'ticker';
export const STATUS_PARAM = 'status';

/** Tickers an action can name: the launch list, in TokenSource order. */
export const FILTER_TICKERS = LAUNCH_TICKERS.map((ticker) => ({ id: ticker.id, symbol: ticker.symbol }));

/** One chip per onchain status, in plain words and in the tone of its row chip. */
export const STATUS_CHIPS: readonly { status: Status; label: string; tone: BadgeTone }[] = STATUS_ORDER.map((status) => ({
  status,
  label: STATUS_WORDS[status],
  tone: statusTone(status),
}));

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
export function readHistoryFilters(params: { get(name: string): string | null }): HistoryFilters {
  return { tickerId: readTicker(params.get(TICKER_PARAM)), status: readStatus(params.get(STATUS_PARAM)) };
}

/** The query string for a set of filters: '' when none is set, otherwise '?ticker=SPY&status=FILLED'. */
export function historyFiltersQuery(filters: HistoryFilters): string {
  const params = new URLSearchParams();
  const symbol = filters.tickerId === undefined ? undefined : tickerById(filters.tickerId)?.symbol;
  if (symbol !== undefined) params.set(TICKER_PARAM, symbol);
  if (filters.status !== undefined) params.set(STATUS_PARAM, filters.status);
  const query = params.toString();
  return query === '' ? '' : `?${query}`;
}

export function hasFilters(filters: HistoryFilters): boolean {
  return filters.tickerId !== undefined || filters.status !== undefined;
}

/** "There are no SPY actions marked Sold part of lot yet.", for the empty state of a filtered list. */
export function noMatchSentence(filters: HistoryFilters): string {
  const subject = filters.tickerId === undefined ? 'actions' : `${tickerById(filters.tickerId)?.symbol ?? 'these'} actions`;
  if (filters.status === undefined) return `There are no ${subject} on your account yet.`;
  return `There are no ${subject} marked ${STATUS_WORDS[filters.status]} on your account yet.`;
}
