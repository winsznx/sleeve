import { describe, expect, it } from 'vitest';

import { countdownLong, countdownShort, newYorkLong, newYorkShort, utcSpan } from './time-words';

describe('countdowns', () => {
  it('shows the two largest units, rounding the minutes up', () => {
    // #given spans just past whole units
    // #then the countdown never reads lower than what is left
    expect(countdownShort(30n * 3_600n)).toBe('1d 6h');
    expect(countdownShort(24n * 3_600n)).toBe('1d');
    expect(countdownShort(6n * 3_600n + 12n * 60n + 1n)).toBe('6h 13m');
    expect(countdownShort(3_600n)).toBe('1h');
    expect(countdownShort(45n * 60n)).toBe('45m');
    expect(countdownShort(1n)).toBe('1m');
  });

  it('reads now at zero or after the change', () => {
    expect(countdownShort(0n)).toBe('now');
    expect(countdownShort(-30n)).toBe('now');
    expect(countdownLong(0n)).toBe('now');
  });

  it('spells the same span out for screen readers', () => {
    expect(countdownLong(30n * 3_600n)).toBe('1 day 6 hours');
    expect(countdownLong(2n * 86_400n)).toBe('2 days');
    expect(countdownLong(6n * 3_600n + 13n * 60n)).toBe('6 hours 13 minutes');
    expect(countdownLong(60n)).toBe('1 minute');
  });
});

describe('New York times', () => {
  it('writes a session change in New York time, in daylight and standard time', () => {
    // Sun 27 Sep 2026 20:00 EDT and Sun 1 Nov 2026 20:00 EST
    expect(newYorkShort(1_790_553_600n)).toBe('Sun 27 Sep, 20:00');
    expect(newYorkLong(1_790_553_600n)).toBe('Sunday 27 September at 20:00 New York time');
    expect(newYorkShort(1_793_581_200n)).toBe('Sun 1 Nov, 20:00');
  });
});

describe('utcSpan', () => {
  const at = (iso: string): bigint => BigInt(Date.parse(iso) / 1_000);

  it('writes one time when the readings agree, a range within a day, and both in full across days', () => {
    const morning = at('2026-09-25T16:03:00Z');
    expect(utcSpan([])).toBeNull();
    expect(utcSpan([morning, morning])).toBe('25 Sep 2026, 16:03 UTC');
    expect(utcSpan([at('2026-09-25T19:56:00Z'), morning])).toBe('25 Sep 2026, 16:03 to 19:56 UTC');
    expect(utcSpan([morning, at('2026-09-26T18:00:00Z')])).toBe('25 Sep 2026, 16:03 UTC to 26 Sep 2026, 18:00 UTC');
  });
});
