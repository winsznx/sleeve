import { describe, expect, it } from 'vitest';

import { formatDuration, formatIsoDate, formatNewYork, formatUtc, formatUtcDate } from './format-time';

const at = (iso: string): bigint => BigInt(Date.parse(iso) / 1_000);

describe('chain times', () => {
  it('prints UTC with the zone written out', () => {
    expect(formatUtc(at('2026-09-26T13:30:10Z'))).toBe('26 Sep 2026, 13:30 UTC');
    expect(formatUtc(at('2026-01-05T00:04:59Z'))).toBe('5 Jan 2026, 00:04 UTC');
    expect(formatUtcDate(at('2026-12-31T23:59:59Z'))).toBe('31 Dec 2026');
  });

  it('prints market times in New York time across both daylight saving offsets', () => {
    // Sunday 27 September 2026 20:00 New York is Monday 00:00 UTC (EDT, UTC-4).
    expect(formatNewYork(at('2026-09-28T00:00:00Z'))).toBe('Sun 27 Sep, 20:00 New York time');
    // In January New York is on EST, UTC-5.
    expect(formatNewYork(at('2026-01-05T14:30:00Z'))).toBe('Mon 5 Jan, 09:30 New York time');
    // Midnight prints as 00, never 24.
    expect(formatNewYork(at('2026-03-02T05:00:00Z'))).toBe('Mon 2 Mar, 00:00 New York time');
  });

  it('reads an ISO date as a long date', () => {
    expect(formatIsoDate('2026-10-02')).toBe('2 October 2026');
    expect(() => formatIsoDate('2 October 2026')).toThrow(RangeError);
    expect(() => formatIsoDate('2026-13-02')).toThrow(RangeError);
  });

  it('names a span in its largest whole unit', () => {
    expect(formatDuration(5n * 86_400n + 7n)).toBe('5 days');
    expect(formatDuration(86_400n)).toBe('1 day');
    expect(formatDuration(3_600n)).toBe('1 hour');
    expect(formatDuration(4n * 3_600n + 1_799n)).toBe('4 hours');
    expect(formatDuration(119n)).toBe('1 minute');
    expect(formatDuration(59n)).toBe('under a minute');
    expect(formatDuration(-5n)).toBe('under a minute');
  });
});
