import type { Rule } from '@sleeve/core';
import { beforeAll, describe, expect, it } from 'vitest';

import { createMockDataLayer, SAMPLE_ACCOUNT } from '@/data/mock';
import type { InboxItem } from '@/data/types';

import { lintText } from '../../../../../../scripts/copy-lint.mjs';
import { unsortedPayments } from './payday';
import { homeHeadline } from './sentences';

let inbox: InboxItem[] = [];

beforeAll(async () => {
  inbox = await createMockDataLayer().getInbox(SAMPLE_ACCOUNT);
});

const ACTIVE: Rule = { version: 2, status: 'ACTIVE', equityBps: 1_000, tickerId: 0, premiumCapBps: 100, slippageBps: 50, minClip: 25_000_000n };

describe('unsortedPayments', () => {
  it('counts the payments not sorted yet and what they add up to', () => {
    expect(unsortedPayments(inbox)).toEqual({ count: 2, amount: 165_800_000n });
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
