/**
 * Times as Sleeve shows them. Chain times are unix seconds and read in UTC with the zone written out, so the
 * server and the browser print the same text and a reader can match it against a block explorer. Market times
 * read in New York time, where the US session is defined. Month and weekday names are fixed here rather than
 * taken from Intl, whose short names differ between ICU versions and would make hydration mismatch.
 */

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function utcDate(seconds: bigint): Date {
  return new Date(Number(seconds) * 1_000);
}

/** "26 Sep 2026, 14:00 UTC" */
export function formatUtc(seconds: bigint): string {
  const date = utcDate(seconds);
  return `${formatUtcDate(seconds)}, ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())} UTC`;
}

/** "26 Sep 2026" */
export function formatUtcDate(seconds: bigint): string {
  const date = utcDate(seconds);
  return `${date.getUTCDate()} ${MONTHS_SHORT[date.getUTCMonth()] ?? ''} ${date.getUTCFullYear()}`;
}

/** An ISO calendar date, "2026-10-02", as "2 October 2026". */
export function formatIsoDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (match === null) throw new RangeError(`Expected a YYYY-MM-DD date, got "${iso}"`);
  const [, year = '', month = '', day = ''] = match;
  const name = MONTHS_LONG[Number(month) - 1];
  if (name === undefined) throw new RangeError(`No month ${month} in "${iso}"`);
  return `${Number(day)} ${name} ${year}`;
}

const NEW_YORK = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  hourCycle: 'h23',
});

/** "Sun 27 Sep, 20:00 New York time". Only the numbers come from Intl, which keeps them stable everywhere. */
export function formatNewYork(seconds: bigint): string {
  const parts = new Map(NEW_YORK.formatToParts(utcDate(seconds)).map((part) => [part.type, part.value]));
  const year = Number(parts.get('year'));
  const month = Number(parts.get('month'));
  const day = Number(parts.get('day'));
  const hour = Number(parts.get('hour')) % 24;
  const minute = Number(parts.get('minute'));
  const weekday = WEEKDAYS_SHORT[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] ?? '';
  return `${weekday} ${day} ${MONTHS_SHORT[month - 1] ?? ''}, ${pad2(hour)}:${pad2(minute)} New York time`;
}

function plural(count: bigint, unit: string): string {
  return `${count} ${unit}${count === 1n ? '' : 's'}`;
}

/** A span of seconds in the largest whole unit: "5 days", "1 hour", "12 minutes", "under a minute". */
export function formatDuration(seconds: bigint): string {
  const span = seconds < 0n ? 0n : seconds;
  if (span >= 86_400n) return plural(span / 86_400n, 'day');
  if (span >= 3_600n) return plural(span / 3_600n, 'hour');
  if (span >= 60n) return plural(span / 60n, 'minute');
  return 'under a minute';
}
