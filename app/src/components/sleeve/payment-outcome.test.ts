import { beforeAll, describe, expect, it } from 'vitest';

import { createMockDataLayer, SAMPLE_ACCOUNT, SAMPLE_RECEIPT_IDS } from '@/data/mock';
import type { InboxItem, ReceiptRecord } from '@/data/types';

import { lintText } from '../../../../scripts/copy-lint.mjs';
import { paymentStory, secondsToSort, type PaymentStory, type WaitEnd } from './payment-outcome';

let inbox: InboxItem[] = [];
let receipts: ReceiptRecord[] = [];

beforeAll(async () => {
  const layer = createMockDataLayer();
  [inbox, receipts] = await Promise.all([
    layer.getInbox(SAMPLE_ACCOUNT),
    layer.listReceipts({ account: SAMPLE_ACCOUNT, limit: 100 }).then((page) => page.items),
  ]);
});

function receipt(id: bigint): ReceiptRecord {
  const found = receipts.find((record) => record.receipt.id === id);
  if (found === undefined) throw new Error(`no receipt ${id}`);
  return found;
}

function paymentSortedBy(id: bigint): InboxItem {
  const found = inbox.find((item) => item.sortedBy?.receiptId === id);
  if (found === undefined) throw new Error(`no payment sorted by ${id}`);
  return found;
}

function lintClean(story: PaymentStory): void {
  for (const text of [story.spendLine, story.equityLine, story.note]) {
    if (text !== null) expect(lintText(text)).toEqual([]);
  }
}

describe('paymentStory', () => {
  it('says a payment not sorted yet stays spendable, and when anyone may split one waiting out the grace period', () => {
    const [received, waiting] = inbox;
    if (received === undefined || waiting === undefined) throw new Error('no unsorted payments');
    expect(paymentStory(received, null)).toMatchObject({
      tone: 'unsorted',
      parts: null,
      note: 'Not sorted yet. It is spendable in your account until your rule splits it.',
    });
    expect(paymentStory(waiting, null).note).toBe(
      "Not sorted yet. It is spendable in your account until your rule splits it. If Sleeve's keeper has not sorted it by 26 Sep 2026, 18:22 UTC, anyone can start the split.",
    );
  });

  it('holds its place while the split loads', () => {
    expect(paymentStory(paymentSortedBy(SAMPLE_RECEIPT_IDS.filledSpy), undefined)).toMatchObject({ tone: 'loading', note: null });
  });

  it('tells a buy: what stayed spendable and what became the Stock Token, with the debt security line', () => {
    const story = paymentStory(paymentSortedBy(SAMPLE_RECEIPT_IDS.filledSpy), receipt(SAMPLE_RECEIPT_IDS.filledSpy));
    expect(story).toMatchObject({
      tone: 'bought',
      parts: { spend: 1_080_000_000n, equity: 120_000_000n, waiting: 0n },
      spendLine: '1,080.00 USDG stayed spendable',
      equityLine: '120.00 USDG became 0.155872 SPY',
      tickerId: 0,
      bought: true,
    });
    lintClean(story);
  });

  it('tells a share still waiting, with its reason', () => {
    const story = paymentStory(paymentSortedBy(SAMPLE_RECEIPT_IDS.queuedSession), receipt(SAMPLE_RECEIPT_IDS.queuedSession));
    expect(story).toMatchObject({
      tone: 'waiting',
      parts: { spend: 675_000_000n, equity: 0n, waiting: 75_000_000n },
      equityLine: '75.00 USDG waits as USDG to buy SPY',
      reason: 'SESSION',
      bought: false,
    });
  });

  it('tells how a wait ended: bought later, or moved to spend', () => {
    const queued = receipt(SAMPLE_RECEIPT_IDS.queuedSessionSettled);
    const bought: WaitEnd = { kind: 'bought', record: receipt(SAMPLE_RECEIPT_IDS.settled) };
    const boughtStory = paymentStory(paymentSortedBy(queued.receipt.id), queued, bought);
    expect(boughtStory).toMatchObject({
      tone: 'waited-bought',
      equityLine: '65.00 USDG waited, then bought SPY on 21 Sep 2026',
      note: 'It waited because the market was closed.',
      bought: true,
    });
    lintClean(boughtStory);

    const clip = receipt(SAMPLE_RECEIPT_IDS.queuedClip);
    const released: WaitEnd = { kind: 'released', record: receipt(SAMPLE_RECEIPT_IDS.released) };
    expect(paymentStory(paymentSortedBy(clip.receipt.id), clip, released)).toMatchObject({
      tone: 'waited-released',
      parts: { spend: 100_000_000n, equity: 0n, waiting: 0n },
      equityLine: '10.00 USDG waited, then moved to spend on 15 Sep 2026',
      bought: false,
    });
  });

  it('tells a refusal and a payment that went to cover a pull outside Sleeve', () => {
    const refused = paymentStory(paymentSortedBy(SAMPLE_RECEIPT_IDS.refusedTicker), receipt(SAMPLE_RECEIPT_IDS.refusedTicker));
    expect(refused).toMatchObject({
      tone: 'refused',
      spendLine: 'All 500.00 USDG stayed spendable',
      note: 'The pool this split named is not on the SPY allowlist, so the equity share went to spend.',
    });
    lintClean(refused);
    const covered = paymentStory(paymentSortedBy(SAMPLE_RECEIPT_IDS.reconciled), receipt(SAMPLE_RECEIPT_IDS.reconciled));
    expect(covered.tone).toBe('covered');
    lintClean(covered);
  });

  it('measures how soon a split followed its payment', () => {
    const item = paymentSortedBy(SAMPLE_RECEIPT_IDS.queuedSession);
    expect(secondsToSort(item, receipt(SAMPLE_RECEIPT_IDS.queuedSession))).toBe(29n);
    expect(secondsToSort(item, null)).toBeNull();
  });
});
