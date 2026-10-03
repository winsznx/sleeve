import { describe, expect, it } from 'vitest';

import { readSellStart } from './sell-start';

describe('where the sell screen starts', () => {
  it('reads a ticker from a holding and a lot from a buy', () => {
    expect(readSellStart({ ticker: 'SPY' })).toEqual({ tickerId: 0, lotId: undefined });
    expect(readSellStart({ ticker: ' qqq ', lot: '305' })).toEqual({ tickerId: 1, lotId: 305n });
  });

  it('ignores what it cannot read, and a lot without its ticker', () => {
    expect(readSellStart({ ticker: 'HOOD', lot: '305' })).toEqual({ tickerId: undefined, lotId: undefined });
    expect(readSellStart({ lot: '305' })).toEqual({ tickerId: undefined, lotId: undefined });
    expect(readSellStart({ ticker: 'SPY', lot: '0x1c7' })).toEqual({ tickerId: 0, lotId: undefined });
    expect(readSellStart({ ticker: ['SPY', 'QQQ'] })).toEqual({ tickerId: undefined, lotId: undefined });
  });
});
