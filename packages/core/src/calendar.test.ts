import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import {
  CALENDAR_COVERAGE,
  CALENDAR_VERSION,
  calendarDayKind,
  calendarWeekday,
  newYorkLocalTime,
  nextSessionTransition,
  SessionCalendarError,
  sessionIsOpen,
  sessionOpenedAt,
  type SessionTransition,
} from './calendar';
import { SESSION_REASONS, type SessionType } from './spec';

const REPO = new URL('../../../', import.meta.url);

interface VectorBlock {
  t: number[];
  allDayOpen: boolean[];
  allDayReason: number[];
  allDaySessionOpenedAt: number[];
  regularOpen: boolean[];
  regularReason: number[];
  regularSessionOpenedAt: number[];
}

interface VectorFile {
  calendarVersion: number;
  coverageStart: number;
  coverageEnd: number;
  boundary: VectorBlock & { label: string[] };
  random: VectorBlock;
}

/** The independent oracle's answers (scripts/calendar_vectors.py), the same file the Solidity tests replay. */
const VECTORS: VectorFile = JSON.parse(readFileSync(new URL('contracts/test/fixtures/calendar_vectors.json', REPO), 'utf8'));

/** The 107 ALL_DAY open intervals of 2026 and 2027 in docs/research/session-calendar.md section 10, as UTC seconds. */
function researchIntervals(): { opens: bigint; closes: bigint }[] {
  const note = readFileSync(new URL('docs/research/session-calendar.md', REPO), 'utf8');
  const section = note.slice(note.indexOf('## 10. All ALL_DAY open intervals'));
  return [...section.matchAll(/^\| \d+ \| [^|]+ \| (\d{10}) \S+ \| [^|]+ \| (\d{10}) \S+ \|/gm)].map((match) => ({
    opens: BigInt(match[1] ?? '0'),
    closes: BigInt(match[2] ?? '0'),
  }));
}

/** Walks nextSessionTransition across all of coverage and returns the open stretches it finds. */
function walkIntervals(sessionType: SessionType): { opens: bigint; closes: bigint }[] {
  const intervals: { opens: bigint; closes: bigint }[] = [];
  let cursor = CALENDAR_COVERAGE.start - 1n;
  let opened: bigint | null = null;
  for (let step: SessionTransition | null = nextSessionTransition(cursor, sessionType); step !== null; ) {
    if (step.opens) {
      expect(opened).toBeNull();
      opened = step.at;
    } else {
      if (opened === null) throw new Error(`a close at ${step.at} with no open before it`);
      intervals.push({ opens: opened, closes: step.at });
      opened = null;
    }
    cursor = step.at;
    step = nextSessionTransition(cursor, sessionType);
  }
  expect(opened).toBeNull();
  return intervals;
}

function openedAtOrClosed(timestamp: bigint, sessionType: SessionType): bigint {
  try {
    return sessionOpenedAt(timestamp, sessionType);
  } catch (error) {
    if (error instanceof SessionCalendarError && error.code === 'SessionClosed') return 0n;
    throw error;
  }
}

/** The vector arrays that answer for each session type. */
const KEYS = {
  ALL_DAY: { open: 'allDayOpen', reason: 'allDayReason', openedAt: 'allDaySessionOpenedAt' },
  REGULAR: { open: 'regularOpen', reason: 'regularReason', openedAt: 'regularSessionOpenedAt' },
} as const;

/** Every vector of a block for one session type, as found and as expected, so a failure lists each disagreement. */
function replay(block: VectorBlock, sessionType: Exclude<SessionType, 'NONE'>) {
  const opens = block[KEYS[sessionType].open];
  const reasons = block[KEYS[sessionType].reason];
  const openedAts = block[KEYS[sessionType].openedAt];
  const disagreements: string[] = [];
  block.t.forEach((t, index) => {
    const timestamp = BigInt(t);
    const answer = sessionIsOpen(timestamp, sessionType);
    const expectedReason = SESSION_REASONS[reasons[index] ?? -1];
    if (answer.open !== opens[index] || answer.reason !== expectedReason) {
      disagreements.push(`${t}: isOpen ${answer.open} ${answer.reason}, oracle ${opens[index]} ${expectedReason}`);
    }
    const openedAt = openedAtOrClosed(timestamp, sessionType);
    if (openedAt !== BigInt(openedAts[index] ?? -1)) {
      disagreements.push(`${t}: sessionOpenedAt ${openedAt}, oracle ${openedAts[index]}`);
    }
  });
  return { checked: block.t.length, disagreements };
}

/** The SessionCalendarError a call throws, or undefined when it returns. */
function thrown(run: () => unknown): SessionCalendarError | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof SessionCalendarError) return error;
    throw error;
  }
  return undefined;
}

/** "Sun 2026-10-04 20:00 EDT" style instants used below, written as UTC. */
const at = (iso: string): bigint => BigInt(Date.parse(iso) / 1_000);

describe('the vector file is the one this port was written against', () => {
  it('has the same version and coverage', () => {
    expect(VECTORS.calendarVersion).toBe(CALENDAR_VERSION);
    expect(BigInt(VECTORS.coverageStart)).toBe(CALENDAR_COVERAGE.start);
    expect(BigInt(VECTORS.coverageEnd)).toBe(CALENDAR_COVERAGE.end);
  });
});

describe('isOpen and sessionOpenedAt agree with every vector', () => {
  for (const sessionType of ['ALL_DAY', 'REGULAR'] as const) {
    it(`${sessionType}: every boundary vector, at t - 1, t and t + 1 of each labelled instant`, () => {
      const { checked, disagreements } = replay(VECTORS.boundary, sessionType);
      expect(checked).toBe(VECTORS.boundary.label.length * 3);
      expect(disagreements).toEqual([]);
    });

    it(`${sessionType}: every seeded random vector`, () => {
      const { checked, disagreements } = replay(VECTORS.random, sessionType);
      expect(checked).toBe(3_000);
      expect(disagreements).toEqual([]);
    });
  }

  it('says NO_SESSION for type NONE at any time, inside coverage or not', () => {
    for (const t of [0n, CALENDAR_COVERAGE.start, at('2026-10-05T14:00:00Z'), CALENDAR_COVERAGE.end + 1n]) {
      expect(sessionIsOpen(t, 'NONE')).toEqual({ open: false, reason: 'NO_SESSION' });
      expect(nextSessionTransition(t, 'NONE')).toBeNull();
    }
  });

  it('throws SessionClosed with the closed reason, never an instant', () => {
    const saturday = at('2026-10-03T14:00:00Z');
    expect(thrown(() => sessionOpenedAt(saturday, 'ALL_DAY'))).toMatchObject({
      code: 'SessionClosed',
      reason: 'WEEKEND',
      timestamp: saturday,
    });
  });

  it('refuses local time outside coverage with TimestampOutOfRange', () => {
    expect(thrown(() => newYorkLocalTime(CALENDAR_COVERAGE.end))).toMatchObject({ code: 'TimestampOutOfRange' });
    expect(thrown(() => newYorkLocalTime(CALENDAR_COVERAGE.start - 1n))).toMatchObject({ code: 'TimestampOutOfRange' });
    expect(newYorkLocalTime(CALENDAR_COVERAGE.start)).toEqual({ day: 20_454n, secondOfDay: 0n });
  });

  it('numbers weekdays from Sunday and reads any Saturday or Sunday as a weekend, even outside coverage', () => {
    expect(calendarWeekday(0n)).toBe(4n);
    expect(calendarDayKind(21_184n)).toBe('WEEKEND');
    expect(calendarDayKind(21_186n)).toBe('UNKNOWN');
    expect(calendarDayKind(20_783n)).toBe('HOLIDAY');
    expect(calendarDayKind(20_784n)).toBe('EARLY_CLOSE');
  });
});

describe('nextSessionTransition', () => {
  it('walks ALL_DAY into exactly the 107 open intervals of the research note', () => {
    const expected = researchIntervals();
    expect(expected).toHaveLength(107);
    expect(walkIntervals('ALL_DAY')).toEqual(expected);
  });

  it('agrees with every vector: the open stretch it walks contains t exactly when the oracle says open', () => {
    for (const sessionType of ['ALL_DAY', 'REGULAR'] as const) {
      const intervals = walkIntervals(sessionType);
      const wrong: string[] = [];
      for (const block of [VECTORS.boundary, VECTORS.random]) {
        block.t.forEach((t, index) => {
          const timestamp = BigInt(t);
          const containing = intervals.find((interval) => timestamp >= interval.opens && timestamp < interval.closes);
          const openedAt = BigInt(block[KEYS[sessionType].openedAt][index] ?? -1);
          if ((containing?.opens ?? 0n) !== openedAt) wrong.push(`${sessionType} ${t}`);
        });
      }
      expect(wrong).toEqual([]);
    }
  });

  it('lands on the first second of the new state and nowhere earlier', () => {
    for (const t of VECTORS.random.t.slice(0, 400)) {
      const timestamp = BigInt(t);
      const next = nextSessionTransition(timestamp, 'ALL_DAY');
      if (next === null) continue;
      const now = sessionIsOpen(timestamp, 'ALL_DAY').open;
      expect(sessionIsOpen(next.at, 'ALL_DAY').open).toBe(!now);
      expect(sessionIsOpen(next.at - 1n, 'ALL_DAY').open).toBe(now);
      expect(next.opens).toBe(!now);
    }
  });

  it('counts down a weekend: Friday 20:00 closes, Sunday 20:00 opens, in daylight time', () => {
    const fridayNoon = at('2026-10-02T16:00:00Z');
    expect(nextSessionTransition(fridayNoon, 'ALL_DAY')).toEqual({ at: at('2026-10-03T00:00:00Z'), opens: false });
    const saturday = at('2026-10-03T14:00:00Z');
    expect(nextSessionTransition(saturday, 'ALL_DAY')).toEqual({ at: at('2026-10-05T00:00:00Z'), opens: true });
  });

  it('closes at 17:00 on an early close and reopens after the holiday that follows', () => {
    // Thanksgiving 2026: closed from Wed 20:00 through Thursday, open Thu 20:00 to the Fri 17:00 early close.
    const wednesday = at('2026-11-25T15:00:00Z');
    expect(nextSessionTransition(wednesday, 'ALL_DAY')).toEqual({ at: at('2026-11-26T01:00:00Z'), opens: false });
    const thanksgiving = at('2026-11-26T15:00:00Z');
    expect(nextSessionTransition(thanksgiving, 'ALL_DAY')).toEqual({ at: at('2026-11-27T01:00:00Z'), opens: true });
    const dayAfter = at('2026-11-27T15:00:00Z');
    expect(nextSessionTransition(dayAfter, 'ALL_DAY')).toEqual({ at: at('2026-11-27T22:00:00Z'), opens: false });
    const earlyClosed = at('2026-11-27T23:00:00Z');
    expect(sessionIsOpen(earlyClosed, 'ALL_DAY')).toEqual({ open: false, reason: 'EARLY_CLOSE' });
    expect(nextSessionTransition(earlyClosed, 'ALL_DAY')).toEqual({ at: at('2026-11-30T01:00:00Z'), opens: true });
  });

  it('follows the clocks across both daylight-saving switches', () => {
    // Sun 8 Mar 2026 opens at 20:00 EDT, 00:00 UTC; Sun 1 Nov 2026 opens at 20:00 EST, 01:00 UTC.
    expect(nextSessionTransition(at('2026-03-07T12:00:00Z'), 'ALL_DAY')).toEqual({ at: at('2026-03-09T00:00:00Z'), opens: true });
    expect(nextSessionTransition(at('2026-10-31T12:00:00Z'), 'ALL_DAY')).toEqual({ at: at('2026-11-02T01:00:00Z'), opens: true });
  });

  it('finds the first open from before coverage and nothing after the last close', () => {
    expect(nextSessionTransition(0n, 'ALL_DAY')).toEqual({ at: 1_767_315_600n, opens: true });
    expect(nextSessionTransition(1_830_301_200n, 'ALL_DAY')).toBeNull();
    expect(nextSessionTransition(1_830_301_199n, 'ALL_DAY')).toEqual({ at: 1_830_301_200n, opens: false });
    expect(nextSessionTransition(CALENDAR_COVERAGE.end, 'ALL_DAY')).toBeNull();
  });

  it('opens and closes a REGULAR day at 09:30 and 16:00, and 13:00 on an early close', () => {
    const monday = at('2026-10-05T12:00:00Z');
    expect(nextSessionTransition(monday, 'REGULAR')).toEqual({ at: at('2026-10-05T13:30:00Z'), opens: true });
    expect(nextSessionTransition(at('2026-10-05T13:30:00Z'), 'REGULAR')).toEqual({ at: at('2026-10-05T20:00:00Z'), opens: false });
    expect(nextSessionTransition(at('2026-11-27T15:00:00Z'), 'REGULAR')).toEqual({ at: at('2026-11-27T18:00:00Z'), opens: false });
  });
});
