import { formatUtc, formatUtcDate } from '@/components/ui/format-time';

/**
 * Market times in words for the session pill, the rail card and the menus. Times read in New York time, where the
 * US session is defined, like formatNewYork in components/ui/format-time.ts. Only the numbers come from Intl; names
 * are fixed here, because Intl's names differ between ICU versions and would make hydration mismatch. Chain times,
 * such as when a feed last updated, read in UTC like everywhere else in the app.
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

const NEW_YORK = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  hourCycle: 'h23',
});

interface NewYorkParts {
  weekday: number;
  day: number;
  month: number;
  hour: number;
  minute: number;
}

function newYorkParts(seconds: bigint): NewYorkParts {
  const parts = new Map(NEW_YORK.formatToParts(new Date(Number(seconds) * 1_000)).map((part) => [part.type, part.value]));
  const year = Number(parts.get('year'));
  const month = Number(parts.get('month'));
  const day = Number(parts.get('day'));
  return {
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
    day,
    month,
    hour: Number(parts.get('hour')) % 24,
    minute: Number(parts.get('minute')),
  };
}

function clock(parts: NewYorkParts): string {
  return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

/** "Sun 4 Oct, 20:00" */
export function newYorkShort(seconds: bigint): string {
  const parts = newYorkParts(seconds);
  return `${WEEKDAYS[parts.weekday]?.slice(0, 3) ?? ''} ${parts.day} ${MONTHS[parts.month - 1]?.slice(0, 3) ?? ''}, ${clock(parts)}`;
}

/** "Sunday 4 October at 20:00 New York time", for accessible names and sentences read aloud. */
export function newYorkLong(seconds: bigint): string {
  const parts = newYorkParts(seconds);
  return `${WEEKDAYS[parts.weekday] ?? ''} ${parts.day} ${MONTHS[parts.month - 1] ?? ''} at ${clock(parts)} New York time`;
}

/** Whole minutes left, rounded up, so a countdown never reads zero while the state has not changed yet. */
function minutesLeft(seconds: bigint): bigint {
  if (seconds <= 0n) return 0n;
  return (seconds + 59n) / 60n;
}

/** The two largest units of a span: "1d 6h", "6h 13m", "45m", "1m". Zero or less reads "now". */
export function countdownShort(seconds: bigint): string {
  const minutes = minutesLeft(seconds);
  if (minutes === 0n) return 'now';
  const days = minutes / 1_440n;
  const hours = (minutes % 1_440n) / 60n;
  const rest = minutes % 60n;
  if (days > 0n) return hours > 0n ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0n) return rest > 0n ? `${hours}h ${rest}m` : `${hours}h`;
  return `${rest}m`;
}

function unit(count: bigint, name: string): string {
  return `${count} ${name}${count === 1n ? '' : 's'}`;
}

/** The same span spelled out for screen readers: "1 day 6 hours", "6 hours 13 minutes", "1 minute". */
export function countdownLong(seconds: bigint): string {
  const minutes = minutesLeft(seconds);
  if (minutes === 0n) return 'now';
  const days = minutes / 1_440n;
  const hours = (minutes % 1_440n) / 60n;
  const rest = minutes % 60n;
  if (days > 0n) return hours > 0n ? `${unit(days, 'day')} ${unit(hours, 'hour')}` : unit(days, 'day');
  if (hours > 0n) return rest > 0n ? `${unit(hours, 'hour')} ${unit(rest, 'minute')}` : unit(hours, 'hour');
  return unit(rest, 'minute');
}

/**
 * When a set of chain times fell, for a line that stands for several readings at once: "25 Sep 2026, 16:03 UTC"
 * when they agree, "25 Sep 2026, 16:03 to 19:56 UTC" within one day, both in full across days. Null for none.
 */
export function utcSpan(times: readonly bigint[]): string | null {
  if (times.length === 0) return null;
  const first = times.reduce((earliest, time) => (time < earliest ? time : earliest));
  const last = times.reduce((latest, time) => (time > latest ? time : latest));
  if (first === last) return formatUtc(first);
  if (formatUtcDate(first) !== formatUtcDate(last)) return `${formatUtc(first)} to ${formatUtc(last)}`;
  return `${formatUtc(first).replace(/ UTC$/, '')} to ${formatUtc(last).slice(formatUtcDate(last).length + 2)}`;
}
