import type { Rule } from '@sleeve/core';
import { beforeAll, describe, expect, it } from 'vitest';

import { createMockDataLayer, SAMPLE_ACCOUNT, SAMPLE_RECEIPT_IDS } from '@/data/mock';
import type { InboxItem, ReceiptRecord } from '@/data/types';

import { lintText } from '../../../../../../scripts/copy-lint.mjs';
import { latestPayday, sortedLine, unsortedPayments } from './payday';
import { homeHeadline } from './sentences';

let receipts: ReceiptRecord[] = [];
let inbox: InboxItem[] = [];

beforeAll(async () => {
  const layer = createMockDataLayer();
  [receipts, inbox] = await Promise.all([
    layer.listReceipts({ account: SAMPLE_ACCOUNT, limit: 20 }).then((page) => page.items),
    layer.getInbox(SAMPLE_ACCOUNT),
  ]);
});

const ACTIVE: Rule = { version: 2, status: 'ACTIVE', equityBps: 1_000, tickerId: 0, premiumCapBps: 100, slippageBps: 50, minClip: 25_000_000n };

describe('latestPayday', () => {
  it('finds the newest split payment, its sender and when it arrived', () => {
    const payday = latestPayday(receipts, inbox);
    expect(payday?.record.receipt.id).toBe(SAMPLE_RECEIPT_IDS.queuedSession);
    expect(payday?.from).toBe('0x719DBeC8Ea02dA7A16B32dd98a5e0682da5B265F');
    expect(payday?.payments).toBe(1);
    expect(payday?.arrivedAt).toBe(BigInt(Date.parse('2026-09-26T13:29:41Z') / 1_000));
  });

  it('is null before anything has split', () => {
    expect(latestPayday([], inbox)).toBeNull();
  });

  it('names no single sender when one split sorted payments from several', () => {
    const [newest] = receipts;
    if (newest === undefined) throw new Error('no receipts');
    const record: ReceiptRecord = {
      ...newest,
      derived: {
        ...newest.derived,
        inbound: [
          { txHash: '0x01', logIndex: 0, from: '0x0000000000000000000000000000000000000001', amount: 1n },
          { txHash: '0x02', logIndex: 0, from: '0x0000000000000000000000000000000000000002', amount: 1n },
        ],
      },
    };
    expect(latestPayday([record], [])?.from).toBeNull();
    expect(latestPayday([record], [])?.payments).toBe(2);
  });
});

describe('unsortedPayments', () => {
  it('counts the payments not sorted yet and what they add up to', () => {
    expect(unsortedPayments(inbox)).toEqual({ count: 2, amount: 165_800_000n });
  });
});

describe('sortedLine', () => {
  it('says who split it, how soon after it arrived, and under which rule version', () => {
    const payday = latestPayday(receipts, inbox);
    if (payday === null) throw new Error('no payday');
    expect(sortedLine(payday)).toBe("Split by Sleeve's keeper under a minute after it arrived, under rule version 2.");
    const byStranger = { ...payday, record: { ...payday.record, receipt: { ...payday.record.receipt, trigger: 'PUBLIC' as const } } };
    expect(sortedLine(byStranger)).toBe(
      'Split by someone else under a minute after it arrived, under rule version 2. Anyone may start a split once a payment has waited out the one hour grace period.',
    );
  });
});

describe('homeHeadline', () => {
  it('puts the payday split in one sentence, with the off-hours wait under it', () => {
    expect(homeHeadline(ACTIVE)).toEqual({
      title: 'When you get paid, 10% buys SPY. The rest stays spendable.',
      lede: 'SPY Stock Tokens go into your own account. When the market is closed, the 10% waits as USDG and buys at the open.',
    });
    expect(homeHeadline({ ...ACTIVE, equityBps: 2_550, tickerId: 1 }).title).toBe('When you get paid, 25.5% buys QQQ. The rest stays spendable.');
  });

  it('reads plainly at either end, paused and before a rule exists', () => {
    expect(homeHeadline({ ...ACTIVE, equityBps: 0 }).title).toBe('When you get paid, all of it stays spendable.');
    expect(homeHeadline({ ...ACTIVE, equityBps: 10_000 }).title).toBe('When you get paid, all of it buys SPY.');
    expect(homeHeadline({ ...ACTIVE, status: 'PAUSED' }).title).toBe('Your rule is paused.');
    expect(homeHeadline({ ...ACTIVE, status: 'NONE' }).title).toBe('Set your rule to split every payment.');
  });

  it('passes the copy lint in every state', () => {
    const states: Rule[] = [ACTIVE, { ...ACTIVE, equityBps: 0 }, { ...ACTIVE, equityBps: 10_000 }, { ...ACTIVE, status: 'PAUSED' }, { ...ACTIVE, status: 'NONE' }];
    for (const rule of states) {
      const { title, lede } = homeHeadline(rule);
      expect(lintText(title)).toEqual([]);
      expect(lintText(lede)).toEqual([]);
    }
  });
});
