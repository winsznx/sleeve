/**
 * Time words the landing page shows beyond components/ui/format-time.ts. Chain times read in UTC with the zone
 * written out; market times read in New York time, where the 24/5 session is defined
 * (docs/research/session-calendar.md R2 and R3). Names are fixed here, as in format-time.ts, so the server and the
 * browser print the same text.
 */

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const MONTHS = [
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

function utcDate(seconds: bigint): Date {
  return new Date(Number(seconds) * 1_000);
}

function pad2(value: number | bigint): string {
  return String(value).padStart(2, '0');
}

/** "Tuesday 22 September", in UTC. */
export function formatUtcDayLong(seconds: bigint): string {
  const date = utcDate(seconds);
  return `${WEEKDAYS[date.getUTCDay()] ?? ''} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()] ?? ''}`;
}

/** "13:40", in UTC. */
export function formatUtcClock(seconds: bigint): string {
  const date = utcDate(seconds);
  return `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`;
}

/** The machine form for a time element's dateTime: "2026-09-22T13:40:02.000Z". */
export function isoInstant(seconds: bigint): string {
  return utcDate(seconds).toISOString();
}

/**
 * Time left in its two largest units, the way the session pill in the navbar counts: "1d 6h", "6h 13m", "45m".
 * It rounds up to the minute, so it never reads "0m" while time remains, and anything at or past zero reads "now".
 */
export function formatCountdown(seconds: bigint): string {
  if (seconds <= 0n) return 'now';
  const minutes = (seconds + 59n) / 60n;
  const days = minutes / 1_440n;
  const hours = (minutes % 1_440n) / 60n;
  const rest = minutes % 60n;
  if (days > 0n) return hours === 0n ? `${days}d` : `${days}d ${hours}h`;
  if (hours > 0n) return rest === 0n ? `${hours}h` : `${hours}h ${rest}m`;
  return `${rest}m`;
}

/** Hours in a week, Monday 00:00 to the next Monday 00:00. */
export const WEEK_HOURS = 168;

/**
 * The 24/5 week in hours from Monday 00:00 New York time: open from Sunday 20:00 to Friday 20:00 with no daily
 * break (session-calendar.md R3). Holidays and early closes are the onchain calendar's business; the landing only
 * draws the regular week, and every reopen time it prints comes from the market read.
 */
export const SESSION_WEEK = {
  /** Friday 20:00. */
  closesAt: 116,
  /** Sunday 20:00. */
  opensAt: 164,
} as const;

const NEW_YORK_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  hourCycle: 'h23',
});

/** Hours since Monday 00:00 New York time, from 0 up to 168. Only the numbers come from Intl. */
export function newYorkWeekHour(seconds: bigint): number {
  const parts = new Map(NEW_YORK_PARTS.formatToParts(utcDate(seconds)).map((part) => [part.type, part.value]));
  const year = Number(parts.get('year'));
  const month = Number(parts.get('month'));
  const day = Number(parts.get('day'));
  const hour = Number(parts.get('hour')) % 24;
  const minute = Number(parts.get('minute'));
  const sundayFirst = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const mondayFirst = (sundayFirst + 6) % 7;
  return mondayFirst * 24 + hour + minute / 60;
}
