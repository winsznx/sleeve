import { describe, expect, it } from 'vitest';

import { createMockDataLayer, SAMPLE_ACCOUNT, SAMPLE_RECEIPT_IDS } from '@/data/mock';

import { latestPaymentSplit } from './latest-payment';

describe('latestPaymentSplit', () => {
  it('finds the newest receipt that split a payment', async () => {
    // #given the sample owner's receipts, newest first
    const page = await createMockDataLayer().listReceipts({ account: SAMPLE_ACCOUNT });
    // #when home looks for the payment to lead with
    const latest = latestPaymentSplit(page.items);
    // #then it is the weekend payment that queued for the market
    expect(latest?.receipt.id).toBe(SAMPLE_RECEIPT_IDS.queuedSession);
  });

  it('passes over a newer release, which splits no payment', async () => {
    // #given the owner just released the waiting SPY bucket
    const layer = createMockDataLayer();
    await layer.release(0);
    const page = await layer.listReceipts({ account: SAMPLE_ACCOUNT });
    // #when home looks for the payment to lead with
    const latest = latestPaymentSplit(page.items);
    // #then the newest receipt is the release, and the lead stays the weekend payment
    expect([page.items[0]?.receipt.status, latest?.receipt.id]).toEqual(['RELEASED', SAMPLE_RECEIPT_IDS.queuedSession]);
  });

  it('passes over a reconcile, which sorts no payment of its own', async () => {
    // #given receipts up to the reconcile on Wednesday, newest first
    const page = await createMockDataLayer().listReceipts({ account: SAMPLE_ACCOUNT });
    const older = page.items.filter((record) => record.receipt.id <= SAMPLE_RECEIPT_IDS.reconciled);
    // #when home looks for the payment to lead with
    const latest = latestPaymentSplit(older);
    // #then it skips RECONCILED and lands on the SPY fill
    expect([older[0]?.receipt.status, latest?.receipt.id]).toEqual(['RECONCILED', SAMPLE_RECEIPT_IDS.filledSpy]);
  });

  it('passes over sells and a settle, which move tokens or waiting USDG but split no payment', async () => {
    // #given receipts before the SPY fill: PART_SOLD, SOLD and SETTLED come first
    const page = await createMockDataLayer().listReceipts({ account: SAMPLE_ACCOUNT });
    const older = page.items.filter((record) => record.receipt.id < SAMPLE_RECEIPT_IDS.filledSpy);
    // #when home looks for the payment to lead with
    const latest = latestPaymentSplit(older);
    // #then it lands on the Saturday payment that queued
    expect([older.slice(0, 3).map((record) => record.receipt.status), latest?.receipt.id]).toEqual([
      ['PART_SOLD', 'SOLD', 'SETTLED'],
      SAMPLE_RECEIPT_IDS.queuedSessionSettled,
    ]);
  });

  it('finds nothing before the first split', () => {
    // #given no receipts #when looked up #then nothing leads
    expect(latestPaymentSplit([])).toBeUndefined();
  });
});
