import { describe, expect, it } from 'vitest';

import { createMockDataLayer, SAMPLE_RECEIPT_IDS, SAMPLE_WEEK_START } from '@/data/mock';
import type { ReceiptCard } from '@/data/types';

import { CARD_ART_VERSION, DEFAULT_CARD_LOOK } from './card-options';
import { cardFingerprint } from './card-view';
import { findSampleRecipe, readSampleRequest, sampleImagePath } from './sample-card';

describe('sample card addresses', () => {
  it('reads what a card was made from, and nothing else', () => {
    // #when an address names a receipt, or a week
    const receipt = readSampleRequest(new URLSearchParams('receipt=455&showAmounts=1&expect=0a1b2c3d'));
    const week = readSampleRequest(new URLSearchParams('week=1789963200&showProof=1'));

    // #then it reads the subject, the two choices and the fingerprint
    expect(receipt).toEqual({
      input: { subject: { kind: 'receipt', receiptId: 455n }, showAmounts: true, showProof: false },
      fingerprint: '0a1b2c3d',
    });
    expect(week).toEqual({
      input: { subject: { kind: 'week', weekStart: 1_789_963_200n }, showAmounts: false, showProof: true },
      fingerprint: null,
    });
  });

  it('refuses an address that names nothing, names too much or carries a bad fingerprint', () => {
    const refused = ['', 'receipt=455&week=1789963200', 'receipt=0455', 'week=-1', 'receipt=455&expect=<script>'];
    expect(refused.map((query) => readSampleRequest(new URLSearchParams(query)))).toEqual([null, null, null, null, null]);
  });

  it('carries the recipe, the fingerprint and the look in the image address', () => {
    // #given a recipe for receipt 455 with proof
    const recipe = {
      input: { subject: { kind: 'receipt' as const, receiptId: 455n }, showAmounts: false, showProof: true },
      fingerprint: '0a1b2c3d',
    };

    // #when the wide deep download is asked for
    const path = sampleImagePath(recipe, 'wide', { ...DEFAULT_CARD_LOOK, theme: 'deep' }, true);

    // #then the address holds all of it and no words
    expect(path).toBe(`/api/card/sample/wide?receipt=455&showProof=1&expect=0a1b2c3d&theme=deep&download=1&v=${CARD_ART_VERSION}`);
  });
});

describe('finding what a tab card was made from', () => {
  it('names the week of a week card', async () => {
    // #given a week card made in a tab
    const layer = createMockDataLayer();
    const card = await layer.createCard({ subject: { kind: 'week', weekStart: SAMPLE_WEEK_START }, showAmounts: true, showProof: false });

    // #when its recipe is found
    const recipe = await findSampleRecipe(layer, card);

    // #then it names the week, the choices and the card's fingerprint
    expect(recipe).toEqual({
      input: { subject: { kind: 'week', weekStart: SAMPLE_WEEK_START }, showAmounts: true, showProof: false },
      fingerprint: cardFingerprint(card),
    });
  });

  it('matches a payday card to the owner buy it shows, even without proof', async () => {
    // #given a payday card without proof, which names no receipt
    const layer = createMockDataLayer();
    const card = await layer.createCard({
      subject: { kind: 'receipt', receiptId: SAMPLE_RECEIPT_IDS.settled },
      showAmounts: false,
      showProof: false,
    });

    // #when its recipe is found
    const recipe = await findSampleRecipe(layer, card);

    // #then the signed-in owner's receipts lead back to the buy
    expect(recipe?.input.subject).toEqual({ kind: 'receipt', receiptId: SAMPLE_RECEIPT_IDS.settled });
  });

  it('gives up on a card that matches no buy', async () => {
    // #given a payday card for a moment the owner bought nothing
    const layer = createMockDataLayer();
    const card = await layer.createCard({
      subject: { kind: 'receipt', receiptId: SAMPLE_RECEIPT_IDS.filledSpy },
      showAmounts: false,
      showProof: false,
    });
    if (card.kind !== 'receipt') throw new Error('expected a payday card');
    const unknown: ReceiptCard = { ...card, timestamp: 1n };

    // #then there is no recipe
    expect(await findSampleRecipe(layer, unknown)).toBeNull();
  });

  it('gives up when nobody is signed in', async () => {
    // #given a payday card and a tab that signed out
    const layer = createMockDataLayer();
    const card = await layer.createCard({
      subject: { kind: 'receipt', receiptId: SAMPLE_RECEIPT_IDS.filledSpy },
      showAmounts: false,
      showProof: false,
    });
    await layer.signOut();

    // #then there is no owner to match against
    expect(await findSampleRecipe(layer, card)).toBeNull();
  });
});
