import { describe, expect, it } from 'vitest';

import { createMockDataLayer, SAMPLE_ACCOUNT, SAMPLE_RECEIPT_IDS } from '@/data/mock';
import type { ReceiptRecord, SleeveDataLayer } from '@/data/types';

import { waitedPaydays, waitOutcome, type ReceiptWindow } from './wait-links';

const SPY = 0;
const QQQ = 1;

async function windowFor(layer: SleeveDataLayer, tickerId: number, limit = 100): Promise<ReceiptWindow> {
  const page = await layer.listReceipts({ account: SAMPLE_ACCOUNT, tickerId, limit });
  return { records: page.items, exhausted: page.nextCursor === null };
}

async function receiptOf(layer: SleeveDataLayer, id: bigint): Promise<ReceiptRecord> {
  const record = await layer.getReceipt(id);
  if (record === null) throw new Error(`the sample history has receipt ${id}`);
  return record;
}

describe('waitOutcome', () => {
  it('finds the buy that ended a weekend wait', async () => {
    const layer = createMockDataLayer();
    const queued = await receiptOf(layer, SAMPLE_RECEIPT_IDS.queuedSessionSettled);
    const outcome = waitOutcome(queued.receipt, await windowFor(layer, SPY), await layer.getBuckets(SAMPLE_ACCOUNT));
    expect(outcome?.kind).toBe('closed');
    expect(outcome?.kind === 'closed' ? outcome.record.receipt.id : null).toBe(SAMPLE_RECEIPT_IDS.settled);
  });

  it('finds the release that moved a small wait to spend', async () => {
    const layer = createMockDataLayer();
    const queued = await receiptOf(layer, SAMPLE_RECEIPT_IDS.queuedClip);
    const outcome = waitOutcome(queued.receipt, await windowFor(layer, QQQ), await layer.getBuckets(SAMPLE_ACCOUNT));
    expect(outcome?.kind === 'closed' ? outcome.record.receipt.status : null).toBe('RELEASED');
    expect(outcome?.kind === 'closed' ? outcome.record.receipt.id : null).toBe(SAMPLE_RECEIPT_IDS.released);
  });

  it('says a wait that nothing has ended yet is still waiting, with the bucket it sits in', async () => {
    const layer = createMockDataLayer();
    const queued = await receiptOf(layer, SAMPLE_RECEIPT_IDS.queuedSession);
    const outcome = waitOutcome(queued.receipt, await windowFor(layer, SPY), await layer.getBuckets(SAMPLE_ACCOUNT));
    expect(outcome).toMatchObject({ kind: 'waiting', bucket: { tickerId: SPY, amount: 75_000_000n, reason: 'SESSION' } });
  });

  it('says nothing while the receipts read so far do not reach back to the wait', async () => {
    const layer = createMockDataLayer();
    const queued = await receiptOf(layer, SAMPLE_RECEIPT_IDS.queuedClip);
    const newest = await windowFor(layer, QQQ, 1);
    expect(newest.exhausted).toBe(false);
    const older = { records: newest.records.filter(({ receipt }) => receipt.id > SAMPLE_RECEIPT_IDS.released), exhausted: false };
    expect(waitOutcome(queued.receipt, older, [])).toBeNull();
    expect(waitOutcome(queued.receipt, null, [])).toBeNull();
  });

  it('never claims a wait is still on before the buckets are read, nor for a receipt that did not wait', async () => {
    const layer = createMockDataLayer();
    const queued = await receiptOf(layer, SAMPLE_RECEIPT_IDS.queuedSession);
    expect(waitOutcome(queued.receipt, await windowFor(layer, SPY), undefined)).toBeNull();
    const filled = await receiptOf(layer, SAMPLE_RECEIPT_IDS.filledSpy);
    expect(waitOutcome(filled.receipt, await windowFor(layer, SPY), [])).toBeNull();
  });
});

describe('waitedPaydays', () => {
  it('names the payday whose equity share waited for a buy after a wait, and for a release', async () => {
    const layer = createMockDataLayer();
    const settled = await receiptOf(layer, SAMPLE_RECEIPT_IDS.settled);
    expect(waitedPaydays(settled.receipt, await windowFor(layer, SPY))?.map(({ receipt }) => receipt.id)).toEqual([
      SAMPLE_RECEIPT_IDS.queuedSessionSettled,
    ]);
    const released = await receiptOf(layer, SAMPLE_RECEIPT_IDS.released);
    expect(waitedPaydays(released.receipt, await windowFor(layer, QQQ))?.map(({ receipt }) => receipt.id)).toEqual([
      SAMPLE_RECEIPT_IDS.queuedClip,
    ]);
  });

  it('says nothing for a receipt that emptied no bucket, or a window that stops short', async () => {
    const layer = createMockDataLayer();
    const filled = await receiptOf(layer, SAMPLE_RECEIPT_IDS.filledSpy);
    expect(waitedPaydays(filled.receipt, await windowFor(layer, SPY))).toBeNull();
    const settled = await receiptOf(layer, SAMPLE_RECEIPT_IDS.settled);
    expect(waitedPaydays(settled.receipt, { records: [settled], exhausted: false })).toBeNull();
    expect(waitedPaydays(settled.receipt, null)).toBeNull();
  });
});
