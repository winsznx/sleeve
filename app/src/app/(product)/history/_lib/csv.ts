import { EXPECTED_DECIMALS, RECEIPT_FIELDS, formatUnits, tickerById, type Receipt } from '@sleeve/core';

import { tickerSymbol } from '@/components/sleeve/text';
import type { ReceiptQuery, ReceiptRecord, SleeveDataLayer } from '@/data/types';

import type { HistoryFilters } from './filters';

/**
 * The history as CSV (PRD 7.10): one row per action, each the receipt it wrote onchain. Every SPEC 13 field gets a
 * column, in SPEC order and under its SPEC name, so a row can be checked against the chain field by field. Amounts
 * are written in whole units with every digit the receipt holds (1200, 93.725, 0.155872191234567890), never rounded
 * and never grouped, and the unit is in the header. quote and minOut change units between buys and sells, so they
 * stay raw. Two readable columns lead the row, and the stored hash and the fields derived from logs close it.
 */

const usdg = (value: bigint): string => formatUnits(value, EXPECTED_DECIMALS.USDG, { grouping: false });
const tokens = (value: bigint): string => formatUnits(value, EXPECTED_DECIMALS.STOCK_TOKEN, { grouping: false });
const feed = (value: bigint): string => formatUnits(value, EXPECTED_DECIMALS.FEED, { grouping: false });

interface FieldColumn<K extends keyof Receipt> {
  /** Defaults to the field name. */
  header?: string;
  /** Defaults to the value as a decimal string or an enum name. */
  format?: (value: Receipt[K]) => string;
}

/** One entry per receipt field: adding a field to the Receipt type fails the build until it has a column. */
const FIELD_COLUMNS: { [K in keyof Receipt]: FieldColumn<K> } = {
  id: {},
  account: {},
  ruleVersion: {},
  trigger: {},
  payer: {},
  status: {},
  reason: {},
  mode: {},
  tickerId: {},
  token: {},
  tokenUid: {},
  usdgIn: { header: 'usdgIn (USDG)', format: usdg },
  usdgToSpend: { header: 'usdgToSpend (USDG)', format: usdg },
  usdgToEquity: { header: 'usdgToEquity (USDG)', format: usdg },
  usdgSpent: { header: 'usdgSpent (USDG)', format: usdg },
  usdgQueued: { header: 'usdgQueued (USDG)', format: usdg },
  tokensIn: { header: 'tokensIn (tokens)', format: tokens },
  tokensOut: { header: 'tokensOut (tokens)', format: tokens },
  usdgOut: { header: 'usdgOut (USDG)', format: usdg },
  uiMultiplier: { format: tokens },
  execPrice: { header: 'execPrice (USDG per token)', format: usdg },
  premiumBps: {},
  roundId: {},
  answer: { header: 'answer (USD)', format: feed },
  updatedAt: { header: 'updatedAt (unix seconds)' },
  usdgRoundId: {},
  usdgAnswer: { header: 'usdgAnswer (USD)', format: feed },
  quote: { header: 'quote (raw)' },
  minOut: { header: 'minOut (raw)' },
  venueId: {},
  pool: {},
  calendarVersion: {},
  disclosureHash: {},
  l2Block: {},
  timestamp: { header: 'timestamp (unix seconds)' },
  lotId: {},
  queuedSince: { header: 'queuedSince (unix seconds)' },
  overrideClosed: {},
  overrideCapBps: {},
};

const RECEIPT_KEYS = Object.keys(RECEIPT_FIELDS) as (keyof typeof RECEIPT_FIELDS)[];

function fieldHeader<K extends keyof Receipt>(key: K): string {
  return FIELD_COLUMNS[key].header ?? key;
}

function fieldCell<K extends keyof Receipt>(key: K, receipt: Receipt): string {
  const column: FieldColumn<K> = FIELD_COLUMNS[key];
  return column.format === undefined ? String(receipt[key]) : column.format(receipt[key]);
}

/** "2026-09-22T13:40:02Z" */
function isoUtc(seconds: bigint): string {
  return new Date(Number(seconds) * 1_000).toISOString().replace('.000Z', 'Z');
}

export const CSV_HEADERS: readonly string[] = [
  'timeUtc',
  'ticker',
  ...RECEIPT_KEYS.map(fieldHeader),
  'receiptHash',
  'txHash (derived)',
  'sortedTransfers (derived)',
];

function rowOf(record: ReceiptRecord): string[] {
  const { receipt, derived } = record;
  return [
    isoUtc(receipt.timestamp),
    tickerSymbol(receipt.tickerId),
    ...RECEIPT_KEYS.map((key) => fieldCell(key, receipt)),
    record.receiptHash,
    derived.txHash,
    derived.inbound.map((transfer) => `${transfer.txHash}:${transfer.logIndex}`).join(' '),
  ];
}

/** RFC 4180: quote a cell that holds a comma, a quote or a line break, and double its quotes. */
export function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function receiptsCsv(records: readonly ReceiptRecord[]): string {
  const lines = [CSV_HEADERS, ...records.map(rowOf)].map((cells) => cells.map(csvCell).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

/**
 * sleeve-history.csv, or sleeve-history-spy-part-sold.csv with filters on. A file made from the mock data layer
 * says so in its name, sleeve-sample-history.csv, because it leaves the page and its banner behind.
 */
export function historyCsvFileName(filters: HistoryFilters, { sample = false }: { sample?: boolean } = {}): string {
  const parts = [sample ? 'sleeve-sample-history' : 'sleeve-history'];
  const symbol = filters.tickerId === undefined ? undefined : tickerById(filters.tickerId)?.symbol;
  if (symbol !== undefined) parts.push(symbol.toLowerCase());
  if (filters.status !== undefined) parts.push(filters.status.toLowerCase().replace(/_/g, '-'));
  return `${parts.join('-')}.csv`;
}

/** The largest page the data layer serves. */
const EXPORT_PAGE_SIZE = 100;

/** Every receipt a query matches, newest first, read page by page through the data layer. */
export async function fetchAllReceipts(
  layer: Pick<SleeveDataLayer, 'listReceipts'>,
  query: Omit<ReceiptQuery, 'cursor' | 'limit'>,
): Promise<ReceiptRecord[]> {
  const records: ReceiptRecord[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await layer.listReceipts({ ...query, cursor, limit: EXPORT_PAGE_SIZE });
    records.push(...page.items);
    const next = page.nextCursor;
    if (next !== null && cursors.has(next)) throw new Error('The receipt list served the same page twice');
    if (next !== null) cursors.add(next);
    cursor = next ?? undefined;
  } while (cursor !== undefined);
  return records;
}

/** Hands a file to the browser's download. The object URL outlives the click so slow browsers still read it. */
export function saveFile(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
