import type { Rule } from '@sleeve/core';
import { describe, expect, it } from 'vitest';

import { NEXT_OPEN } from '@/data/mock';
import type { PreviewBlock, PreviewPrice, PreviewWarning } from '@/data/types';

import { lintText } from '../../../../scripts/copy-lint.mjs';
import { blockText, capText, differenceText, feeAmountText, placeLabel, ruleLines, warningText } from './preview-text';

const ADDRESS = '0x15373CA332Fbb73a8559De6E2BB32974dC68d613';
const REOPENS = NEXT_OPEN;

const WARNINGS: PreviewWarning[] = [
  { code: 'SENDS_UNSORTED', amount: 16_580_000n },
  { code: 'SENDS_WAITING', tickerId: 0, amount: 75_000_000n },
  { code: 'RELEASE_ENDS_WAIT', tickerId: 0 },
  { code: 'EQUITY_WILL_WAIT', tickerId: 0, reason: 'SESSION', reopensAt: REOPENS },
  { code: 'EQUITY_WILL_WAIT', tickerId: 1, reason: 'PREMIUM', reopensAt: null },
  { code: 'EQUITY_TO_SPEND', tickerId: 0, status: 'REFUSED_ACCOUNT' },
  { code: 'EQUITY_TO_SPEND', tickerId: 0, status: 'REFUSED_TICKER' },
  { code: 'RECONCILES_FIRST', shortfall: 25_000_000n },
  { code: 'SKIPS_MARKET_WAIT', reopensAt: REOPENS },
  { code: 'SKIPS_MARKET_WAIT', reopensAt: null },
  { code: 'WIDER_CAP', capBps: 200, ruleCapBps: 100 },
  { code: 'PAUSE_LEAVES_UNSORTED' },
  { code: 'RESUME_SPLITS_UNSORTED', amount: 165_800_000n },
];

const BLOCKS: PreviewBlock[] = [
  { code: 'InsufficientBalance', balance: 3_000_000n, needed: 5_000_000n },
  { code: 'InvalidDestination', reason: 'SELF' },
  { code: 'InvalidDestination', reason: 'ZERO' },
  { code: 'NothingWaiting' },
  { code: 'BelowClip', minClip: 25_000_000n },
  { code: 'GuardNotClear', reason: 'SESSION' },
  { code: 'SellWaits', reason: 'SESSION', reopensAt: REOPENS },
  { code: 'SellWaits', reason: 'STALE', reopensAt: null },
  { code: 'RuleNotPaused' },
  { code: 'ZeroAmount' },
];

describe('transaction preview words', () => {
  it('words every warning plainly, within the copy rules', () => {
    for (const warning of WARNINGS) {
      const text = warningText(warning);
      expect(text.length, warning.code).toBeGreaterThan(20);
      expect(lintText(text), text).toEqual([]);
    }
    expect(warningText({ code: 'EQUITY_WILL_WAIT', tickerId: 0, reason: 'SESSION', reopensAt: REOPENS })).toBe(
      'The market is closed, so the equity share waits as USDG and buys SPY after it reopens, Sun 27 Sep, 20:00 New York time.',
    );
  });

  it('says why a blocked action would not go through, within the copy rules', () => {
    for (const block of BLOCKS) {
      const text = blockText(block);
      expect(lintText(text), text).toEqual([]);
    }
    expect(blockText({ code: 'InsufficientBalance', balance: 3_000_000n, needed: 5_000_000n })).toBe('That is more than your account holds, 3.00 USDG.');
  });

  it('names every place money sits', () => {
    expect(placeLabel({ kind: 'waiting', tickerId: 1 })).toBe('Waiting to buy QQQ');
    expect(placeLabel({ kind: 'holding', tickerId: 0 })).toBe('SPY you hold');
    expect(placeLabel({ kind: 'outside', address: ADDRESS })).toBe('0x1537\u2026d613');
  });

  it('sets a price against the reference and the cap, on the side the action trades', () => {
    const buy: PreviewPrice = {
      side: 'BUY',
      tickerId: 0,
      execPrice: 774_230_000n,
      reference: { feed: ADDRESS, roundId: 1n, answer: 77_210_000_000n, updatedAt: 0n },
      differenceBps: 28n,
      capBps: 100,
      withinCap: true,
    };
    expect(differenceText(buy)).toBe('0.28 percent above the market reference');
    expect(capText(buy)).toBe('Within your cap of 1.00 percent above it.');
    expect(differenceText({ ...buy, side: 'SELL', differenceBps: 16n })).toBe('0.16 percent below the market reference');
    expect(capText({ ...buy, side: 'SELL', withinCap: false })).toBe('More than your cap of 1.00 percent below it.');
  });

  it('prints the network fee in ETH without rounding a small fee to zero', () => {
    expect(feeAmountText({ gas: 290_000n, gasPriceWei: 31_610_000n, wei: 9_166_900_000_000n, sponsored: true })).toBe('about 0.0000091 ETH');
  });

  it('lists a rule change row by row, marking only what changes', () => {
    const before: Rule = { version: 2, status: 'ACTIVE', equityBps: 1_000, tickerId: 0, premiumCapBps: 100, slippageBps: 50, minClip: 25_000_000n };
    const lines = ruleLines(before, { ...before, version: 3, equityBps: 2_000 });
    expect(lines.filter((line) => line.changed).map((line) => [line.label, line.before, line.after])).toEqual([
      ['Each payment', '90% spendable, 10% buys SPY', '80% spendable, 20% buys SPY'],
    ]);
  });
});
