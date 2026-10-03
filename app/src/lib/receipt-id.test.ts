import { describe, expect, it } from 'vitest';

import { parseReceiptId } from './receipt-id';

describe('parseReceiptId', () => {
  it('reads a decimal id', () => {
    expect([parseReceiptId('1'), parseReceiptId('455')]).toEqual([1n, 455n]);
  });

  it('reads the largest uint256', () => {
    const max = (2n ** 256n - 1n).toString();
    expect(parseReceiptId(max)).toBe(2n ** 256n - 1n);
  });

  it('refuses zero, signs, leading zeros, hex, spaces and values past uint256', () => {
    const refused = ['0', '-1', '+1', '0455', '0x1c7', ' 455', '455 ', '1e3', '', (2n ** 256n).toString()].map(
      parseReceiptId,
    );
    expect(refused.every((id) => id === null)).toBe(true);
  });
});
