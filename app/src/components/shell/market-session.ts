import {
  nextSessionTransition,
  sessionIsOpen,
  sessionOpenedAt,
  tickerById,
  type SessionReason,
  type SessionType,
  type TickerId,
} from '@sleeve/core';

import type { MarketSnapshot, TickerMarket } from '@/data/types';

import { countdownLong, countdownShort, newYorkLong, newYorkShort } from './time-words';

/**
 * The market session as the chrome shows it: the data layer's snapshot decides the state at the snapshot's chain
 * time, and the SessionCalendar port carries it forward to now and finds the next open or close. When the two
 * disagree at the snapshot (a calendar change the port does not have, say), the snapshot wins and nothing is
 * counted down, because the pill never guesses.
 */

export type SessionView =
  | { state: 'open'; openedAt: bigint | null; closesAt: bigint | null }
  | { state: 'closed'; reason: SessionReason; opensAt: bigint | null }
  | { state: 'unknown'; reason: SessionReason };

/**
 * Chain time now: the snapshot's block time plus the wall-clock seconds since the snapshot was read. On Robinhood
 * Chain the snapshot is seconds old, so this is the live clock; on the mock it moves the sample clock forward.
 */
export function chainNow(asOf: bigint, readAtMs: number, wallMs: number): bigint {
  return asOf + BigInt(Math.max(0, Math.floor((wallMs - readAtMs) / 1_000)));
}

export function sessionTypeOf(tickerId: TickerId): SessionType {
  return tickerById(tickerId)?.sessionType ?? 'NONE';
}

function fromSnapshot(market: TickerMarket): SessionView {
  const { session } = market;
  if (session.open) return { state: 'open', openedAt: session.openedAt, closesAt: null };
  if (session.reason === 'NO_SESSION' || session.reason === 'OUT_OF_RANGE') return { state: 'unknown', reason: session.reason };
  return { state: 'closed', reason: session.reason, opensAt: session.nextOpenAt };
}

export function sessionView(market: TickerMarket, snapshotAt: bigint, now: bigint): SessionView {
  const sessionType = sessionTypeOf(market.tickerId);
  if (sessionIsOpen(snapshotAt, sessionType).open !== market.session.open) return fromSnapshot(market);
  const answer = sessionIsOpen(now, sessionType);
  const next = nextSessionTransition(now, sessionType);
  if (answer.open) {
    return { state: 'open', openedAt: sessionOpenedAt(now, sessionType), closesAt: next?.at ?? null };
  }
  if (answer.reason === 'NO_SESSION' || answer.reason === 'OUT_OF_RANGE') return { state: 'unknown', reason: answer.reason };
  return { state: 'closed', reason: answer.reason, opensAt: next?.at ?? null };
}

/** The ticker's market in a snapshot, or the first one when the ticker is not listed. */
export function marketFor(snapshot: MarketSnapshot, tickerId: TickerId): TickerMarket | undefined {
  return snapshot.tickers.find((market) => market.tickerId === tickerId) ?? snapshot.tickers[0];
}

export type SessionTone = 'open' | 'closed' | 'unknown';

export interface SessionWords {
  tone: SessionTone;
  /** "Market open", "Market closed", "Closed for a holiday", "Closed early today", "Market hours unknown". */
  title: string;
  /** "Open", "Closed" or "Hours unknown", for the narrowest pill. */
  short: string;
  /** "closes in 3d 4h" or "opens in 1d 6h"; null when the next change is unknown. */
  countdown: string | null;
  /** The time left alone, "1d 6h"; null when the next change is unknown. */
  remaining: string | null;
  /** "Fri 9 Oct, 20:00" for the change, or null. */
  when: string | null;
  /** The whole state as one sentence, for accessible names: "Market closed, opens Sunday 4 October at 20:00 New York time, in 1 day 6 hours." */
  sentence: string;
}

const CLOSED_TITLE: Partial<Record<SessionReason, string>> = {
  HOLIDAY: 'Closed for a holiday',
  EARLY_CLOSE: 'Closed early today',
};

export function sessionWords(view: SessionView, now: bigint): SessionWords {
  if (view.state === 'unknown') {
    return {
      tone: 'unknown',
      title: 'Market hours unknown',
      short: 'Hours unknown',
      countdown: null,
      remaining: null,
      when: null,
      sentence: "Market hours unknown. Sleeve's calendar has no session for now, so buys wait.",
    };
  }
  const open = view.state === 'open';
  const title = open ? 'Market open' : (CLOSED_TITLE[view.reason] ?? 'Market closed');
  const at = open ? view.closesAt : view.opensAt;
  const verb = open ? 'closes' : 'opens';
  if (at === null) {
    return {
      tone: open ? 'open' : 'closed',
      title,
      short: open ? 'Open' : 'Closed',
      countdown: null,
      remaining: null,
      when: null,
      sentence: `${title}.`,
    };
  }
  const left = at - now;
  return {
    tone: open ? 'open' : 'closed',
    title,
    short: open ? 'Open' : 'Closed',
    countdown: `${verb} in ${countdownShort(left)}`,
    remaining: countdownShort(left),
    when: newYorkShort(at),
    sentence: `${title}, ${verb} ${newYorkLong(at)}, in ${countdownLong(left)}.`,
  };
}
