import { RECEIPT_FIELDS } from '@sleeve/core';
import { describe, expect, it } from 'vitest';

import { createMockDataLayer, SAMPLE_ACCOUNT, SAMPLE_RECEIPT_IDS } from '@/data/mock';
import type { ReceiptPage, ReceiptQuery, ReceiptRecord } from '@/data/types';

import { CSV_HEADERS, csvCell, fetchAllReceipts, historyCsvFileName, receiptsCsv } from './csv';

async function sampleReceipt(id: bigint): Promise<ReceiptRecord> {
  const record = await createMockDataLayer().getReceipt(id);
  if (record === null) throw new Error(`no sample receipt ${id}`);
  return record;
}

function parseRow(csv: string, line: number): Map<string, string> {
  const rows = csv.trimEnd().split('\r\n').map((row) => row.split(','));
  const values = rows[line] ?? [];
  return new Map(CSV_HEADERS.map((header, index) => [header, values[index] ?? '']));
}

describe('history CSV', () => {
  it('has a column for every receipt field in SPEC order, between the readable and the derived columns', () => {
    const fields = Object.keys(RECEIPT_FIELDS);
    expect(CSV_HEADERS).toHaveLength(fields.length + 5);
    expect(CSV_HEADERS.slice(0, 3)).toEqual(['timeUtc', 'ticker', 'id']);
    expect(CSV_HEADERS.slice(-3)).toEqual(['receiptHash', 'txHash (derived)', 'sortedTransfers (derived)']);
    expect(CSV_HEADERS.slice(2, -3).map((header) => header.split(' ')[0])).toEqual(fields);
  });

  it('writes amounts in whole units with every digit and no grouping', async () => {
    const record = await sampleReceipt(SAMPLE_RECEIPT_IDS.filledSpySecond);
    const row = parseRow(receiptsCsv([record]), 1);
    expect(row.get('usdgIn (USDG)')).toBe('937.25');
    expect(row.get('usdgSpent (USDG)')).toBe('93.725');
    expect(row.get('usdgToSpend (USDG)')).toBe('843.525');
    expect(row.get('status')).toBe('FILLED');
    expect(row.get('ticker')).toBe('SPY');
    expect(row.get('timeUtc')).toBe('2026-09-25T14:05:02Z');
    expect(row.get('receiptHash')).toBe(record.receiptHash);
    expect(row.get('txHash (derived)')).toBe(record.derived.txHash);
  });

  it('keeps a negative premium and raw units exact', async () => {
    const record = await sampleReceipt(SAMPLE_RECEIPT_IDS.sold);
    const row = parseRow(receiptsCsv([record]), 1);
    expect(row.get('premiumBps')).toBe(record.receipt.premiumBps.toString());
    expect(row.get('quote (raw)')).toBe(record.receipt.quote.toString());
    expect(row.get('tokensIn (tokens)')).toMatch(/^0\.\d+$/);
  });

  it('ends every line with CRLF', async () => {
    const csv = receiptsCsv([await sampleReceipt(SAMPLE_RECEIPT_IDS.released)]);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv.split('\r\n')).toHaveLength(3);
  });

  it('quotes cells that hold commas, quotes or line breaks', () => {
    expect([csvCell('455'), csvCell('a,b'), csvCell('say "hi"'), csvCell('two\nlines')]).toEqual([
      '455',
      '"a,b"',
      '"say ""hi"""',
      '"two\nlines"',
    ]);
  });

  it('names the file after the filters', () => {
    expect(historyCsvFileName({ tickerId: undefined, status: undefined })).toBe('sleeve-history.csv');
    expect(historyCsvFileName({ tickerId: 0, status: 'PART_SOLD' })).toBe('sleeve-history-spy-part-sold.csv');
  });

  it('says in the name when the file holds sample data', () => {
    expect(historyCsvFileName({ tickerId: 1, status: undefined }, { sample: true })).toBe('sleeve-sample-history-qqq.csv');
  });
});

describe('fetchAllReceipts', () => {
  it('reads every page of the sample account', async () => {
    const records = await fetchAllReceipts(createMockDataLayer(), { account: SAMPLE_ACCOUNT });
    expect(records.map((record) => record.receipt.id)).toEqual([642n, 611n, 560n, 503n, 455n, 416n, 415n, 401n, 388n, 305n, 212n, 203n, 198n]);
  });

  it('follows the cursor from page to page with the filters kept', async () => {
    const layer = createMockDataLayer();
    const queries: ReceiptQuery[] = [];
    const paged = {
      listReceipts: (query: ReceiptQuery): Promise<ReceiptPage> => {
        queries.push(query);
        return layer.listReceipts({ ...query, limit: 2 });
      },
    };
    const records = await fetchAllReceipts(paged, { account: SAMPLE_ACCOUNT, tickerId: 0 });
    expect(records.every((record) => record.receipt.tickerId === 0)).toBe(true);
    expect(queries.length).toBeGreaterThan(2);
    expect(queries.every((query) => query.tickerId === 0)).toBe(true);
  });

  it('stops with an error when a page repeats instead of looping', async () => {
    const stuck = { listReceipts: async (): Promise<ReceiptPage> => ({ items: [], nextCursor: '7' }) };
    await expect(fetchAllReceipts(stuck, { account: SAMPLE_ACCOUNT })).rejects.toThrow('same page twice');
  });
});
