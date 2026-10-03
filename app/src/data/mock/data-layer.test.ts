import { RULE_DEFAULTS } from '@sleeve/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { DataLayerError } from '../errors';
import type { SellRequest } from '../types';
import { createMockDataLayer, type MockDataLayer } from './data-layer';
import {
  FIXTURE_NOW,
  NEXT_OPEN,
  SAMPLE_ACCOUNT,
  SAMPLE_BLOCKED_ACCOUNT,
  SAMPLE_CARD_IDS,
  SAMPLE_RECEIPT_IDS,
  SAMPLE_WEEK_START,
} from './fixtures';

let layer: MockDataLayer;

beforeEach(() => {
  layer = createMockDataLayer();
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

const SELL_QQQ: SellRequest = {
  tickerId: 1,
  amount: 10_000_000_000_000_000n,
  lotId: 0n,
  overrideClosed: false,
  overrideCapBps: 0,
};

describe('session', () => {
  it('starts signed in as the sample owner', async () => {
    expect((await layer.getSession())?.account).toBe(SAMPLE_ACCOUNT);
  });

  it('refuses owner writes after sign-out and accepts them after sign-in', async () => {
    // #given a signed-out tab
    await layer.signOut();
    // #when the owner writes, then signs in and writes again
    const refused = await failure(layer.pauseRule());
    await layer.signIn();
    const paused = await layer.pauseRule();
    // #then only the signed-in write lands
    expect([refused.code, paused.status]).toEqual(['NotSignedIn', 'PAUSED']);
  });

  it('creates an empty account with the module installed and signs into it', async () => {
    const session = await layer.createAccount({ rule: { ...RULE_DEFAULTS }, recoverySigner: null });
    const [account, ledger, receipts] = await Promise.all([
      layer.getAccount(session.account),
      layer.getLedger(session.account),
      layer.listReceipts({ account: session.account }),
    ]);
    expect({
      installed: account.moduleInstalled,
      balance: ledger.balance,
      receipts: receipts.items.length,
    }).toEqual({ installed: true, balance: 0n, receipts: 0 });
  });
});

describe('reads', () => {
  it('reports the weekend ledger: 165.80 USDG unsorted and 75 USDG waiting', async () => {
    const ledger = await layer.getLedger(SAMPLE_ACCOUNT);
    expect([ledger.unsorted, ledger.pendingTotal, ledger.asOf.timestamp]).toEqual([
      165_800_000n,
      75_000_000n,
      FIXTURE_NOW.timestamp,
    ]);
  });

  it('previews a split that would queue for the session', async () => {
    const preview = await layer.previewSplit(SAMPLE_ACCOUNT);
    expect(preview).toMatchObject({
      unsorted: 165_800_000n,
      spendPart: 149_220_000n,
      equityPart: 16_580_000n,
      outcome: { kind: 'QUEUE', reason: 'SESSION' },
    });
  });

  it('lists holdings with open lots only, oldest first', async () => {
    const holdings = await layer.getHoldings(SAMPLE_ACCOUNT);
    expect(holdings.map((holding) => [holding.tickerId, holding.lots.map((lot) => lot.id)])).toEqual([
      [0, [SAMPLE_RECEIPT_IDS.settled, SAMPLE_RECEIPT_IDS.filledSpy, SAMPLE_RECEIPT_IDS.filledSpySecond]],
      [1, [SAMPLE_RECEIPT_IDS.filledQqqSecond]],
    ]);
  });

  it('pages receipts newest first with a cursor', async () => {
    const first = await layer.listReceipts({ account: SAMPLE_ACCOUNT, limit: 5 });
    const second = await layer.listReceipts({ account: SAMPLE_ACCOUNT, limit: 5, cursor: first.nextCursor ?? '' });
    const ids = [...first.items, ...second.items].map((entry) => entry.receipt.id);
    expect(ids).toEqual([642n, 611n, 560n, 503n, 455n, 416n, 415n, 401n, 388n, 305n]);
  });

  it('filters receipts by status', async () => {
    const page = await layer.listReceipts({ account: SAMPLE_ACCOUNT, status: 'FILLED' });
    expect(page.items.map((entry) => entry.receipt.id)).toEqual([611n, 455n, 305n, 212n]);
  });

  it('serves any receipt by id, including another account', async () => {
    const entry = await layer.getReceipt(SAMPLE_RECEIPT_IDS.refusedAccount);
    expect([entry?.receipt.account, entry?.receipt.status]).toEqual([SAMPLE_BLOCKED_ACCOUNT, 'REFUSED_ACCOUNT']);
  });

  it('answers null for a receipt id nobody wrote', async () => {
    expect(await layer.getReceipt(1n)).toBeNull();
  });

  it('hands out copies, so a screen cannot change the sample', async () => {
    const ledger = await layer.getLedger(SAMPLE_ACCOUNT);
    ledger.spend = 0n;
    expect((await layer.getLedger(SAMPLE_ACCOUNT)).spend).not.toBe(0n);
  });
});

describe('cards', () => {
  it('shows a receipt card without amounts or proof unless the owner chose them', async () => {
    expect(await layer.getCard(SAMPLE_CARD_IDS.receipt)).toMatchObject({
      kind: 'receipt',
      tickerId: 0,
      status: 'FILLED',
      equityBps: 1_000,
      amounts: null,
      proof: null,
    });
  });

  it('builds the week card from the receipts in that New York week', async () => {
    const card = await layer.getCard(SAMPLE_CARD_IDS.week);
    expect(card).toMatchObject({
      kind: 'week',
      weekStart: SAMPLE_WEEK_START,
      weekEnd: SAMPLE_WEEK_START + 7n * 86_400n,
      paydays: 4,
      tickerIds: [0],
    });
  });

  it('refuses a card for a receipt the owner did not write', async () => {
    const error = await failure(
      layer.createCard({
        subject: { kind: 'receipt', receiptId: SAMPLE_RECEIPT_IDS.refusedAccount },
        showAmounts: false,
        showProof: false,
      }),
    );
    expect(error.code).toBe('NotFound');
  });

  it('returns null for an unknown card', async () => {
    expect(await layer.getCard('nothing-here')).toBeNull();
  });
});

describe('owner writes at the weekend', () => {
  it('splits the unsorted USDG and queues the equity share for the session', async () => {
    const [receipt] = await layer.split();
    const inbox = await layer.getInbox(SAMPLE_ACCOUNT);
    expect({
      status: receipt?.receipt.status,
      reason: receipt?.receipt.reason,
      trigger: receipt?.receipt.trigger,
      unsortedLeft: inbox.filter((item) => item.state !== 'SORTED').length,
    }).toEqual({ status: 'QUEUED', reason: 'SESSION', trigger: 'OWNER', unsortedLeft: 0 });
  });

  it('keeps the bucket waiting when the owner asks to buy before the reopen', async () => {
    const error = await failure(layer.settle(0));
    expect(error.detail).toEqual({ code: 'GuardNotClear', reason: 'SESSION' });
  });

  it('releases the whole bucket to spend', async () => {
    const before = await layer.getLedger(SAMPLE_ACCOUNT);
    const released = await layer.release(0);
    const after = await layer.getLedger(SAMPLE_ACCOUNT);
    expect([released.receipt.status, after.spend - before.spend, after.pendingTotal]).toEqual([
      'RELEASED',
      75_000_000n,
      0n,
    ]);
  });

  it('quotes a sell that waits for the reopen', async () => {
    const quote = await layer.getSellQuote(SELL_QQQ);
    expect([quote.waits, quote.blocked]).toEqual([{ reason: 'SESSION', reopensAt: NEXT_OPEN }, null]);
  });

  it('rejects the sell with SellWaits unless the owner overrides', async () => {
    const error = await failure(layer.sell(SELL_QQQ));
    expect(error.detail).toEqual({ code: 'SellWaits', reason: 'SESSION', reopensAt: NEXT_OPEN });
  });

  it('sells with the override and records it on the receipt', async () => {
    const [receipt] = await layer.sell({ ...SELL_QQQ, overrideClosed: true });
    expect([receipt?.receipt.status, receipt?.receipt.overrideClosed]).toEqual(['PART_SOLD', true]);
  });

  it('refuses a sell larger than the open lots', async () => {
    const quote = await layer.getSellQuote({ ...SELL_QQQ, amount: 10n ** 18n });
    expect(quote.blocked?.code).toBe('ExceedsLots');
  });
});

describe('rules', () => {
  it('names every problem with a rule it refuses', async () => {
    const error = await failure(layer.setRule({ ...RULE_DEFAULTS, equityBps: 2_000, premiumCapBps: 900 }));
    expect(error.detail).toEqual({ code: 'InvalidRule', issues: ['SharesSumNotTotal', 'PremiumCapOutOfRange'] });
  });

  it('writes a new version for an accepted rule', async () => {
    const rule = await layer.setRule({ ...RULE_DEFAULTS, spendBps: 8_000, equityBps: 2_000, tickerId: 2 });
    expect([rule.version, rule.equityBps, rule.tickerId]).toEqual([3, 2_000, 2]);
  });

  it('leaves new USDG unsorted while the rule is paused', async () => {
    await layer.pauseRule();
    const error = await failure(layer.split());
    expect(error.code).toBe('RuleNotActive');
  });
});

describe('sample-mode controls', () => {
  it('buys the waiting bucket once the market opens and the keeper runs', async () => {
    // #given the 75 USDG weekend bucket and 165.80 USDG unsorted
    // #when the market opens and the keeper runs
    layer.simulate.openMarket();
    const written = layer.simulate.runKeeper();
    // #then the 16.58 equity share is under the clip and joins the bucket, and the whole bucket buys
    expect(written.map(({ receipt }) => [receipt.status, receipt.reason, receipt.usdgQueued + receipt.usdgSpent])).toEqual([
      ['QUEUED', 'CLIP', 16_580_000n],
      ['SETTLED', 'NONE', 91_580_000n],
    ]);
  });

  it('turns a new payment into a split the keeper fills', async () => {
    layer.simulate.openMarket();
    layer.simulate.runKeeper();
    layer.simulate.receivePayment(500_000_000n);
    const [filled] = layer.simulate.runKeeper();
    expect([filled?.receipt.usdgIn, filled?.receipt.usdgToSpend, filled?.receipt.usdgSpent]).toEqual([
      500_000_000n,
      450_000_000n,
      50_000_000n,
    ]);
  });
});

describe('verification', () => {
  it('matches every check on a sample fill', async () => {
    const result = await layer.verifyReceipt(SAMPLE_RECEIPT_IDS.filledSpy);
    expect([result.status, result.checks.every((check) => check.ok), result.checks.length > 5]).toEqual([
      'MATCH',
      true,
      true,
    ]);
  });

  it('reports NOT_FOUND for an id nobody wrote', async () => {
    expect((await layer.verifyReceipt(999_999n)).status).toBe('NOT_FOUND');
  });
});

describe('eligibility', () => {
  it('lets a resident of Nigeria through from a Nigerian IP', async () => {
    const result = await layer.checkEligibility({ residence: 'NG', notUsPerson: true, notSanctioned: true });
    expect(result).toEqual({ eligible: true, ipCountry: 'NG', blocks: [] });
  });

  it('blocks restricted and prohibited residences and missing attestations', async () => {
    const restricted = await layer.checkEligibility({ residence: 'gb', notUsPerson: true, notSanctioned: true });
    const prohibited = await layer.checkEligibility({ residence: 'RU', notUsPerson: false, notSanctioned: true });
    expect([restricted.blocks, prohibited.blocks]).toEqual([
      [{ kind: 'RESIDENCE_RESTRICTED', country: 'GB' }],
      [{ kind: 'RESIDENCE_PROHIBITED', country: 'RU' }, { kind: 'US_PERSON' }],
    ]);
  });
});
