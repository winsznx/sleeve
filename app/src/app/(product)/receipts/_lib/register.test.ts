import { beforeAll, describe, expect, it } from 'vitest';

import { createMockDataLayer, SAMPLE_ACCOUNT, SAMPLE_RECEIPT_IDS } from '@/data/mock';
import type { ReceiptRecord } from '@/data/types';

import { actionCount } from './outcome';
import { feeTierPercent, feeTierWords, poolFacts, venueName } from './pool';
import { formatUtcClock, formatUtcDay, groupByUtcDay, rowAmount, rowLead, rowOutcome, utcDayKey } from './register';

const at = (iso: string): bigint => BigInt(Date.parse(iso) / 1_000);

let records: ReceiptRecord[] = [];

beforeAll(async () => {
  records = (await createMockDataLayer().listReceipts({ account: SAMPLE_ACCOUNT, limit: 100 })).items;
});

function sample(id: bigint): ReceiptRecord {
  const record = records.find((candidate) => candidate.receipt.id === id);
  if (record === undefined) throw new Error(`no sample receipt ${id}`);
  return record;
}

describe('days in UTC', () => {
  it('names a day and a time the way the chain time reads', () => {
    expect(formatUtcDay(at('2026-09-26T13:30:10Z'))).toBe('Sat 26 Sep 2026');
    expect(formatUtcClock(at('2026-09-26T03:05:59Z'))).toBe('03:05 UTC');
    expect(utcDayKey(at('2026-01-05T23:59:59Z'))).toBe('2026-01-05');
  });

  it('groups consecutive actions by day, keeping the order it was given', () => {
    const groups = groupByUtcDay(records);
    expect(groups.map((group) => [group.label, group.records.length])).toEqual([
      ['Sat 26 Sep 2026', 1],
      ['Fri 25 Sep 2026', 1],
      ['Thu 24 Sep 2026', 1],
      ['Wed 23 Sep 2026', 1],
      ['Tue 22 Sep 2026', 1],
      ['Mon 21 Sep 2026', 3],
      ['Sat 19 Sep 2026', 1],
      ['Thu 17 Sep 2026', 1],
      ['Tue 15 Sep 2026', 2],
      ['Mon 14 Sep 2026', 1],
    ]);
    expect(groups.flatMap((group) => group.records)).toEqual(records);
    expect([actionCount(1), actionCount(3)]).toEqual(['1 action', '3 actions']);
  });
});

describe('what a row pictures and says', () => {
  it('leads a buy with USDG into the Stock Token, a sale the other way, and ledger moves with USDG alone', () => {
    expect(rowLead(sample(SAMPLE_RECEIPT_IDS.filledSpy).receipt)).toEqual({ kind: 'pair', from: 'USDG', to: 'SPY', mark: null });
    expect(rowLead(sample(SAMPLE_RECEIPT_IDS.queuedSession).receipt)).toEqual({ kind: 'pair', from: 'USDG', to: 'SPY', mark: 'waiting' });
    expect(rowLead(sample(SAMPLE_RECEIPT_IDS.refusedTicker).receipt)).toMatchObject({ mark: 'refused' });
    expect(rowLead(sample(SAMPLE_RECEIPT_IDS.sold).receipt)).toEqual({ kind: 'pair', from: 'QQQ', to: 'USDG', mark: null });
    expect(rowLead(sample(SAMPLE_RECEIPT_IDS.released).receipt)).toEqual({ kind: 'single', token: 'USDG' });
    expect(rowLead(sample(SAMPLE_RECEIPT_IDS.reconciled).receipt)).toEqual({ kind: 'single', token: 'USDG' });
  });

  it('says what the amount became, waits for or came from', () => {
    expect(rowOutcome(sample(SAMPLE_RECEIPT_IDS.filledSpy))).toEqual({ text: 'became 0.155872 SPY', token: 'SPY', tone: 'equity' });
    expect(rowOutcome(sample(SAMPLE_RECEIPT_IDS.queuedSession))).toMatchObject({ text: '75.00 USDG waits to buy SPY', tone: 'waiting' });
    expect(rowOutcome(sample(SAMPLE_RECEIPT_IDS.sold))).toEqual({ text: 'for 0.108026 QQQ', token: 'QQQ', tone: 'plain' });
    expect(rowOutcome(sample(SAMPLE_RECEIPT_IDS.released)).text).toBe('moved to spend');
    expect(rowOutcome(sample(SAMPLE_RECEIPT_IDS.refusedTicker)).text).toBe('all of it stayed spendable');
  });

  it('leads a release and a settle refusal with what went to spend, as the contract writes them with usdgIn zero', () => {
    const released = sample(SAMPLE_RECEIPT_IDS.released);
    const onchain = { ...released, receipt: { ...released.receipt, usdgIn: 0n } };
    expect(rowAmount(onchain)).toEqual({ value: '10.00', unit: 'USDG' });
    const refusedSettle = { ...onchain, receipt: { ...onchain.receipt, status: 'REFUSED_ACCOUNT' as const } };
    expect(rowAmount(refusedSettle)).toEqual({ value: '10.00', unit: 'USDG' });
    expect(rowOutcome(refusedSettle).text).toBe('moved to spend');
    expect(rowAmount(sample(SAMPLE_RECEIPT_IDS.filledSpy))).toEqual({ value: '1,200.00', unit: 'USDG' });
  });

  it("leads a lot's correction with the Stock Tokens trimmed off it, pictured by the ticker", () => {
    const reconciled = sample(SAMPLE_RECEIPT_IDS.reconciled);
    const lotCorrection = {
      ...reconciled,
      receipt: { ...reconciled.receipt, tickerId: 0, lotId: 455n, tokensIn: 50_000_000_000_000_000n, usdgIn: 0n, usdgSpent: 0n },
      reconciliation: null,
    };
    expect(rowAmount(lotCorrection)).toEqual({ value: '0.05', unit: 'SPY' });
    expect(rowOutcome(lotCorrection).text).toBe('taken off lot 455');
    expect(rowLead(lotCorrection.receipt)).toEqual({ kind: 'single', token: 'SPY' });
    expect(rowLead(reconciled.receipt)).toEqual({ kind: 'single', token: 'USDG' });
  });
});

describe('pools', () => {
  it('reads the fee tier and standing from the allowlist', () => {
    expect(poolFacts(3, '0x783C9bbB765047CFdD2b84b92b2Ca9F11D34b7Ed')).toMatchObject({ allowlisted: true, fee: 3000 });
    expect(poolFacts(0, '0xA43b424Bc609495AED4BCD88d654934b510B0aD9')).toMatchObject({ allowlisted: false, fee: null });
    expect([feeTierPercent(500), feeTierPercent(3000), feeTierPercent(100)]).toEqual(['0.05%', '0.30%', '0.01%']);
    expect(feeTierWords(500)).toBe('0.05 percent');
    expect([venueName(0), venueName(1)]).toEqual([null, 'Uniswap v3']);
  });
});
