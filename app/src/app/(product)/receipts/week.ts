import type { Status } from '@sleeve/core';

import { formatUtcDate } from '@/components/ui/format-time';
import type { ReceiptRecord } from '@/data/types';

/**
 * Week boundaries for week cards. A card week runs from Monday 00:00 New York time to the next Monday 00:00
 * (WeekCard.weekStart in src/data/types.ts), so the owner's week matches the US market week whatever their own
 * time zone is.
 */

const DAY_SECONDS = 86_400n;

const NEW_YORK = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
});

interface WallTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function newYorkWallTime(timestamp: bigint): WallTime {
  const parts = new Map(NEW_YORK.formatToParts(new Date(Number(timestamp) * 1_000)).map((part) => [part.type, Number(part.value)]));
  return {
    year: parts.get('year') ?? 1970,
    month: parts.get('month') ?? 1,
    day: parts.get('day') ?? 1,
    hour: (parts.get('hour') ?? 0) % 24,
    minute: parts.get('minute') ?? 0,
    second: parts.get('second') ?? 0,
  };
}

/** The wall clock read as if it were UTC, in unix seconds. */
function wallAsUtc(wall: WallTime): bigint {
  return BigInt(Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) / 1_000);
}

/** How far New York's wall clock sits from UTC at an instant: -14,400 on daylight time, -18,000 on standard time. */
function newYorkOffset(timestamp: bigint): bigint {
  return wallAsUtc(newYorkWallTime(timestamp)) - timestamp;
}

/**
 * Monday 00:00 New York time of the week that holds `timestamp`, in unix seconds. Sunday belongs to the week that
 * began the Monday before. Clocks change at 02:00 on a Sunday, so Monday midnight always exists exactly once and
 * one correction of the offset is enough.
 */
export function weekStartOf(timestamp: bigint): bigint {
  const wall = newYorkWallTime(timestamp);
  const weekday = new Date(Date.UTC(wall.year, wall.month - 1, wall.day)).getUTCDay();
  const daysSinceMonday = BigInt((weekday + 6) % 7);
  const mondayWall = wallAsUtc({ ...wall, hour: 0, minute: 0, second: 0 }) - daysSinceMonday * DAY_SECONDS;
  const firstGuess = mondayWall - newYorkOffset(mondayWall);
  return mondayWall - newYorkOffset(firstGuess);
}

/** Monday midnight in New York is 04:00 or 05:00 UTC on the same Monday, so the UTC date names the week. */
export function weekLabel(weekStart: bigint): string {
  return `Week of ${formatUtcDate(weekStart)}`;
}

/** Receipts a week card counts: the splits that make a payday, and the buys. */
const WEEK_CARD_STATUSES = new Set<Status>(['FILLED', 'QUEUED', 'SETTLED', 'REFUSED_TICKER', 'REFUSED_ACCOUNT']);

export interface WeekOption {
  weekStart: bigint;
  label: string;
}

/** The weeks that have a payday or a buy among these receipts, newest first. */
export function weekOptions(records: readonly ReceiptRecord[]): WeekOption[] {
  const starts = new Set<bigint>();
  for (const { receipt } of records) {
    if (WEEK_CARD_STATUSES.has(receipt.status)) starts.add(weekStartOf(receipt.timestamp));
  }
  return [...starts].sort((a, b) => (a < b ? 1 : -1)).map((weekStart) => ({ weekStart, label: weekLabel(weekStart) }));
}
