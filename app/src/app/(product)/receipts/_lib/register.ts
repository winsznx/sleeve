import { formatStockToken, type Receipt } from '@sleeve/core';

import { receiptHeadline, usdgExact, usdgExactText, tickerSymbol, tokenText } from '@/components/sleeve/text';
import { tickerTokenKey } from '@/components/token/ticker-icon';
import type { TokenKey } from '@/components/token/registry';
import type { ReceiptRecord } from '@/data/types';

import { isLotCorrection, isSettleRefusal } from './outcome';

/**
 * How a list of actions reads: grouped by the UTC day they happened, and what each row pictures and says beside
 * its amount. Times stay in UTC, as everywhere a chain time is printed, so a day heading and the times under it
 * always agree with the record and with a block explorer.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function utcDate(seconds: bigint): Date {
  return new Date(Number(seconds) * 1_000);
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** "2026-09-26": the UTC calendar day, also the dateTime of the day heading. */
export function utcDayKey(seconds: bigint): string {
  const date = utcDate(seconds);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

/** "Sat 26 Sep 2026". Names are fixed here, as in format-time.ts, so server and browser print the same text. */
export function formatUtcDay(seconds: bigint): string {
  const date = utcDate(seconds);
  return `${WEEKDAYS[date.getUTCDay()] ?? ''} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()] ?? ''} ${date.getUTCFullYear()}`;
}

/** "13:30 UTC" */
export function formatUtcClock(seconds: bigint): string {
  const date = utcDate(seconds);
  return `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())} UTC`;
}

/** "2026-09-26T13:30:10.000Z", for a time element's dateTime. */
export function isoTime(seconds: bigint): string {
  return utcDate(seconds).toISOString();
}

export interface DayGroup {
  /** utcDayKey of the day. */
  key: string;
  /** formatUtcDay of the day. */
  label: string;
  records: ReceiptRecord[];
}

/**
 * Consecutive actions on the same UTC day, in the order given. The list arrives newest first, so the groups do too;
 * a day split across two pages simply continues in the group already shown.
 */
export function groupByUtcDay(records: readonly ReceiptRecord[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const record of records) {
    const key = utcDayKey(record.receipt.timestamp);
    const last = groups[groups.length - 1];
    if (last !== undefined && last.key === key) last.records.push(record);
    else groups.push({ key, label: formatUtcDay(record.receipt.timestamp), records: [record] });
  }
  return groups;
}

/** What waits on a row's icons: a clock for a waiting buy, a cross for a refused one. */
export type RowMark = 'waiting' | 'refused';

/**
 * The icons that lead an action. A payday that split names the move it made or meant to make, USDG into the Stock
 * Token; a sale is the reverse; money that only moved inside the ledgers is USDG alone.
 */
export type RowLead =
  | { kind: 'pair'; from: TokenKey; to: TokenKey; mark: RowMark | null }
  | { kind: 'single'; token: TokenKey };

const USDG: TokenKey = 'USDG';

export function rowLead(receipt: Receipt): RowLead {
  const ticker = tickerTokenKey(receipt.tickerId);
  if (ticker === null) return { kind: 'single', token: USDG };
  switch (receipt.status) {
    case 'FILLED':
    case 'SETTLED':
      return { kind: 'pair', from: USDG, to: ticker, mark: null };
    case 'QUEUED':
      return { kind: 'pair', from: USDG, to: ticker, mark: 'waiting' };
    case 'REFUSED_TICKER':
    case 'REFUSED_ACCOUNT':
      return { kind: 'pair', from: USDG, to: ticker, mark: 'refused' };
    case 'PART_SOLD':
    case 'SOLD':
      return { kind: 'pair', from: ticker, to: USDG, mark: null };
    case 'RELEASED':
      return { kind: 'single', token: USDG };
    case 'RECONCILED':
      return { kind: 'single', token: isLotCorrection(receipt) ? ticker : USDG };
  }
}

/** The line under a row's amount: what the amount became, waits for or came from. */
export interface RowOutcome {
  text: string;
  /** A token the line names, drawn at 16 px before the words. */
  token: TokenKey | null;
  tone: 'equity' | 'waiting' | 'spend' | 'plain';
}

export function rowOutcome(record: ReceiptRecord): RowOutcome {
  const { receipt } = record;
  const symbol = tickerSymbol(receipt.tickerId);
  const ticker = tickerTokenKey(receipt.tickerId);
  switch (receipt.status) {
    case 'FILLED':
    case 'SETTLED':
      return { text: `became ${tokenText(receipt.tokensOut, symbol)}`, token: ticker, tone: 'equity' };
    case 'QUEUED':
      return { text: `${usdgExactText(receipt.usdgQueued)} waits to buy ${symbol}`, token: null, tone: 'waiting' };
    case 'REFUSED_TICKER':
    case 'REFUSED_ACCOUNT':
      return isSettleRefusal(receipt)
        ? { text: 'moved to spend', token: null, tone: 'spend' }
        : { text: 'all of it stayed spendable', token: null, tone: 'spend' };
    case 'RELEASED':
      return { text: 'moved to spend', token: null, tone: 'spend' };
    case 'PART_SOLD':
    case 'SOLD':
      return { text: `for ${tokenText(receipt.tokensIn, symbol)}`, token: ticker, tone: 'plain' };
    case 'RECONCILED':
      return isLotCorrection(receipt)
        ? { text: `taken off lot ${receipt.lotId.toString()}`, token: null, tone: 'plain' }
        : { text: 'taken off the ledgers', token: null, tone: 'plain' };
  }
}

export interface RowAmount {
  /** Every digit the receipt holds, two places at least: "1,200.00", "93.725", "0.05". */
  value: string;
  unit: string;
}

/**
 * The amount a row leads with, in USDG for every action but a lot's correction, which moved no USDG and trimmed
 * Stock Tokens. A release and a settle's refusal leave usdgIn zero onchain and carry what they moved to spend as
 * usdgToSpend, so those rows read it; every other row reads the shared headline.
 */
export function rowAmount(record: ReceiptRecord): RowAmount {
  const { receipt } = record;
  if (isLotCorrection(receipt)) return { value: formatStockToken(receipt.tokensIn), unit: tickerSymbol(receipt.tickerId) };
  const usdg = receipt.status === 'RELEASED' || isSettleRefusal(receipt) ? receipt.usdgToSpend : receiptHeadline(record);
  return { value: usdgExact(usdg), unit: 'USDG' };
}
