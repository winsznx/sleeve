import { RULE_DEFAULTS, ZERO_ADDRESS } from '@sleeve/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { DataLayerError } from '../errors';
import type { ActionPreview, SellRequest } from '../types';
import { createMockDataLayer, type MockDataLayer } from './data-layer';
import { NEXT_OPEN, SAMPLE_ACCOUNT, SAMPLE_PAYERS } from './fixtures';

const TO = SAMPLE_PAYERS.friend;

let layer: MockDataLayer;
/** The sample at the weekend: about 3,356.05 USDG spendable, 165.80 not sorted, 75 waiting to buy SPY. */
let SPEND = 0n;
let UNSORTED = 0n;
let WAITING = 0n;

beforeEach(async () => {
  layer = createMockDataLayer();
  const ledger = await layer.getLedger(SAMPLE_ACCOUNT);
  [SPEND, UNSORTED, WAITING] = [ledger.spend, ledger.unsorted, ledger.pendingTotal];
});

async function failure(promise: Promise<unknown>): Promise<DataLayerError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DataLayerError) return error;
    throw error;
  }
  throw new Error('expected the call to reject with a DataLayerError');
}

function sends(preview: ActionPreview): bigint[] {
  return preview.legs.map((leg) => leg.sends.amount);
}

describe('withdraw', () => {
  it('sends from spend, reads the balance back, and logs the USDG transfer under a transaction hash', async () => {
    const before = await layer.getLedger(SAMPLE_ACCOUNT);
    const result = await layer.withdraw({ to: TO, amount: 120_000_000n });
    expect(result.balanceBefore - result.balanceAfter).toBe(120_000_000n);
    expect(result.from).toEqual({ spend: 120_000_000n, unsorted: 0n, buckets: [] });
    expect(result.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    const after = await layer.getLedger(SAMPLE_ACCOUNT);
    expect(before.spend - after.spend).toBe(120_000_000n);
    expect([after.unsorted, after.pendingTotal]).toEqual([before.unsorted, before.pendingTotal]);
  });

  it('takes spend first, then what is not sorted, in LedgerMath order', async () => {
    const result = await layer.withdraw({ to: TO, amount: SPEND + 10_000_000n });
    expect(result.from).toEqual({ spend: SPEND, unsorted: 10_000_000n, buckets: [] });
    const after = await layer.getLedger(SAMPLE_ACCOUNT);
    expect([after.spend, after.unsorted, after.pendingTotal]).toEqual([0n, UNSORTED - 10_000_000n, WAITING]);
  });

  it('refuses nothing, more than the balance, and an address inside the account', async () => {
    expect((await failure(layer.withdraw({ to: TO, amount: 0n }))).detail).toEqual({ code: 'ZeroAmount' });
    expect((await failure(layer.withdraw({ to: TO, amount: SPEND + UNSORTED + WAITING + 1n }))).detail).toEqual({
      code: 'InsufficientBalance',
      balance: SPEND + UNSORTED + WAITING,
      needed: SPEND + UNSORTED + WAITING + 1n,
    });
    await expect(layer.withdraw({ to: SAMPLE_ACCOUNT, amount: 1n })).rejects.toThrow(RangeError);
    await expect(layer.withdraw({ to: ZERO_ADDRESS, amount: 1n })).rejects.toThrow(RangeError);
  });
});

describe('previewAction', () => {
  it('previews a send from spend to the outside address, sponsored, without moving anything', async () => {
    const preview = await layer.previewAction({ kind: 'withdraw', request: { to: TO, amount: 50_000_000n } });
    expect(preview.legs).toEqual([
      { from: { kind: 'spend' }, to: { kind: 'outside', address: TO }, sends: { asset: { kind: 'USDG' }, amount: 50_000_000n }, receives: null },
    ]);
    expect(preview.warnings).toEqual([]);
    expect(preview.blocked).toBeNull();
    expect(preview.fee.sponsored).toBe(true);
    expect(preview.fee.wei).toBe(preview.fee.gas * preview.fee.gasPriceWei);
    expect((await layer.getLedger(SAMPLE_ACCOUNT)).spend).toBe(SPEND);
  });

  it('warns when a send reaches into USDG not sorted yet or waiting to buy, and blocks one over the balance', async () => {
    const reach = await layer.previewAction({ kind: 'withdraw', request: { to: TO, amount: SPEND + UNSORTED + 5_000_000n } });
    expect(sends(reach)).toEqual([SPEND, UNSORTED, 5_000_000n]);
    expect(reach.warnings).toEqual([
      { code: 'SENDS_UNSORTED', amount: UNSORTED },
      { code: 'SENDS_WAITING', tickerId: 0, amount: 5_000_000n },
    ]);
    const over = await layer.previewAction({ kind: 'withdraw', request: { to: TO, amount: SPEND + UNSORTED + WAITING + 1n } });
    expect(over.blocked).toEqual({ code: 'InsufficientBalance', balance: SPEND + UNSORTED + WAITING, needed: SPEND + UNSORTED + WAITING + 1n });
    const self = await layer.previewAction({ kind: 'withdraw', request: { to: SAMPLE_ACCOUNT, amount: 1n } });
    expect(self.blocked).toEqual({ code: 'InvalidDestination', reason: 'SELF' });
  });

  it('previews a weekend split: the spend part to spend and the equity share waiting for the session', async () => {
    const preview = await layer.previewAction({ kind: 'split' });
    expect(preview.legs.map((leg) => [leg.from.kind, leg.to.kind, leg.sends.amount])).toEqual([
      ['unsorted', 'spend', 149_220_000n],
      ['unsorted', 'waiting', 16_580_000n],
    ]);
    expect(preview.warnings).toEqual([{ code: 'EQUITY_WILL_WAIT', tickerId: 0, reason: 'SESSION', reopensAt: NEXT_OPEN }]);
    expect(preview.price).toBeNull();
  });

  it('previews a split that buys once the market is open, with the price against the reference and the minimum', async () => {
    // #given the market open and enough unsorted for an equity share above the 25 USDG minimum buy
    layer.simulate.openMarket();
    layer.simulate.receivePayment(1_000_000_000n);
    const preview = await layer.previewAction({ kind: 'split' });
    const buy = preview.legs[1];
    expect(buy?.to).toEqual({ kind: 'holding', tickerId: 0 });
    expect(buy?.receives?.amount).toBeGreaterThan(0n);
    expect(buy?.receives?.minimum).toBeGreaterThan(0n);
    expect(buy?.receives?.minimum).toBeLessThan(buy?.receives?.amount ?? 0n);
    expect(preview.price).toMatchObject({ side: 'BUY', tickerId: 0, capBps: 100, withinCap: true });
    expect(preview.warnings).toEqual([]);
  });

  it('previews a release as waiting USDG moving to spend, and says the wait ends', async () => {
    const preview = await layer.previewAction({ kind: 'release', tickerId: 0 });
    expect(preview.legs).toEqual([
      {
        from: { kind: 'waiting', tickerId: 0 },
        to: { kind: 'spend' },
        sends: { asset: { kind: 'USDG' }, amount: WAITING },
        receives: null,
      },
    ]);
    expect(preview.warnings).toEqual([{ code: 'RELEASE_ENDS_WAIT', tickerId: 0 }]);
    expect((await layer.previewAction({ kind: 'release', tickerId: 1 })).blocked).toEqual({ code: 'NothingWaiting' });
  });

  it('blocks a buy now while the market is closed and prices it once it opens', async () => {
    const closed = await layer.previewAction({ kind: 'settle', tickerId: 0 });
    expect(closed.blocked).toEqual({ code: 'GuardNotClear', reason: 'SESSION' });
    layer.simulate.openMarket();
    const open = await layer.previewAction({ kind: 'settle', tickerId: 0 });
    expect(open.blocked).toBeNull();
    expect(open.legs[0]).toMatchObject({ from: { kind: 'waiting', tickerId: 0 }, to: { kind: 'holding', tickerId: 0 } });
    expect(open.price).toMatchObject({ side: 'BUY', withinCap: true });
  });

  it('previews a sale without waiting: the swap, the wider cap and the skipped wait', async () => {
    const request: SellRequest = { tickerId: 0, amount: 100_000_000_000_000_000n, lotId: 0n, overrideClosed: true, overrideCapBps: 200 };
    const preview = await layer.previewAction({ kind: 'sell', request });
    expect(preview.legs[0]).toMatchObject({
      from: { kind: 'holding', tickerId: 0 },
      to: { kind: 'spend' },
      sends: { asset: { kind: 'STOCK_TOKEN', tickerId: 0 }, amount: request.amount },
      receives: { asset: { kind: 'USDG' } },
    });
    expect(preview.price).toMatchObject({ side: 'SELL', capBps: 200, withinCap: true });
    expect(preview.warnings).toEqual([
      { code: 'SKIPS_MARKET_WAIT', reopensAt: NEXT_OPEN },
      { code: 'WIDER_CAP', capBps: 200, ruleCapBps: 100 },
    ]);
    expect(preview.blocked).toBeNull();
    const waits = await layer.previewAction({ kind: 'sell', request: { ...request, overrideClosed: false, overrideCapBps: 0 } });
    expect(waits.blocked).toEqual({ code: 'SellWaits', reason: 'SESSION', reopensAt: NEXT_OPEN });
  });

  it('previews rule changes as the rule now and after, moving nothing', async () => {
    const save = await layer.previewAction({ kind: 'setRule', input: { ...RULE_DEFAULTS, equityBps: 2_000 } });
    expect(save.legs).toEqual([]);
    expect(save.rule?.before).toMatchObject({ version: 2, equityBps: 1_000, status: 'ACTIVE' });
    expect(save.rule?.after).toMatchObject({ version: 3, equityBps: 2_000, status: 'ACTIVE' });
    const invalid = await layer.previewAction({ kind: 'setRule', input: { ...RULE_DEFAULTS, minClip: 1n } });
    expect(invalid.blocked?.code).toBe('InvalidRule');
    const pause = await layer.previewAction({ kind: 'pauseRule' });
    expect(pause.rule?.after.status).toBe('PAUSED');
    expect(pause.warnings).toEqual([{ code: 'PAUSE_LEAVES_UNSORTED' }]);
    expect((await layer.previewAction({ kind: 'resumeRule' })).blocked).toEqual({ code: 'RuleNotPaused' });
    await layer.pauseRule();
    const resume = await layer.previewAction({ kind: 'resumeRule' });
    expect(resume.blocked).toBeNull();
    expect(resume.warnings).toEqual([{ code: 'RESUME_SPLITS_UNSORTED', amount: UNSORTED }]);
  });
});
