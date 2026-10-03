import {
  CALENDAR_COVERAGE,
  TOTAL_BPS,
  calendarDayKind,
  calendarWeekday,
  formatBps,
  formatUsdg,
  newYorkLocalTime,
  type Rule,
  type TickerId,
} from '@sleeve/core';

import type { CalendarCell, PaydayMark } from '@/components/charts/month-calendar';
import type { ChartBar } from '@/components/charts/stacked-bar-chart';
import { tickerSymbol, usdgExactText } from '@/components/sleeve/text';
import { REASON_LABEL } from '@/components/ui/badge';
import { formatNewYork } from '@/components/ui/format-time';
import type { BucketView, Holding, ReceiptRecord, SplitPreview } from '@/data/types';

import { waitEndOf } from '../../payments/_lib/payments';

/**
 * The overview's numbers (D-029), each built from receipts, holdings and the session calendar, never from a figure
 * typed into a screen. A payday is a split receipt: what arrived, what stayed spendable, what bought a Stock Token and
 * what still waits. Nothing here measures how a holding did; Sleeve makes no performance claim.
 */

const DAY_SECONDS = 86_400n;

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
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export interface PaydayPoint {
  id: string;
  record: ReceiptRecord;
  /** When the split ran, unix seconds. */
  at: bigint;
  /** USDG the split sorted. */
  total: bigint;
  /** What stayed spendable, with equity that a refusal or a release sent to spend. */
  spend: bigint;
  /** What bought Stock Tokens, at the split or after a wait. */
  bought: bigint;
  /** What still waits as USDG. */
  waiting: bigint;
  tickerId: TickerId;
}

/** Every payday in the receipts read so far, oldest first. Receipts arrive newest first, as listReceipts gives them. */
export function paydayPoints(newestFirst: readonly ReceiptRecord[], exhausted: boolean): PaydayPoint[] {
  const points: PaydayPoint[] = [];
  for (const record of newestFirst) {
    const r = record.receipt;
    const base = { id: r.id.toString(), record, at: r.timestamp, total: r.usdgIn, tickerId: r.tickerId };
    switch (r.status) {
      case 'FILLED':
        points.push({ ...base, spend: r.usdgToSpend, bought: r.usdgSpent, waiting: 0n });
        break;
      case 'QUEUED': {
        const end = waitEndOf(record, newestFirst, exhausted);
        if (end === null) points.push({ ...base, spend: r.usdgToSpend, bought: 0n, waiting: r.usdgQueued });
        else if (end.kind === 'bought') points.push({ ...base, spend: r.usdgToSpend, bought: r.usdgQueued, waiting: 0n });
        else points.push({ ...base, spend: r.usdgToSpend + r.usdgQueued, bought: 0n, waiting: 0n });
        break;
      }
      case 'REFUSED_TICKER':
      case 'REFUSED_ACCOUNT':
        points.push({ ...base, spend: r.usdgIn, bought: 0n, waiting: 0n });
        break;
      default:
        break;
    }
  }
  return points.reverse();
}

/** The New York calendar day of an instant, as the session calendar numbers days; UTC outside its coverage. */
export function newYorkDay(timestamp: bigint): bigint {
  if (timestamp >= CALENDAR_COVERAGE.start && timestamp < CALENDAR_COVERAGE.end) return newYorkLocalTime(timestamp).day;
  return timestamp / DAY_SECONDS;
}

function dateOfDay(day: bigint): Date {
  return new Date(Number(day * DAY_SECONDS) * 1_000);
}

/** "22 Sep" */
export function shortDayLabel(day: bigint): string {
  const date = dateOfDay(day);
  return `${date.getUTCDate()} ${(MONTHS[date.getUTCMonth()] ?? '').slice(0, 3)}`;
}

/** "Tuesday 22 September" */
export function longDayLabel(day: bigint): string {
  const date = dateOfDay(day);
  return `${WEEKDAYS[date.getUTCDay()] ?? ''} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()] ?? ''}`;
}

/** Monday of the New York week the day falls in. */
export function weekStartOf(day: bigint): bigint {
  return day - ((calendarWeekday(day) + 6n) % 7n);
}

export interface PeriodPoint {
  id: string;
  /** The first New York day of the period. */
  day: bigint;
  total: bigint;
  spend: bigint;
  bought: bigint;
  waiting: bigint;
  paydays: PaydayPoint[];
}

/** Paydays one by one, or summed by New York week from Monday. Oldest first. */
export function periodPoints(points: readonly PaydayPoint[], by: 'payday' | 'week'): PeriodPoint[] {
  if (by === 'payday') {
    return points.map((point) => ({ ...point, day: newYorkDay(point.at), paydays: [point] }));
  }
  const weeks = new Map<bigint, PeriodPoint>();
  for (const point of points) {
    const start = weekStartOf(newYorkDay(point.at));
    const week = weeks.get(start) ?? { id: `week-${start}`, day: start, total: 0n, spend: 0n, bought: 0n, waiting: 0n, paydays: [] };
    week.total += point.total;
    week.spend += point.spend;
    week.bought += point.bought;
    week.waiting += point.waiting;
    week.paydays.push(point);
    weeks.set(start, week);
  }
  return [...weeks.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
}

/** Whole USDG as a number, which is all a bar's proportions need. */
function usdgNumber(amount: bigint): number {
  return Number(amount / 10_000n) / 100;
}

/** What one period became, in words: "1,080.00 USDG stayed spendable and 120.00 USDG bought SPY." */
export function becameSentence(period: PeriodPoint): string {
  const tickers = [...new Set(period.paydays.map((payday) => tickerSymbol(payday.tickerId)))].join(' and ');
  const parts = [`${usdgExactText(period.spend)} stayed spendable`];
  if (period.bought > 0n) parts.push(`${usdgExactText(period.bought)} bought ${tickers}`);
  if (period.waiting > 0n) parts.push(`${usdgExactText(period.waiting)} waits to buy ${tickers}`);
  return `${parts.slice(0, -1).join(', ')}${parts.length > 1 ? ' and ' : ''}${parts.at(-1) ?? ''}.`;
}

export function periodTitle(period: PeriodPoint, by: 'payday' | 'week'): string {
  return by === 'week' ? `Week of ${longDayLabel(period.day)}` : longDayLabel(period.day);
}

/** The chart's bars: spend at the bottom, then what bought, then what waits. */
export function chartBars(periods: readonly PeriodPoint[], by: 'payday' | 'week'): ChartBar[] {
  return periods.map((period) => ({
    id: period.id,
    label: by === 'week' ? shortDayLabel(period.day) : dateOfDay(period.day).getUTCDate().toString(),
    parts: [
      { kind: 'spend', value: usdgNumber(period.spend) },
      { kind: 'equity', value: usdgNumber(period.bought) },
      { kind: 'waiting', value: usdgNumber(period.waiting) },
    ],
    pill: `${formatUsdg(period.total)} USDG`,
    description: `${periodTitle(period, by)}: ${usdgExactText(period.total)} arrived. ${becameSentence(period)}`,
  }));
}

/** "1,500" for an axis tick in whole USDG. */
export function tickText(value: number): string {
  return value >= 10_000 ? `${Math.round(value / 1_000).toLocaleString('en-US')}k` : Math.round(value).toLocaleString('en-US');
}

export interface AllocationSlice {
  tickerId: TickerId;
  value: bigint;
  /** Basis points of the Stock Tokens' total value, rounded down. */
  bps: number;
}

/** Stock Tokens held, by ticker, valued at the Chainlink reference, largest first. */
export function allocation(holdings: readonly Holding[]): { total: bigint; slices: AllocationSlice[] } {
  const held = holdings.filter((holding) => holding.balance > 0n && holding.value > 0n);
  const total = held.reduce((sum, holding) => sum + holding.value, 0n);
  const slices = held
    .map((holding) => ({ tickerId: holding.tickerId, value: holding.value, bps: total === 0n ? 0 : Number((holding.value * 10_000n) / total) }))
    .sort((a, b) => (a.value === b.value ? a.tickerId - b.tickerId : a.value > b.value ? -1 : 1));
  return { total, slices };
}

export interface UpNextLine {
  id: string;
  kind: 'sort' | 'wait' | 'idle';
  text: string;
}

/**
 * What happens next to the money in the account, from the split preview and the buckets: the unsorted USDG and how
 * it would split, each bucket and what it waits for. One line saying nothing is pending when nothing is.
 */
export function upNext(
  preview: SplitPreview,
  buckets: readonly BucketView[],
  rule: Rule,
  reopensAt: (tickerId: TickerId) => bigint | null | undefined,
): UpNextLine[] {
  const lines: UpNextLine[] = [];
  const symbol = tickerSymbol(preview.tickerId);
  if (preview.unsorted > 0n) {
    const head = `${usdgExactText(preview.unsorted)} not sorted yet`;
    let text: string;
    if (preview.ruleStatus !== 'ACTIVE') {
      text = `${head} stays spendable until ${preview.ruleStatus === 'PAUSED' ? 'you resume your rule' : 'you set a rule'}.`;
    } else if (preview.equityPart === 0n) {
      text = `${head} splits next, and all of it stays spendable.`;
    } else {
      const equity =
        preview.outcome?.kind === 'BUY'
          ? `${usdgExactText(preview.equityPart)} buys ${symbol}`
          : preview.outcome?.kind === 'REFUSE'
            ? `${usdgExactText(preview.equityPart)} goes to spend`
            : `${usdgExactText(preview.equityPart)} waits to buy ${symbol}`;
      text = `${head} splits next: ${usdgExactText(preview.spendPart)} stays spendable and ${equity}.`;
    }
    lines.push({ id: 'sort', kind: 'sort', text });
  }
  for (const bucket of buckets) {
    const bucketSymbol = tickerSymbol(bucket.tickerId);
    const opens = reopensAt(bucket.tickerId);
    const text =
      bucket.reason === 'SESSION'
        ? `${usdgExactText(bucket.amount)} buys ${bucketSymbol} after the market opens${opens === null || opens === undefined ? '' : `, ${formatNewYork(opens)}`}.`
        : bucket.reason === 'NONE'
          ? `${usdgExactText(bucket.amount)} waits to buy ${bucketSymbol}.`
          : `${usdgExactText(bucket.amount)} waits to buy ${bucketSymbol}. ${REASON_LABEL[bucket.reason]}.`;
    lines.push({ id: `wait-${bucket.tickerId}`, kind: 'wait', text });
  }
  if (lines.length === 0) {
    lines.push({
      id: 'idle',
      kind: 'idle',
      text:
        rule.status === 'ACTIVE'
          ? `Nothing is pending. Your next payment splits by your rule: ${formatBps(TOTAL_BPS - rule.equityBps)} stays spendable and ${formatBps(rule.equityBps)} buys ${tickerSymbol(rule.tickerId)}.`
          : 'Nothing is pending. Payments stay spendable until your rule splits them.',
    });
  }
  return lines;
}

export interface MonthRef {
  year: number;
  /** 0 for January. */
  month: number;
}

export function monthOfDay(day: bigint): MonthRef {
  const date = dateOfDay(day);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() };
}

export function shiftMonth(ref: MonthRef, by: number): MonthRef {
  const index = ref.year * 12 + ref.month + by;
  return { year: Math.floor(index / 12), month: ((index % 12) + 12) % 12 };
}

export function monthTitle(ref: MonthRef): string {
  return `${MONTHS[ref.month] ?? ''} ${ref.year}`;
}

/** Whether the session calendar covers any of the month, so a step to it shows real market days. */
export function monthCovered(ref: MonthRef): boolean {
  const first = BigInt(Date.UTC(ref.year, ref.month, 1) / 1_000);
  const next = BigInt(Date.UTC(ref.year, ref.month + 1, 1) / 1_000);
  return next > CALENDAR_COVERAGE.start && first < CALENDAR_COVERAGE.end;
}

function markOf(point: PaydayPoint): PaydayMark {
  if (point.waiting > 0n) return 'waiting';
  if (point.bought > 0n) return 'bought';
  return 'spend';
}

const MARK_WORDS: Record<PaydayMark, string> = {
  bought: 'bought Stock Tokens',
  waiting: 'waits to buy',
  spend: 'all stayed spendable',
};

/**
 * One month as rows of seven, Monday first. A weekend or a holiday is a closed day: an ALL_DAY session trades from
 * 20:00 the evening before a trading day to 20:00 on it, so those days stay closed until their evening at most.
 */
export function monthCells(ref: MonthRef, paydays: readonly PaydayPoint[], today: bigint, reopensOn: bigint | null): CalendarCell[][] {
  const first = BigInt(Date.UTC(ref.year, ref.month, 1) / 86_400_000);
  const length = Number(BigInt(Date.UTC(ref.year, ref.month + 1, 1) / 86_400_000) - first);
  const lead = Number((calendarWeekday(first) + 6n) % 7n);
  const byDay = new Map<bigint, PaydayPoint[]>();
  for (const payday of paydays) {
    const day = newYorkDay(payday.at);
    byDay.set(day, [...(byDay.get(day) ?? []), payday]);
  }

  const cells: CalendarCell[] = [];
  for (let index = 0; index < lead; index += 1) {
    cells.push({ key: `lead-${index}`, date: null, closed: false, today: false, reopens: false, marks: [], description: '' });
  }
  for (let offset = 0; offset < length; offset += 1) {
    const day = first + BigInt(offset);
    const kind = calendarDayKind(day);
    const closed = kind === 'WEEKEND' || kind === 'HOLIDAY';
    const dayPaydays = byDay.get(day) ?? [];
    const marks = dayPaydays.map(markOf);
    const words = [longDayLabel(day)];
    if (day === today) words.push('today');
    words.push(kind === 'HOLIDAY' ? 'market holiday' : closed ? 'market closed' : kind === 'EARLY_CLOSE' ? 'market closes early' : 'market open');
    if (reopensOn !== null && day === reopensOn) words.push('the market opens again this evening');
    if (dayPaydays.length > 0) {
      words.push(`${dayPaydays.length === 1 ? '1 payday' : `${dayPaydays.length} paydays`}: ${marks.map((mark) => MARK_WORDS[mark]).join(', ')}`);
    }
    cells.push({
      key: day.toString(),
      date: offset + 1,
      closed,
      today: day === today,
      reopens: reopensOn !== null && day === reopensOn,
      marks,
      description: words.join(', '),
    });
  }
  while (cells.length % 7 !== 0) {
    cells.push({ key: `tail-${cells.length}`, date: null, closed: false, today: false, reopens: false, marks: [], description: '' });
  }
  const weeks: CalendarCell[][] = [];
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));
  return weeks;
}
