import { describe, expect, it } from 'vitest';

import { amountSizeClass } from './swap-parts';

describe('amountSizeClass', () => {
  it('keeps a short amount large and steps a long one down so every digit stays in view', () => {
    expect(amountSizeClass('')).toBe('text-figure-l');
    expect(amountSizeClass('0.1')).toBe('text-figure-l');
    expect(amountSizeClass('0.361667810')).toBe('text-figure-l');
    expect(amountSizeClass('0.3616678100')).toBe('text-figure-m');
    expect(amountSizeClass('0.033504302220000001')).toBe('text-figure-s max-sm:text-body-l max-sm:font-semibold');
  });
});
