import { exceedsPremium, RULE_DEFAULTS, STATUSES, type Receipt } from '@sleeve/core';
import { describe, expect, it } from 'vitest';

import { pendingTotal, unsortedOf } from './engine';
import { buildFixtureWorld, SAMPLE_ACCOUNT, SAMPLE_RECEIPT_IDS } from './fixtures';
import { verifyInWorld } from './verify';

const world = buildFixtureWorld();
const receipts = world.receipts.map((entry) => entry.receipt);
const owner = world.accounts.get(SAMPLE_ACCOUNT);
if (owner === undefined) throw new Error('the sample owner is missing');

/** Receipts that move USDG between the ledgers and the venue; sells and reconciles account differently. */
const CONSERVING: ReadonlySet<Receipt['status']> = new Set([
  'FILLED',
  'QUEUED',
  'SETTLED',
  'REFUSED_TICKER',
  'REFUSED_ACCOUNT',
  'RELEASED',
]);

describe('sample world', () => {
  it('writes every status SPEC 13 names', () => {
    // #given the replayed history
    // #when the statuses are collected
    const statuses = new Set(receipts.map((receipt) => receipt.status));
    // #then none is missing
    expect([...statuses].sort()).toEqual([...STATUSES].sort());
  });

  it('queues for more than one reason', () => {
    const reasons = receipts.filter((receipt) => receipt.status === 'QUEUED').map((receipt) => receipt.reason);
    expect(new Set(reasons)).toEqual(new Set(['CLIP', 'SESSION']));
  });

  it('keeps USDG in equal to spend plus spent plus queued on every split, settle and release (I2)', () => {
    const broken = receipts
      .filter((receipt) => CONSERVING.has(receipt.status))
      .filter((receipt) => receipt.usdgIn !== receipt.usdgToSpend + receipt.usdgSpent + receipt.usdgQueued);
    expect(broken).toEqual([]);
  });

  it('numbers receipts in time order, globally', () => {
    const pairs = receipts.slice(1).map((receipt, index) => ({ before: receipts[index], after: receipt }));
    const outOfOrder = pairs.filter(
      ({ before, after }) => before === undefined || after.id <= before.id || after.timestamp < before.timestamp,
    );
    expect(outOfOrder).toEqual([]);
  });

  it('never fills above the rule cap, and every fill meets its minimum out (I8)', () => {
    const fills = world.receipts.filter(({ receipt }) => receipt.status === 'FILLED' || receipt.status === 'SETTLED');
    const bad = fills.filter(({ receipt, derived }) => {
      const cap = derived.rule?.premiumCapBps ?? -1;
      return (
        receipt.premiumBps > BigInt(cap) ||
        exceedsPremium(receipt.usdgSpent, receipt.tokensOut, receipt.answer, cap) ||
        receipt.tokensOut < receipt.minOut
      );
    });
    expect(fills.length).toBeGreaterThan(0);
    expect(bad).toEqual([]);
  });

  it('leaves every account with balance equal to spend plus pending plus unsorted', () => {
    const unbalanced = [...world.accounts.values()].filter(
      (account) => account.usdgBalance !== account.spend + pendingTotal(account) + unsortedOf(account),
    );
    expect(unbalanced).toEqual([]);
  });

  it('keeps lots that add up to the token balances', () => {
    for (const [tickerId, balance] of owner.tokenBalances) {
      const inLots = [...world.lots.values()]
        .filter((lot) => lot.account === owner.address && lot.tickerId === tickerId)
        .reduce((total, lot) => total + lot.tokensRemaining, 0n);
      expect(inLots).toBe(balance);
    }
  });

  it('verifies every receipt against the recorded chain data', () => {
    const results = receipts.map((receipt) => verifyInWorld(world, receipt.id));
    expect(results.filter((result) => result.status !== 'MATCH')).toEqual([]);
  });
});

describe('the sample owner at the clock, Saturday 26 September 2026, 14:00 New York', () => {
  it('runs the product default: 10 percent to SPY, written as rule version 2', () => {
    expect(owner.rule).toEqual({
      version: 2,
      status: 'ACTIVE',
      equityBps: RULE_DEFAULTS.equityBps,
      tickerId: RULE_DEFAULTS.tickerId,
      premiumCapBps: RULE_DEFAULTS.premiumCapBps,
      slippageBps: RULE_DEFAULTS.slippageBps,
      minClip: RULE_DEFAULTS.minClip,
    });
  });

  it('holds the weekend payment as a SPY bucket waiting for the session', () => {
    expect(owner.buckets.get(0)).toEqual({
      amount: 75_000_000n,
      since: BigInt(Date.parse('2026-09-26T13:30:10Z') / 1_000),
      reason: 'SESSION',
    });
  });

  it('shows inbound transfers in every offchain state', () => {
    expect(new Set(owner.inbox.map((item) => item.state))).toEqual(new Set(['RECEIVED', 'WAITING_GRACE', 'SORTED']));
  });

  it('holds Stock Tokens in two tickers', () => {
    const held = [...owner.tokenBalances.entries()].filter(([, balance]) => balance > 0n).map(([tickerId]) => tickerId);
    expect(held.sort()).toEqual([0, 1]);
  });

  it('sold its oldest QQQ lot whole and the next one in part', () => {
    expect([world.lots.get(SAMPLE_RECEIPT_IDS.filledQqq)?.status, world.lots.get(SAMPLE_RECEIPT_IDS.filledQqqSecond)?.status]).toEqual([
      'SOLD',
      'PART_SOLD',
    ]);
  });
});
