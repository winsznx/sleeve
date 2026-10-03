import { describe, expect, it } from 'vitest';

import { CARD_ART_VERSION, DEFAULT_CARD_LOOK, cardImagePath, cardLookQuery, isCardFormat, isCardId, readCardLook } from './card-options';

describe('card image addresses', () => {
  it('shows everything the owner chose to show unless a toggle says 0', () => {
    // #given addresses with no toggles, both toggles off, and values that are not 0
    const plain = readCardLook(new URLSearchParams());
    const hidden = readCardLook(new URLSearchParams('theme=deep&amounts=0&proof=0'));
    const other = readCardLook(new URLSearchParams('amounts=1&proof=yes'));

    // #then only 0 hides
    expect(plain).toEqual(DEFAULT_CARD_LOOK);
    expect(hidden).toEqual({ theme: 'deep', amounts: false, proof: false });
    expect(other).toMatchObject({ amounts: true, proof: true });
  });

  it('falls back to the default look for a colorway it does not know', () => {
    // #when an address names a colorway that does not exist
    const look = readCardLook(new URLSearchParams('theme=lime'));

    // #then the default colorway draws
    expect(look.theme).toBe('paper');
  });

  it('keeps the plain address for the plain card', () => {
    // #then defaults leave the query empty and only changes are written
    expect(cardLookQuery(DEFAULT_CARD_LOOK).toString()).toBe('');
    expect(cardLookQuery({ theme: 'mint', amounts: false, proof: true }).toString()).toBe('theme=mint&amounts=0');
  });

  it('builds the image route with the look, the download flag and the art version', () => {
    // #when the page asks for the plain post and for a wide download with proof left off
    const plain = cardImagePath({ cardId: 'r8KQm2xV4nPz', format: 'post', look: DEFAULT_CARD_LOOK });
    const wide = cardImagePath({
      cardId: 'r8KQm2xV4nPz',
      format: 'wide',
      look: { theme: 'stage', amounts: true, proof: false },
      download: true,
    });

    // #then both carry the art version so caches refresh when the art changes
    expect(plain).toBe(`/api/card/r8KQm2xV4nPz/post?v=${CARD_ART_VERSION}`);
    expect(wide).toBe(`/api/card/r8KQm2xV4nPz/wide?theme=stage&proof=0&download=1&v=${CARD_ART_VERSION}`);
  });

  it('accepts only opaque ids, never the sample route name', () => {
    expect(['r8KQm2xV4nPz', '', '../receipts', 'sample', 'x'.repeat(65)].map(isCardId)).toEqual([true, false, false, false, false]);
  });

  it('accepts only the two sizes', () => {
    expect(['post', 'wide', 'story', 'toString'].map(isCardFormat)).toEqual([true, true, false, false]);
  });
});
