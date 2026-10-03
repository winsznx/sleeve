import type { SessionReason, SessionType } from './spec';

/**
 * contracts/src/libraries/SessionCalendar.sol ported to bigint for the app, the keeper and the verifier (D-014). The
 * schedule, the rules, the constants and the error names follow the library line for line, and calendar.test.ts
 * replays every vector in contracts/test/fixtures/calendar_vectors.json against it.
 *
 * A New York date is a day number, the days since 1970-01-01, and every conversion is day-number arithmetic against
 * the constants below, never Date or Intl. Sessions are half-open: open at the opening second, closed at the closing
 * second. Every answer fails closed: a timestamp outside the covered years is closed with reason OUT_OF_RANGE.
 *
 * The port adds one function the library does not have, nextSessionTransition, which the app needs to count down
 * to the next open or close. It is built only from isOpen, so it cannot disagree with it.
 */

/** SessionCalendar.CALENDAR_VERSION, the version receipts record. */
export const CALENDAR_VERSION = 1;

const MINUTE = 60n;
const HOUR = 3_600n;
const DAY = 86_400n;

/** First covered instant: Thu 2026-01-01 00:00 EST. First instant after coverage: Sat 2028-01-01 00:00 EST. */
export const CALENDAR_COVERAGE = { start: 1_767_243_600n, end: 1_830_315_600n } as const;

/** First covered New York day, Thu 1 Jan 2026, and the first day after coverage, Sat 1 Jan 2028, as day numbers. */
const FIRST_DAY = 20_454n;
const END_DAY = 21_184n;

const STANDARD_OFFSET = 5n * HOUR;
const DAYLIGHT_OFFSET = 4n * HOUR;

const SUNDAY = 0n;
const SATURDAY = 6n;

/** 20:00 New York time. The ALL_DAY session for trading day D opens at this time on the day before D. */
const ALL_DAY_START = 20n * HOUR;
/** 17:00 New York time, the ALL_DAY close on an early-close day. */
const ALL_DAY_EARLY_CLOSE = 17n * HOUR;
const REGULAR_OPEN = 9n * HOUR + 30n * MINUTE;
const REGULAR_CLOSE = 16n * HOUR;
const REGULAR_EARLY_CLOSE = 13n * HOUR;

/**
 * Daylight saving: New York is on EDT from each start, inclusive, to the matching end, exclusive. Every switch is at
 * 02:00 local time on a Sunday, inside the weekend closure, so no session spans one.
 */
const DAYLIGHT_SPANS = [
  { start: 1_772_953_200n, end: 1_793_512_800n },
  { start: 1_805_007_600n, end: 1_825_567_200n },
] as const;

/** NYSE full-day holidays, 2026 and 2027, as day numbers (SessionCalendar.sol, nyse.com, read 2026-10-02). */
const HOLIDAYS: ReadonlySet<bigint> = new Set([
  20_454n, // Thu 1 Jan 2026, New Year's Day
  20_472n, // Mon 19 Jan 2026, Martin Luther King, Jr. Day
  20_500n, // Mon 16 Feb 2026, Washington's Birthday
  20_546n, // Fri 3 Apr 2026, Good Friday
  20_598n, // Mon 25 May 2026, Memorial Day
  20_623n, // Fri 19 Jun 2026, Juneteenth
  20_637n, // Fri 3 Jul 2026, Independence Day observed
  20_703n, // Mon 7 Sep 2026, Labor Day
  20_783n, // Thu 26 Nov 2026, Thanksgiving Day
  20_812n, // Fri 25 Dec 2026, Christmas Day
  20_819n, // Fri 1 Jan 2027, New Year's Day
  20_836n, // Mon 18 Jan 2027, Martin Luther King, Jr. Day
  20_864n, // Mon 15 Feb 2027, Washington's Birthday
  20_903n, // Fri 26 Mar 2027, Good Friday
  20_969n, // Mon 31 May 2027, Memorial Day
  20_987n, // Fri 18 Jun 2027, Juneteenth observed
  21_004n, // Mon 5 Jul 2027, Independence Day observed
  21_067n, // Mon 6 Sep 2027, Labor Day
  21_147n, // Thu 25 Nov 2027, Thanksgiving Day
  21_176n, // Fri 24 Dec 2027, Christmas Day observed
]);

/** NYSE early closes: 13:00 for REGULAR, 17:00 for ALL_DAY. */
const EARLY_CLOSES: ReadonlySet<bigint> = new Set([
  20_784n, // Fri 27 Nov 2026, day after Thanksgiving
  20_811n, // Thu 24 Dec 2026, Christmas Eve
  21_148n, // Fri 26 Nov 2027, day after Thanksgiving
]);

/** SessionCalendar.DayKind. UNKNOWN is a weekday outside coverage. */
export type CalendarDayKind = 'UNKNOWN' | 'TRADING' | 'EARLY_CLOSE' | 'HOLIDAY' | 'WEEKEND';

export type SessionCalendarErrorCode = 'SessionClosed' | 'TimestampOutOfRange';

/** A SessionCalendar revert, by its Solidity error name. SessionClosed carries the reason isOpen gives. */
export class SessionCalendarError extends RangeError {
  readonly code: SessionCalendarErrorCode;
  readonly timestamp: bigint;
  readonly reason: SessionReason | null;

  constructor(code: SessionCalendarErrorCode, timestamp: bigint, reason: SessionReason | null = null) {
    super(
      code === 'SessionClosed'
        ? `the session is closed at ${timestamp} (${reason ?? 'unknown'})`
        : `${timestamp} is outside the calendar's coverage`,
    );
    this.name = 'SessionCalendarError';
    this.code = code;
    this.timestamp = timestamp;
    this.reason = reason;
  }
}

export interface SessionAnswer {
  open: boolean;
  /** OPEN when open, otherwise why it is closed. */
  reason: SessionReason;
}

export interface SessionTransition {
  /** The first second of the new state, unix seconds. */
  at: bigint;
  /** True when the session opens at `at`, false when it closes. */
  opens: boolean;
}

function inCoverage(timestamp: bigint): boolean {
  return timestamp >= CALENDAR_COVERAGE.start && timestamp < CALENDAR_COVERAGE.end;
}

/** Day of the week of a day number, 0 for Sunday to 6 for Saturday. Day 0, 1 Jan 1970, was a Thursday. */
export function calendarWeekday(day: bigint): bigint {
  return (((day % 7n) + 4n) % 7n + 7n) % 7n;
}

function isWeekend(day: bigint): boolean {
  const weekday = calendarWeekday(day);
  return weekday === SATURDAY || weekday === SUNDAY;
}

/** What a New York day is for the market. Weekends follow from the day number alone, even outside coverage. */
export function calendarDayKind(day: bigint): CalendarDayKind {
  if (isWeekend(day)) return 'WEEKEND';
  if (day < FIRST_DAY || day >= END_DAY) return 'UNKNOWN';
  if (HOLIDAYS.has(day)) return 'HOLIDAY';
  if (EARLY_CLOSES.has(day)) return 'EARLY_CLOSE';
  return 'TRADING';
}

/** Exact inside coverage, where the four switches are the only offset changes. */
function utcOffset(timestamp: bigint): bigint {
  const daylight = DAYLIGHT_SPANS.some((span) => timestamp >= span.start && timestamp < span.end);
  return daylight ? DAYLIGHT_OFFSET : STANDARD_OFFSET;
}

/** New York day number and seconds since New York midnight of a covered timestamp. */
export function newYorkLocalTime(timestamp: bigint): { day: bigint; secondOfDay: bigint } {
  if (!inCoverage(timestamp)) throw new SessionCalendarError('TimestampOutOfRange', timestamp);
  const local = timestamp - utcOffset(timestamp);
  return { day: local / DAY, secondOfDay: local % DAY };
}

/**
 * The UTC instant of a New York wall-clock time from 03:00 to midnight. Such a time is never in the hour a switch
 * skips or repeats, because every switch is at 02:00, so it has exactly one offset.
 */
function utcTime(day: bigint, secondOfDay: bigint): bigint {
  const onDaylightTime = day * DAY + secondOfDay + DAYLIGHT_OFFSET;
  if (utcOffset(onDaylightTime) === DAYLIGHT_OFFSET) return onDaylightTime;
  return onDaylightTime + (STANDARD_OFFSET - DAYLIGHT_OFFSET);
}

/** The trading day an instant's session belongs to: the ALL_DAY session that opens at 20:00 trades for the next day. */
function sessionDay(sessionType: SessionType, day: bigint, secondOfDay: bigint): bigint {
  if (sessionType === 'ALL_DAY' && secondOfDay >= ALL_DAY_START) return day + 1n;
  return day;
}

/** The session rule on its own (SessionCalendar.decide). */
function decide(sessionType: SessionType, secondOfDay: bigint, kind: CalendarDayKind): SessionAnswer {
  if (sessionType === 'NONE') return { open: false, reason: 'NO_SESSION' };
  if (kind === 'WEEKEND') return { open: false, reason: 'WEEKEND' };
  if (kind === 'HOLIDAY') return { open: false, reason: 'HOLIDAY' };
  if (kind !== 'TRADING' && kind !== 'EARLY_CLOSE') return { open: false, reason: 'OUT_OF_RANGE' };
  const earlyClose = kind === 'EARLY_CLOSE';
  if (sessionType === 'ALL_DAY') {
    if (earlyClose && secondOfDay >= ALL_DAY_EARLY_CLOSE && secondOfDay < ALL_DAY_START) {
      return { open: false, reason: 'EARLY_CLOSE' };
    }
    return { open: true, reason: 'OPEN' };
  }
  if (secondOfDay < REGULAR_OPEN) return { open: false, reason: 'OUTSIDE_HOURS' };
  if (secondOfDay < (earlyClose ? REGULAR_EARLY_CLOSE : REGULAR_CLOSE)) return { open: true, reason: 'OPEN' };
  if (secondOfDay < REGULAR_CLOSE) return { open: false, reason: 'EARLY_CLOSE' };
  return { open: false, reason: 'OUTSIDE_HOURS' };
}

interface SessionPoint extends SessionAnswer {
  day: bigint;
  secondOfDay: bigint;
}

function session(timestamp: bigint, sessionType: SessionType): SessionPoint {
  if (sessionType === 'NONE') return { open: false, reason: 'NO_SESSION', day: 0n, secondOfDay: 0n };
  if (!inCoverage(timestamp)) return { open: false, reason: 'OUT_OF_RANGE', day: 0n, secondOfDay: 0n };
  const { day, secondOfDay } = newYorkLocalTime(timestamp);
  return { ...decide(sessionType, secondOfDay, calendarDayKind(sessionDay(sessionType, day, secondOfDay))), day, secondOfDay };
}

/** SessionCalendar.isOpen: whether a session type's market session is open at a timestamp, and why. Never throws. */
export function sessionIsOpen(timestamp: bigint, sessionType: SessionType): SessionAnswer {
  const { open, reason } = session(timestamp, sessionType);
  return { open, reason };
}

/**
 * SessionCalendar.sessionOpenedAt: the start of the unbroken open stretch that contains the timestamp. For ALL_DAY
 * that is the 20:00 New York reopen after a weekend, a holiday or an early close. Throws SessionClosed with the
 * reason isOpen gives when the session is closed, so a closed session never yields an instant.
 */
export function sessionOpenedAt(timestamp: bigint, sessionType: SessionType): bigint {
  const { open, reason, day, secondOfDay } = session(timestamp, sessionType);
  if (!open) throw new SessionCalendarError('SessionClosed', timestamp, reason);
  if (sessionType === 'REGULAR') return utcTime(day, REGULAR_OPEN);
  let firstSessionDay = sessionDay(sessionType, day, secondOfDay);
  while (calendarDayKind(firstSessionDay - 1n) === 'TRADING') firstSessionDay -= 1n;
  return utcTime(firstSessionDay - 1n, ALL_DAY_START);
}

/**
 * New York wall-clock times at which a session type can change state. ALL_DAY changes only at 20:00, where the
 * session day moves on, and at 17:00 on an early close; REGULAR only at its open and its two closes. All of them are
 * after 03:00, where utcTime is exact.
 */
const CHANGE_TIMES: Record<Exclude<SessionType, 'NONE'>, readonly bigint[]> = {
  ALL_DAY: [ALL_DAY_EARLY_CLOSE, ALL_DAY_START],
  REGULAR: [REGULAR_OPEN, REGULAR_EARLY_CLOSE, REGULAR_CLOSE],
};

/**
 * The next instant after the timestamp at which the session opens or closes, or null when the calendar knows of
 * none: type NONE, or no change before coverage ends. Built from sessionIsOpen alone, so it cannot disagree with it.
 */
export function nextSessionTransition(timestamp: bigint, sessionType: SessionType): SessionTransition | null {
  if (sessionType === 'NONE' || timestamp >= CALENDAR_COVERAGE.end) return null;
  const current = sessionIsOpen(timestamp, sessionType).open;
  const times = CHANGE_TIMES[sessionType];
  const firstDay = timestamp < CALENDAR_COVERAGE.start ? FIRST_DAY : newYorkLocalTime(timestamp).day;
  for (let day = firstDay; day < END_DAY; day += 1n) {
    for (const secondOfDay of times) {
      const at = utcTime(day, secondOfDay);
      if (at <= timestamp) continue;
      if (at >= CALENDAR_COVERAGE.end) return null;
      if (sessionIsOpen(at, sessionType).open !== current) return { at, opens: !current };
    }
  }
  return null;
}
