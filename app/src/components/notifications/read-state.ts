'use client';

import type { Address } from '@sleeve/core';
import { useCallback, useSyncExternalStore } from 'react';

import type { SleeveNotification } from '@/data/notifications';

/**
 * Which notifications this browser has seen, per account: everything up to a moment ("Mark all read") plus single
 * items opened since. A per-viewer convenience in localStorage; when storage refuses, read state lasts until the tab
 * closes. The moment is the newest item's chain time, so an older item that appears later, for example after
 * loading older pages, counts as read.
 */

const KEY_PREFIX = 'sleeve:notifications:read:';
/** Items opened one at a time are remembered up to this many, newest kept. */
const MAX_IDS = 200;

export interface ReadState {
  /** Unix seconds; items at or before it are read. */
  readThrough: bigint | null;
  ids: readonly string[];
}

const NOTHING_READ: ReadState = { readThrough: null, ids: [] };
const DIGITS = /^\d+$/;

function keyFor(account: Address): string {
  return `${KEY_PREFIX}${account.toLowerCase()}`;
}

export function parseReadState(raw: string | null): ReadState {
  if (raw === null) return NOTHING_READ;
  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return NOTHING_READ;
  }
  if (typeof stored !== 'object' || stored === null) return NOTHING_READ;
  const record = stored as Record<string, unknown>;
  const through = record.readThrough;
  const ids = Array.isArray(record.ids) ? record.ids.filter((id): id is string => typeof id === 'string') : [];
  return { readThrough: typeof through === 'string' && DIGITS.test(through) ? BigInt(through) : null, ids };
}

export function isRead(state: ReadState, notification: SleeveNotification): boolean {
  if (state.readThrough !== null && notification.at <= state.readThrough) return true;
  return state.ids.includes(notification.id);
}

const cache = new Map<string, ReadState>();
const listeners = new Set<() => void>();

function load(key: string): ReadState {
  try {
    return parseReadState(window.localStorage.getItem(key));
  } catch {
    return NOTHING_READ;
  }
}

function snapshot(key: string): ReadState {
  const known = cache.get(key);
  if (known !== undefined) return known;
  const loaded = load(key);
  cache.set(key, loaded);
  return loaded;
}

/** Applies the change in this tab. False when storage refused it, so it lasts only until the tab closes. */
function write(key: string, state: ReadState): boolean {
  cache.set(key, state);
  let saved: boolean;
  try {
    window.localStorage.setItem(
      key,
      JSON.stringify({ readThrough: state.readThrough === null ? null : state.readThrough.toString(), ids: state.ids }),
    );
    saved = true;
  } catch {
    saved = false;
  }
  for (const listener of listeners) listener();
  return saved;
}

function onStorage(event: StorageEvent): void {
  if (event.key !== null && !event.key.startsWith(KEY_PREFIX)) return;
  cache.clear();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener('storage', onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('storage', onStorage);
  };
}

function serverSnapshot(): ReadState {
  return NOTHING_READ;
}

export interface UseReadState {
  state: ReadState;
  markRead: (notification: SleeveNotification) => void;
  /** Marks everything up to the newest of these as read. */
  markAllRead: (notifications: readonly SleeveNotification[]) => void;
}

export function useReadState(account: Address | null): UseReadState {
  const key = account === null ? null : keyFor(account);
  const getSnapshot = useCallback(() => (key === null ? NOTHING_READ : snapshot(key)), [key]);
  const state = useSyncExternalStore(subscribe, getSnapshot, serverSnapshot);

  const markRead = useCallback(
    (notification: SleeveNotification) => {
      if (key === null) return;
      const current = snapshot(key);
      if (isRead(current, notification)) return;
      write(key, { ...current, ids: [notification.id, ...current.ids].slice(0, MAX_IDS) });
    },
    [key],
  );

  const markAllRead = useCallback(
    (notifications: readonly SleeveNotification[]) => {
      if (key === null || notifications.length === 0) return;
      const newest = notifications.reduce((latest, item) => (item.at > latest ? item.at : latest), notifications[0]?.at ?? 0n);
      const current = snapshot(key);
      const through = current.readThrough !== null && current.readThrough > newest ? current.readThrough : newest;
      write(key, { readThrough: through, ids: [] });
    },
    [key],
  );

  return { state, markRead, markAllRead };
}
