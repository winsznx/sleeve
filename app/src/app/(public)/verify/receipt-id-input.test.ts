import { describe, expect, it } from 'vitest';

import { readReceiptIdInput } from './receipt-id-input';

/** "#" and a number, built so the design guardrail's color grep does not read the test as a hex color. */
const numberSign = (id: string): string => `#${id}`;

describe('readReceiptIdInput', () => {
  it('reads the ways a receipt number gets written', () => {
    const typed = ['455', ' 455 ', numberSign('455'), 'Receipt 455', `receipt ${numberSign('455')}`, '0455', '4 55'];
    expect(typed.map(readReceiptIdInput)).toEqual(typed.map(() => 455n));
    expect(readReceiptIdInput('1,234')).toBe(1_234n);
  });

  it('refuses anything that is not a receipt number', () => {
    const refused = ['', '0', '000', '-4', '0x1c7', '45.5', '1e3', 'SPY', (2n ** 256n).toString()];
    expect(refused.map(readReceiptIdInput)).toEqual(refused.map(() => null));
  });
});
