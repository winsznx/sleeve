import { describe, expect, it } from 'vitest';

import { createMockDataLayer, SAMPLE_ACCOUNT, SAMPLE_RECEIPT_IDS, SAMPLE_WEEK_START } from '@/data/mock';
import type { CardData, ReceiptRecord, SleeveDataLayer } from '@/data/types';

import { cardInputOf, draftPaydayCard, draftWeekCard, type CardChoices, type WeekReceipts } from './card-draft';
import { weekEndOf } from './week';

const CHOICES: readonly CardChoices[] = [
  { showAmounts: false, showProof: false },
  { showAmounts: true, showProof: false },
  { showAmounts: false, showProof: true },
  { showAmounts: true, showProof: true },
];

const at = (iso: string): bigint => BigInt(Date.parse(iso) / 1_000);

async function receiptOf(layer: SleeveDataLayer, id: bigint): Promise<ReceiptRecord> {
  const record = await layer.getReceipt(id);
  if (record === null) throw new Error(`the sample history has receipt ${id}`);
  return record;
}

async function everyReceipt(layer: SleeveDataLayer): Promise<WeekReceipts> {
  const page = await layer.listReceipts({ account: SAMPLE_ACCOUNT, limit: 100 });
  return { records: page.items, exhausted: page.nextCursor === null };
}

/** The card the data layer makes, without the id it assigns. */
function withoutId(card: CardData): CardData {
  return { ...card, cardId: '' };
}

describe('draftPaydayCard', () => {
  it.each(CHOICES)('matches the payday card the data layer makes for a buy (%o)', async (choices) => {
    for (const id of [SAMPLE_RECEIPT_IDS.filledSpy, SAMPLE_RECEIPT_IDS.settled]) {
      const layer = createMockDataLayer();
      const rule = await layer.getRule(SAMPLE_ACCOUNT);
      const draft = draftPaydayCard(await receiptOf(layer, id), rule.equityBps, choices);
      const input = cardInputOf({ kind: 'receipt', receiptId: id }, null, choices);
      if (input === null) throw new Error('a receipt card always has an input');
      expect(draft).toEqual(withoutId(await layer.createCard(input)));
    }
  });

  it('makes no payday card for a receipt that bought nothing', async () => {
    const layer = createMockDataLayer();
    expect(draftPaydayCard(await receiptOf(layer, SAMPLE_RECEIPT_IDS.queuedSession), 1_000, CHOICES[0] ?? { showAmounts: false, showProof: false })).toBeNull();
  });
});

describe('draftWeekCard', () => {
  it.each(CHOICES)('matches the week card the data layer makes for each sample week (%o)', async (choices) => {
    for (const weekStart of [SAMPLE_WEEK_START, at('2026-09-14T04:00:00Z')]) {
      const layer = createMockDataLayer();
      const rule = await layer.getRule(SAMPLE_ACCOUNT);
      const draft = draftWeekCard(await everyReceipt(layer), SAMPLE_ACCOUNT, weekStart, rule.equityBps, choices);
      const input = cardInputOf({ kind: 'week', account: SAMPLE_ACCOUNT }, weekStart, choices);
      if (input === null) throw new Error('a chosen week always has an input');
      expect(draft).toEqual(withoutId(await layer.createCard(input)));
    }
  });

  it('waits for the receipts to reach the start of the week before it drafts', async () => {
    const layer = createMockDataLayer();
    const newest = await layer.listReceipts({ account: SAMPLE_ACCOUNT, limit: 2 });
    const partial: WeekReceipts = { records: newest.items, exhausted: false };
    expect(draftWeekCard(partial, SAMPLE_ACCOUNT, SAMPLE_WEEK_START, 1_000, { showAmounts: true, showProof: true })).toBeNull();
  });

  it('needs a chosen week before there is anything to make', () => {
    expect(cardInputOf({ kind: 'week', account: SAMPLE_ACCOUNT }, null, { showAmounts: false, showProof: false })).toBeNull();
  });
});

describe('weekEndOf', () => {
  it('ends a week at the next Monday midnight in New York, an hour off seven days across a clock change', () => {
    expect(weekEndOf(at('2026-09-21T04:00:00Z'))).toBe(at('2026-09-28T04:00:00Z'));
    expect(weekEndOf(at('2026-10-26T04:00:00Z'))).toBe(at('2026-11-02T05:00:00Z'));
    expect(weekEndOf(at('2026-03-02T05:00:00Z'))).toBe(at('2026-03-09T04:00:00Z'));
  });
});
