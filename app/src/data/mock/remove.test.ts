import { RULE_DEFAULTS, ZERO_ADDRESS } from '@sleeve/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { DataLayerError } from '../errors';
import type { LedgerView } from '../types';
import { createMockDataLayer, type MockDataLayer } from './data-layer';
import { SAMPLE_ACCOUNT, SAMPLE_PAYERS } from './fixtures';

/**
 * Remove Sleeve and the account after it, on the mock (D-040): the uninstall releases what waits with RELEASED
 * receipts and leaves no module state, the account can still send its USDG without brackets, and turning Sleeve back on
 * takes a fresh snapshot. The chain layer's own tests cover the same paths against a fake chain (../chain/remove.test.ts).
 */

const TO = SAMPLE_PAYERS.friend;

let layer: MockDataLayer;
/** The sample at the weekend: 75 USDG waiting to buy SPY, 165.80 USDG not sorted, the rest spendable. */
let before: LedgerView;

beforeEach(async () => {
  layer = createMockDataLayer();
  before = await layer.getLedger(SAMPLE_ACCOUNT);
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

describe('removing Sleeve', () => {
  it('previews each waiting bucket moving to spend, and says payments stop splitting', async () => {
    const preview = await layer.previewAction({ kind: 'remove' });
    expect(preview.legs).toEqual([
      { from: { kind: 'waiting', tickerId: 0 }, to: { kind: 'spend' }, sends: { asset: { kind: 'USDG' }, amount: 75_000_000n }, receives: null },
    ]);
    expect(preview.warnings).toEqual([{ code: 'REMOVE_STOPS_SPLITS' }, { code: 'RELEASE_ENDS_WAIT', tickerId: 0 }]);
    expect(preview.blocked).toBeNull();
  });

  it('releases what waits with a RELEASED receipt each, in one transaction, and leaves no module state', async () => {
    // #when the owner removes Sleeve
    const result = await layer.removeSleeve();
    // #then the SPY bucket went to spend with its own record
    expect(result.released.map(({ receipt }) => [receipt.status, receipt.trigger, receipt.tickerId, receipt.usdgToSpend])).toEqual([
      ['RELEASED', 'OWNER', 0, 75_000_000n],
    ]);
    expect(result.released.every((record) => record.derived.txHash === result.txHash)).toBe(true);
    // #then the account reads as one without the module: no ledger, no buckets, no rule, no keeper
    const [account, ledger, buckets, rule, split] = await Promise.all([
      layer.getAccount(SAMPLE_ACCOUNT),
      layer.getLedger(SAMPLE_ACCOUNT),
      layer.getBuckets(SAMPLE_ACCOUNT),
      layer.getRule(SAMPLE_ACCOUNT),
      layer.previewSplit(SAMPLE_ACCOUNT),
    ]);
    expect([account.deployed, account.moduleInstalled, account.installedAt, account.keeper]).toEqual([true, false, null, ZERO_ADDRESS]);
    expect([ledger.balance, ledger.spend, ledger.pendingTotal, ledger.unsorted]).toEqual([before.balance, 0n, 0n, 0n]);
    expect([buckets, rule.status, split.unsorted, split.outcome]).toEqual([[], 'NONE', 0n, null]);
  });

  it('refuses every module write afterwards, and a second removal, with NotInstalled', async () => {
    await layer.removeSleeve();
    expect((await failure(layer.removeSleeve())).code).toBe('NotInstalled');
    expect((await failure(layer.setRule({ ...RULE_DEFAULTS }))).code).toBe('NotInstalled');
    expect((await failure(layer.split())).code).toBe('NotInstalled');
    expect((await layer.previewAction({ kind: 'setRule', input: { ...RULE_DEFAULTS } })).blocked).toEqual({ code: 'NotInstalled' });
    expect((await layer.previewAction({ kind: 'remove' })).blocked).toEqual({ code: 'NotInstalled' });
  });
});

describe('a send from an account without the module', () => {
  beforeEach(async () => {
    await layer.removeSleeve();
  });

  it('sends any of the balance as one plain transfer, with no ledger behind it', async () => {
    // #given more than the old spend ledger held, since nothing is held back now
    const amount = before.spend + 100_000_000n;
    // #when the owner previews and sends it
    const preview = await layer.previewAction({ kind: 'withdraw', request: { to: TO, amount } });
    const result = await layer.withdraw({ to: TO, amount });
    // #then the preview showed the transfer and the result is the balance delta, from no ledger
    expect([preview.legs, preview.warnings, preview.blocked]).toEqual([
      [{ from: { kind: 'spend' }, to: { kind: 'outside', address: TO }, sends: { asset: { kind: 'USDG' }, amount }, receives: null }],
      [],
      null,
    ]);
    expect([result.balanceBefore - result.balanceAfter, result.from]).toEqual([amount, null]);
    expect((await layer.getLedger(SAMPLE_ACCOUNT)).balance).toBe(before.balance - amount);
  });

  it('blocks a send over the balance or of nothing', async () => {
    const over = await layer.previewAction({ kind: 'withdraw', request: { to: TO, amount: before.balance + 1n } });
    expect(over.blocked).toEqual({ code: 'InsufficientBalance', balance: before.balance, needed: before.balance + 1n });
    expect((await failure(layer.withdraw({ to: TO, amount: before.balance + 1n }))).code).toBe('InsufficientBalance');
    expect((await layer.previewAction({ kind: 'withdraw', request: { to: TO, amount: 0n } })).blocked).toEqual({ code: 'ZeroAmount' });
  });
});

describe('turning Sleeve back on', () => {
  it('previews the rule it installs at the next version, and that the balance stays spendable', async () => {
    await layer.removeSleeve();
    const preview = await layer.previewAction({ kind: 'reinstall', rule: { ...RULE_DEFAULTS } });
    expect(preview.legs).toEqual([]);
    expect(preview.rule?.before.status).toBe('NONE');
    expect(preview.rule?.after).toEqual({ version: 3, status: 'ACTIVE', equityBps: 1_000, tickerId: 0, premiumCapBps: 100, slippageBps: 50, minClip: 25_000_000n });
    expect(preview.warnings).toEqual([{ code: 'SNAPSHOT_KEEPS_BALANCE', amount: before.balance }]);
    expect(preview.blocked).toBeNull();
  });

  it('installs the module with a fresh snapshot, so only payments after it split (I5)', async () => {
    // #given an account Sleeve was removed from
    await layer.removeSleeve();
    // #when the owner turns it back on and a payment then arrives
    const rule = await layer.reinstallSleeve({ ...RULE_DEFAULTS });
    const snapshot = await layer.getLedger(SAMPLE_ACCOUNT);
    layer.simulate.receivePayment(200_000_000n);
    // #then the rule took the next version, the old balance is all spend, and only the payment is unsorted
    expect([rule.version, rule.status]).toEqual([3, 'ACTIVE']);
    expect((await layer.getAccount(SAMPLE_ACCOUNT)).moduleInstalled).toBe(true);
    expect([snapshot.spend, snapshot.pendingTotal, snapshot.unsorted]).toEqual([before.balance, 0n, 0n]);
    expect((await layer.getLedger(SAMPLE_ACCOUNT)).unsorted).toBe(200_000_000n);
  });

  it('refuses an account the module is installed on', async () => {
    expect((await failure(layer.reinstallSleeve({ ...RULE_DEFAULTS }))).code).toBe('ModuleInstalled');
    expect((await layer.previewAction({ kind: 'reinstall', rule: { ...RULE_DEFAULTS } })).blocked).toEqual({ code: 'ModuleInstalled' });
  });

  it('turns it back on at the same address when the owner sets up again with the same passkey', async () => {
    // #given a passkey account that holds 100 USDG and removed Sleeve
    const signer = { kind: 'passkey', credentialId: 'c2V0dXAtYWdhaW4' } as const;
    const first = await layer.createAccount({ rule: { ...RULE_DEFAULTS }, recoverySigner: null, signer });
    layer.simulate.receivePayment(100_000_000n);
    await layer.removeSleeve();
    // #when the owner goes through setup again
    const second = await layer.createAccount({ rule: { ...RULE_DEFAULTS }, recoverySigner: null, signer });
    // #then the module is back on the same account, with its balance kept as spend
    const ledger = await layer.getLedger(second.account);
    expect(second.account).toBe(first.account);
    expect((await layer.getAccount(second.account)).moduleInstalled).toBe(true);
    expect([ledger.balance, ledger.spend, ledger.unsorted]).toEqual([100_000_000n, 100_000_000n, 0n]);
  });
});
