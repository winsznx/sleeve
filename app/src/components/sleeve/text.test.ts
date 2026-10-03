import { REASONS, TRIGGERS } from '@sleeve/core';
import { beforeAll, describe, expect, it } from 'vitest';

import { createMockDataLayer, SAMPLE_RECEIPT_IDS } from '@/data/mock';
import type { ReceiptRecord } from '@/data/types';

import { lintText } from '../../../../scripts/copy-lint.mjs';
import {
  INBOX_STATE_LABEL,
  inboxStateSentence,
  percentWords,
  reasonSentence,
  receiptHeadline,
  receiptSentence,
  receiptTitle,
  triggerLabel,
  usdgExact,
  usdgText,
} from './text';

let records: ReceiptRecord[] = [];

beforeAll(async () => {
  const layer = createMockDataLayer();
  const found = await Promise.all(Object.values(SAMPLE_RECEIPT_IDS).map((id) => layer.getReceipt(id)));
  records = found.filter((record): record is ReceiptRecord => record !== null);
});

function record(id: bigint): ReceiptRecord {
  const found = records.find((candidate) => candidate.receipt.id === id);
  if (found === undefined) throw new Error(`no sample receipt ${id}`);
  return found;
}

describe('amount words', () => {
  it('keeps every digit a receipt holds, and two places on cards', () => {
    expect(usdgExact(93_725_000n)).toBe('93.725');
    expect(usdgExact(75_000_000n)).toBe('75.00');
    expect(usdgExact(1n)).toBe('0.000001');
    expect(usdgText(93_725_000n)).toBe('93.72 USDG');
    expect(usdgText(1_200_000_000n)).toBe('1,200.00 USDG');
  });

  it('says basis points as a percent with two places and no sign', () => {
    expect(percentWords(4n)).toBe('0.04 percent');
    expect(percentWords(-9n)).toBe('0.09 percent');
    expect(percentWords(150)).toBe('1.50 percent');
  });
});

describe('receipt sentences', () => {
  it('covers every sample receipt, and every sentence and title passes the copy lint', () => {
    expect(records).toHaveLength(Object.keys(SAMPLE_RECEIPT_IDS).length);
    for (const item of records) {
      const sentence = receiptSentence(item);
      const title = receiptTitle(item);
      expect(sentence.length).toBeGreaterThan(0);
      expect(lintText(sentence), sentence).toEqual([]);
      expect(lintText(title), title).toEqual([]);
    }
  });

  it('builds a fill from its own numbers, exactly, so the parts add up to the payment', () => {
    expect(receiptSentence(record(SAMPLE_RECEIPT_IDS.filledSpySecond))).toBe(
      '937.25 USDG arrived. 843.525 USDG stayed spendable and 93.725 USDG became 0.121335 SPY.',
    );
  });

  it('says why a queued share waited', () => {
    expect(receiptSentence(record(SAMPLE_RECEIPT_IDS.queuedSession))).toBe(
      '750.00 USDG arrived. 675.00 USDG stayed spendable and 75.00 USDG stayed as USDG to buy SPY later, because the market was closed.',
    );
    expect(receiptSentence(record(SAMPLE_RECEIPT_IDS.queuedClip))).toContain('because it was below your minimum buy');
  });

  it('names the pool problem on a refused ticker and the blocklist on a refused account', () => {
    expect(receiptSentence(record(SAMPLE_RECEIPT_IDS.refusedTicker))).toBe(
      '500.00 USDG arrived and all of it stayed spendable. The pool this split named is not on the SPY allowlist, so the 50.00 USDG equity share went to spend.',
    );
    expect(receiptSentence(record(SAMPLE_RECEIPT_IDS.refusedAccount))).toContain("The issuer's blocklist includes this account");
  });

  it('describes settles, releases, sells and reconciles', () => {
    expect(receiptSentence(record(SAMPLE_RECEIPT_IDS.settled))).toBe(
      '65.00 USDG that waited since 19 Sep 2026 became 0.08446 SPY.',
    );
    expect(receiptSentence(record(SAMPLE_RECEIPT_IDS.released))).toBe('10.00 USDG that waited to buy QQQ moved to spend.');
    expect(receiptSentence(record(SAMPLE_RECEIPT_IDS.partSold))).toContain('The rest of the lot is still held.');
    expect(receiptSentence(record(SAMPLE_RECEIPT_IDS.sold))).toBe(
      'Sold 0.108026 QQQ from lot 212 for 80.006416 USDG, which went to spend. Nothing is left in the lot.',
    );
    expect(receiptSentence(record(SAMPLE_RECEIPT_IDS.reconciled))).toBe(
      'USDG left the account outside Sleeve, for example through an old approval. To match the balance, Sleeve lowered spend by 15.00 USDG.',
    );
  });

  it('leads a list row with the amount that moved', () => {
    expect(receiptHeadline(record(SAMPLE_RECEIPT_IDS.filledSpy))).toBe(1_200_000_000n);
    expect(receiptHeadline(record(SAMPLE_RECEIPT_IDS.settled))).toBe(65_000_000n);
    expect(receiptHeadline(record(SAMPLE_RECEIPT_IDS.sold))).toBe(80_006_416n);
    expect(receiptHeadline(record(SAMPLE_RECEIPT_IDS.reconciled))).toBe(15_000_000n);
  });
});

describe('reason sentences', () => {
  it('explains every reason in plain words that pass the copy lint', () => {
    for (const reason of REASONS) {
      const sentence = reasonSentence(reason, {
        symbol: 'SPY',
        reopensAt: 1_790_553_600n,
        minClip: 25_000_000n,
        premiumCapBps: 100,
      });
      if (reason === 'NONE') {
        expect(sentence).toBe('');
        continue;
      }
      expect(sentence.length, reason).toBeGreaterThan(0);
      expect(lintText(sentence), sentence).toEqual([]);
    }
  });

  it('puts the numbers the owner needs in the sentence', () => {
    expect(reasonSentence('SESSION', { symbol: 'SPY', reopensAt: 1_790_553_600n })).toBe(
      'The market is closed. Sleeve buys SPY after it reopens, Sun 27 Sep, 20:00 New York time.',
    );
    expect(reasonSentence('SESSION', { symbol: 'SPY', reopensAt: null })).toBe(
      'The market is closed. Sleeve buys SPY after it reopens.',
    );
    expect(reasonSentence('CLIP', { symbol: 'QQQ', minClip: 25_000_000n })).toContain('25.00 USDG');
    expect(reasonSentence('PREMIUM', { symbol: 'QQQ', premiumCapBps: 100 })).toContain('1.00 percent');
  });
});

describe('labels', () => {
  it('names every trigger, and the pay link only as not available yet', () => {
    for (const trigger of TRIGGERS) expect(lintText(triggerLabel(trigger)), trigger).toEqual([]);
    expect(triggerLabel('PAYLINK')).toContain('not available yet');
  });

  it('explains every inbound state', () => {
    expect(Object.values(INBOX_STATE_LABEL).every((label) => lintText(label).length === 0)).toBe(true);
    expect(inboxStateSentence('WAITING_GRACE', 1_790_446_950n)).toBe(
      "Not sorted yet. If Sleeve's keeper has not sorted it by 26 Sep 2026, 18:22 UTC, anyone can start the split.",
    );
    expect(inboxStateSentence('RECEIVED', null)).toContain('stays spendable');
  });
});
