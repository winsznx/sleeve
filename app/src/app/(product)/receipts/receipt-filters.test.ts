import { describe, expect, it } from 'vitest';

import { NO_FILTERS, hasFilters, readReceiptFilters, receiptFiltersQuery } from './receipt-filters';

const read = (query: string) => readReceiptFilters(new URLSearchParams(query));

describe('receipt filters in the URL', () => {
  it('reads a ticker symbol and an onchain status', () => {
    expect(read('ticker=QQQ&status=PART_SOLD')).toEqual({ tickerId: 1, status: 'PART_SOLD' });
  });

  it('forgives case and spaces in hand-typed links', () => {
    expect(read('ticker=spy&status=part%20sold')).toEqual({ tickerId: 0, status: 'PART_SOLD' });
  });

  it('reads unknown values as no filter', () => {
    expect(read('ticker=HOOD&status=PENDING')).toEqual(NO_FILTERS);
    expect(read('')).toEqual(NO_FILTERS);
  });

  it('writes the canonical query and nothing when no filter is set', () => {
    expect(receiptFiltersQuery({ tickerId: 3, status: 'FILLED' })).toBe('?ticker=AAPL&status=FILLED');
    expect(receiptFiltersQuery({ tickerId: undefined, status: 'SOLD' })).toBe('?status=SOLD');
    expect(receiptFiltersQuery(NO_FILTERS)).toBe('');
  });

  it('round-trips every filter it writes', () => {
    const filters = { tickerId: 2, status: 'REFUSED_ACCOUNT' } as const;
    expect(read(receiptFiltersQuery(filters).slice(1))).toEqual(filters);
  });

  it('knows when any filter is set', () => {
    expect([hasFilters(NO_FILTERS), hasFilters({ tickerId: 0, status: undefined })]).toEqual([false, true]);
  });
});
