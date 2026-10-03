import { describe, expect, it } from 'vitest';

import { NO_FILTERS, STATUS_CHIPS, hasFilters, historyFiltersQuery, noMatchSentence, readHistoryFilters } from './filters';

const read = (query: string) => readHistoryFilters(new URLSearchParams(query));

describe('history filters in the URL', () => {
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
    expect(historyFiltersQuery({ tickerId: 3, status: 'FILLED' })).toBe('?ticker=AAPL&status=FILLED');
    expect(historyFiltersQuery({ tickerId: undefined, status: 'SOLD' })).toBe('?status=SOLD');
    expect(historyFiltersQuery(NO_FILTERS)).toBe('');
  });

  it('round-trips every filter it writes', () => {
    const filters = { tickerId: 2, status: 'REFUSED_ACCOUNT' } as const;
    expect(read(historyFiltersQuery(filters).slice(1))).toEqual(filters);
  });

  it('knows when any filter is set', () => {
    expect([hasFilters(NO_FILTERS), hasFilters({ tickerId: 0, status: undefined })]).toEqual([false, true]);
  });
});

describe('status chips', () => {
  it('names every onchain status once, in plain words, in the order a payday reads', () => {
    expect(STATUS_CHIPS.map((chip) => chip.label)).toEqual([
      'Bought',
      'Waiting',
      'Bought after waiting',
      'Moved to spend',
      'Sold',
      'Sold part of lot',
      'Not on the allowlist',
      'Account blocked',
      'Corrected',
    ]);
    expect(new Set(STATUS_CHIPS.map((chip) => chip.status)).size).toBe(9);
    expect(STATUS_CHIPS.find((chip) => chip.status === 'QUEUED')?.tone).toBe('waiting');
  });

  it('says what an empty filtered list is missing', () => {
    expect(noMatchSentence({ tickerId: 0, status: 'PART_SOLD' })).toBe('There are no SPY actions marked Sold part of lot on your account yet.');
    expect(noMatchSentence({ tickerId: undefined, status: undefined })).toBe('There are no actions on your account yet.');
  });
});
