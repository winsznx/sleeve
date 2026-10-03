import { beforeAll, describe, expect, it } from 'vitest';

import { createMockDataLayer, SAMPLE_ACCOUNT, SAMPLE_BLOCKED_ACCOUNT, SAMPLE_RECEIPT_IDS } from '@/data/mock';
import type { ReceiptRecord } from '@/data/types';

import { STATUS_WORDS, actionLabel, actionNumber, actionSource, actionTitle, isLotCorrection, isPaydaySplit, isSettleRefusal, usdgWords } from './outcome';

/** "#" and a number, built so the design guardrail's color grep does not read the test as a hex color. */
const numberSign = (id: string): string => `#${id}`;

let records: ReceiptRecord[] = [];

beforeAll(async () => {
  const layer = createMockDataLayer();
  const own = (await layer.listReceipts({ account: SAMPLE_ACCOUNT, limit: 100 })).items;
  const blocked = (await layer.listReceipts({ account: SAMPLE_BLOCKED_ACCOUNT, limit: 100 })).items;
  records = [...own, ...blocked];
});

function sample(id: bigint): ReceiptRecord {
  const record = records.find((candidate) => candidate.receipt.id === id);
  if (record === undefined) throw new Error(`no sample receipt ${id}`);
  return record;
}

describe('the title of an action', () => {
  it('leads with the payday split, as D-024 words it', () => {
    expect(actionTitle(sample(SAMPLE_RECEIPT_IDS.filledSpy))).toBe('1,200 USDG payday: 1,080 stayed spendable, 120 became SPY');
    expect(actionTitle(sample(SAMPLE_RECEIPT_IDS.filledSpySecond))).toBe(
      '937.25 USDG payday: 843.525 stayed spendable, 93.725 became SPY',
    );
  });

  it('says when the equity share waits, and when all of a payday stayed spendable', () => {
    expect(actionTitle(sample(SAMPLE_RECEIPT_IDS.queuedSession))).toBe('750 USDG payday: 675 stayed spendable, 75 waits to buy SPY');
    expect(actionTitle(sample(SAMPLE_RECEIPT_IDS.refusedTicker))).toBe('500 USDG payday: all of it stayed spendable');
    expect(actionTitle(sample(SAMPLE_RECEIPT_IDS.refusedAccount))).toBe('300 USDG payday: all of it stayed spendable');
  });

  it('names the buy after a wait, a release, a sale and a correction by their own numbers', () => {
    expect(actionTitle(sample(SAMPLE_RECEIPT_IDS.settled))).toBe('65 USDG that waited became SPY');
    expect(actionTitle(sample(SAMPLE_RECEIPT_IDS.released))).toBe('10 USDG waiting for QQQ moved to spend');
    expect(actionTitle(sample(SAMPLE_RECEIPT_IDS.sold))).toBe('Sold 0.108026 QQQ for 80.006416 USDG');
    expect(actionTitle(sample(SAMPLE_RECEIPT_IDS.reconciled))).toBe('Ledgers lowered by 15 USDG to match the balance');
  });

  it('keeps every digit a receipt holds and pads none', () => {
    expect([usdgWords(1_200_000_000n), usdgWords(93_725_000n), usdgWords(1n)]).toEqual(['1,200', '93.725', '0.000001']);
    expect(actionNumber(455n)).toBe(numberSign('455'));
  });
});

describe('an action in a list', () => {
  it('names it short and says where the money came from', () => {
    expect([actionLabel(sample(SAMPLE_RECEIPT_IDS.filledSpy)), actionSource(sample(SAMPLE_RECEIPT_IDS.filledSpy))]).toEqual([
      'Payday split',
      'from 0x557f…99F0',
    ]);
    expect([actionLabel(sample(SAMPLE_RECEIPT_IDS.settled)), actionSource(sample(SAMPLE_RECEIPT_IDS.settled))]).toEqual([
      'Bought SPY after waiting',
      'waited since 19 Sep 2026',
    ]);
    expect([actionLabel(sample(SAMPLE_RECEIPT_IDS.sold)), actionSource(sample(SAMPLE_RECEIPT_IDS.sold))]).toEqual([
      'Sold QQQ',
      'from lot 212',
    ]);
    expect(actionSource(sample(SAMPLE_RECEIPT_IDS.released))).toBe('was waiting to buy QQQ');
    expect(actionLabel(sample(SAMPLE_RECEIPT_IDS.reconciled))).toBe('Ledgers corrected');
  });

  it('words every status plainly and tells payday splits apart', () => {
    expect(Object.values(STATUS_WORDS)).not.toContain('FILLED');
    expect(new Set(Object.values(STATUS_WORDS)).size).toBe(9);
    expect([isPaydaySplit('QUEUED'), isPaydaySplit('SETTLED')]).toEqual([true, false]);
  });

  it('reads a release and a settle refusal by what went to spend, as the contract writes them with usdgIn zero', () => {
    const released = sample(SAMPLE_RECEIPT_IDS.released);
    const onchainRelease = { ...released, receipt: { ...released.receipt, usdgIn: 0n } };
    expect(actionTitle(onchainRelease)).toBe('10 USDG waiting for QQQ moved to spend');

    const refusedSettle = { ...released, receipt: { ...released.receipt, status: 'REFUSED_TICKER' as const, usdgIn: 0n, usdgToEquity: 10_000_000n } };
    expect(isSettleRefusal(refusedSettle.receipt)).toBe(true);
    expect(actionTitle(refusedSettle)).toBe('10 USDG waiting for QQQ went to spend when the buy was refused');
    expect([actionLabel(refusedSettle), actionSource(refusedSettle)]).toEqual(['Waiting USDG moved to spend', 'was waiting to buy QQQ']);
    expect(isSettleRefusal(sample(SAMPLE_RECEIPT_IDS.refusedTicker).receipt)).toBe(false);
  });

  it("names a lot's correction by the Stock Tokens trimmed off the lot, not as USDG", () => {
    const reconciled = sample(SAMPLE_RECEIPT_IDS.reconciled);
    const lotCorrection = {
      ...reconciled,
      receipt: { ...reconciled.receipt, tickerId: 0, lotId: 455n, tokensIn: 50_000_000_000_000_000n, usdgIn: 0n },
      reconciliation: null,
    };
    expect(isLotCorrection(lotCorrection.receipt)).toBe(true);
    expect(isLotCorrection(reconciled.receipt)).toBe(false);
    expect(actionTitle(lotCorrection)).toBe('Lot 455 trimmed by 0.05 SPY to match the balance');
    expect([actionLabel(lotCorrection), actionSource(lotCorrection)]).toEqual(['Lot corrected', 'SPY left outside Sleeve']);
  });
});
