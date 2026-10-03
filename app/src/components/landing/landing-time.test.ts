import { describe, expect, it } from 'vitest';

import { NEXT_OPEN, FIXTURE_NOW } from '@/data/mock';

import { SESSION_WEEK, WEEK_HOURS, formatCountdown, formatUtcClock, formatUtcDayLong, isoInstant, newYorkWeekHour } from './landing-time';

const at = (iso: string): bigint => BigInt(Date.parse(iso) / 1_000);

describe('landing time words', () => {
  it('reads a receipt time as a lock screen shows it, in UTC', () => {
    expect(formatUtcDayLong(1_790_084_402n)).toBe('Tuesday 22 September');
    expect(formatUtcClock(1_790_084_402n)).toBe('13:40');
    expect(isoInstant(1_790_084_402n)).toBe('2026-09-22T13:40:02.000Z');
  });

  it('counts down in its two largest units, rounding up so it never shows zero early', () => {
    expect(formatCountdown(NEXT_OPEN - FIXTURE_NOW.timestamp)).toBe('1d 6h');
    expect(formatCountdown(86_400n)).toBe('1d');
    expect(formatCountdown(86_401n)).toBe('1d');
    expect(formatCountdown(107_940n)).toBe('1d 5h');
    expect(formatCountdown(22_380n)).toBe('6h 13m');
    expect(formatCountdown(3_600n)).toBe('1h');
    expect(formatCountdown(2_700n)).toBe('45m');
    expect(formatCountdown(1n)).toBe('1m');
    expect(formatCountdown(0n)).toBe('now');
    expect(formatCountdown(-60n)).toBe('now');
  });

  it('places chain time in the New York week, across daylight saving time', () => {
    expect(newYorkWeekHour(FIXTURE_NOW.timestamp)).toBe(5 * 24 + 14);
    expect(newYorkWeekHour(NEXT_OPEN)).toBe(SESSION_WEEK.opensAt);
    expect(newYorkWeekHour(at('2026-09-26T00:00:00Z'))).toBe(SESSION_WEEK.closesAt);
    expect(newYorkWeekHour(at('2026-12-05T01:00:00Z'))).toBe(SESSION_WEEK.closesAt);
    expect(newYorkWeekHour(at('2026-09-28T04:00:00Z'))).toBe(0);
    expect(newYorkWeekHour(at('2026-09-28T03:59:00Z'))).toBeCloseTo(WEEK_HOURS - 1 / 60, 10);
  });
});
