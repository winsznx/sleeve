import { beforeAll, describe, expect, it } from 'vitest';

import { createMockDataLayer, SAMPLE_ACCOUNT, SAMPLE_RECEIPT_IDS } from '@/data/mock';
import type { InboxItem, ReceiptRecord } from '@/data/types';

import { filterPayments, groupPaymentsByDay, paymentCounts, paymentsSummary, receiptsById, waitEndOf } from './payments';

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

describe('payments', () => {
  it('filters and counts by whether a payment is sorted', () => {
    expect(paymentCounts(inbox)).toEqual({ all: 11, sorted: 9, unsorted: 2 });
    expect(filterPayments(inbox, 'unsorted').map((item) => item.state)).toEqual(['RECEIVED', 'WAITING_GRACE']);
    expect(filterPayments(inbox, 'sorted')).toHaveLength(9);
    expect(filterPayments(inbox, 'all')).toHaveLength(11);
  });

  it('groups consecutive payments by UTC day, newest first', () => {
    const days = groupPaymentsByDay(inbox);
    expect(days.map((day) => [day.label, day.items.length])).toEqual([
      ['Sat 26 Sep 2026', 3],
      ['Fri 25 Sep 2026', 1],
      ['Thu 24 Sep 2026', 1],
      ['Wed 23 Sep 2026', 1],
      ['Tue 22 Sep 2026', 1],
      ['Sat 19 Sep 2026', 1],
      ['Thu 17 Sep 2026', 1],
      ['Tue 15 Sep 2026', 1],
      ['Mon 14 Sep 2026', 1],
    ]);
  });

  it('sums what arrived and how many sorted with no action from the owner', () => {
    expect(paymentsSummary(inbox, receiptsById(receipts))).toEqual({
      received: 5_540_550_000n,
      count: 11,
      unsorted: 165_800_000n,
      unsortedCount: 2,
      sortedHandsFree: 9,
      sortedKnown: 9,
    });
  });

  it('does not count a split it has not read as hands free or not', () => {
    expect(paymentsSummary(inbox, new Map()).sortedKnown).toBe(0);
  });

  it('ties a waiting share to the buy or release that ended the wait, and to nothing while it still waits', () => {
    const exhausted = true;
    const settled = waitEndOf(receipt(SAMPLE_RECEIPT_IDS.queuedSessionSettled), receipts, exhausted);
    expect([settled?.kind, settled?.record.receipt.id]).toEqual(['bought', SAMPLE_RECEIPT_IDS.settled]);
    const released = waitEndOf(receipt(SAMPLE_RECEIPT_IDS.queuedClip), receipts, exhausted);
    expect([released?.kind, released?.record.receipt.id]).toEqual(['released', SAMPLE_RECEIPT_IDS.released]);
    expect(waitEndOf(receipt(SAMPLE_RECEIPT_IDS.queuedSession), receipts, exhausted)).toBeNull();
  });
});
