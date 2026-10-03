'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Two browser facts the chrome reads as external stores: the wall clock, shared by every subscriber and advanced once
 * a second, and media queries. Both answer a fixed value on the server and during hydration, so the server's HTML
 * and the first client render always match.
 */

const TICK_MS = 1_000;
const clockListeners = new Set<() => void>();
let wallNow: number | null = null;
let ticker: ReturnType<typeof setInterval> | undefined;

function tick(): void {
  wallNow = Date.now();
  for (const listener of clockListeners) listener();
}

function subscribeClock(listener: () => void): () => void {
  clockListeners.add(listener);
  if (ticker === undefined) {
    wallNow = Date.now();
    ticker = setInterval(tick, TICK_MS);
  }
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size === 0 && ticker !== undefined) {
      clearInterval(ticker);
      ticker = undefined;
    }
  };
}

function readClock(): number | null {
  return wallNow;
}

function noClock(): null {
  return null;
}

/** Milliseconds since the epoch, once a second. Null on the server and before the first subscription. */
export function useWallClock(): number | null {
  return useSyncExternalStore(subscribeClock, readClock, noClock);
}

function canMatch(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function';
}

/** Whether a media query matches. `serverValue` is the answer before the browser can say. */
export function useMediaQuery(query: string, serverValue = false): boolean {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!canMatch()) return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener('change', listener);
      return () => list.removeEventListener('change', listener);
    },
    [query],
  );
  const read = useCallback(() => (canMatch() ? window.matchMedia(query).matches : serverValue), [query, serverValue]);
  return useSyncExternalStore(subscribe, read, () => serverValue);
}

/** Pointer devices that can hover, where a menu may open on hover (docs/design/inspiration.md 4.6). */
export const HOVER_QUERY = '(hover: hover) and (pointer: fine)';
/** Where popovers anchor to their trigger instead of opening as a bottom sheet. */
export const POPOVER_QUERY = '(min-width: 768px)';
