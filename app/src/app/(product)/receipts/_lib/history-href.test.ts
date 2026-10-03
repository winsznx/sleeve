import { describe, expect, it } from 'vitest';

import { historyHref } from './history-href';

describe('the old receipts list', () => {
  it('lands on history with no filters', () => {
    expect(historyHref({})).toBe('/history');
  });

  it('keeps the ticker and status filters an old link carries, and nothing else', () => {
    expect(historyHref({ ticker: 'SPY', status: 'FILLED', page: '2' })).toBe('/history?ticker=SPY&status=FILLED');
    expect(historyHref({ ticker: ['SPY', 'QQQ'], status: '' })).toBe('/history');
  });
});
