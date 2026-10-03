import { describe, expect, it } from 'vitest';

import { renderCardPng, wrapLines } from './card-image';
import { cardContent } from './card-content';

/** One unit of width per character, so line widths are easy to reason about. */
const byLength = (value: string): number => value.length;

describe('wrapLines', () => {
  it('fills each line with whole words up to the width', () => {
    expect(wrapLines('of my pay became SPY', 10, byLength)).toEqual(['of my pay', 'became SPY']);
  });

  it('keeps text that fits on one line', () => {
    expect(wrapLines('Receipt 455', 40, byLength)).toEqual(['Receipt 455']);
  });

  it('breaks a word wider than a line, such as a hash, anywhere', () => {
    expect(wrapLines('hash 0x0123456789abcdef', 8, byLength)).toEqual(['hash', '0x012345', '6789abcd', 'ef']);
  });

  it('collapses runs of spaces', () => {
    expect(wrapLines('  two   words ', 20, byLength)).toEqual(['two words']);
  });
});

describe('renderCardPng', () => {
  it('refuses to draw on a page without the design tokens instead of guessing colors', async () => {
    const content = cardContent(
      {
        kind: 'receipt',
        cardId: 'test',
        tickerId: 0,
        status: 'FILLED',
        equityBps: 1_000,
        timestamp: 1_790_084_402n,
        amounts: null,
        proof: null,
      },
      null,
    );
    await expect(renderCardPng(content)).rejects.toThrow('The design token --color-accent-soft is not set on this page');
  });
});
