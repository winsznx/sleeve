'use client';

import { RULE_DEFAULTS, type Rule, type TickerId } from '@sleeve/core';

import { useMarket, useRule, useSession } from '@/data/hooks';
import type { MarketSnapshot, TickerMarket } from '@/data/types';

import { chainNow, marketFor, sessionView, sessionWords, type SessionView, type SessionWords } from './market-session';
import { useWallClock } from './use-browser';

export type MarketSessionRead =
  | { status: 'pending' }
  | { status: 'error'; retry: () => void; retrying: boolean }
  | {
      status: 'ready';
      snapshot: MarketSnapshot;
      market: TickerMarket;
      /** Chain time now, unix seconds. */
      now: bigint;
      view: SessionView;
      words: SessionWords;
    };

/**
 * The market session for one ticker, read through the data layer and carried forward to now once a second. Every
 * launch ticker trades the same 24/5 session; the ticker still matters for the snapshot's own answer.
 */
export function useMarketSession(tickerId: TickerId): MarketSessionRead {
  const market = useMarket();
  const wall = useWallClock();
  if (market.data === undefined) {
    return market.isError ? { status: 'error', retry: () => void market.refetch(), retrying: market.isFetching } : { status: 'pending' };
  }
  const snapshot = market.data;
  const ticker = marketFor(snapshot, tickerId);
  if (ticker === undefined) return { status: 'error', retry: () => void market.refetch(), retrying: market.isFetching };
  const now = chainNow(snapshot.asOf.timestamp, market.dataUpdatedAt, wall ?? market.dataUpdatedAt);
  const view = sessionView(ticker, snapshot.asOf.timestamp, now);
  return { status: 'ready', snapshot, market: ticker, now, view, words: sessionWords(view, now) };
}

/**
 * The signed-in owner's rule, for the menus and the pill's verdict. Null while it loads, when nobody is signed in,
 * or when it fails; callers then show the product defaults and say so.
 */
export function useOwnerRule(): Rule | null {
  const session = useSession();
  const account = session.data?.account;
  const rule = useRule(account);
  return rule.data ?? null;
}

/** The ticker the chrome follows: the owner's rule when there is one, SPY by default (PRD 8.1). */
export function followedTicker(rule: Rule | null): TickerId {
  return rule === null || rule.status === 'NONE' ? RULE_DEFAULTS.tickerId : rule.tickerId;
}
