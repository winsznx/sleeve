// @vitest-environment node
import { ADDRESSES, RULE_DEFAULTS } from '@sleeve/core';
import { formatLog, type Hex, type RpcLog } from 'viem';
import type { UserOperation } from 'viem/account-abstraction';
import { describe, expect, it } from 'vitest';

import { blockText } from '@/components/actions/preview-text';
import { uninstallSleeveModuleCall } from '@/lib/chain/kernel';
import {
  NotBracketedError,
  SLEEVE_MODULE,
  UNINSTALL_CALL_GAS_LIMIT,
  assertBracketed,
  buildUnbracketedOp,
} from '@/lib/chain/owner-ops';

import type { MarketSnapshot } from '../types';
import {
  ACCOUNT,
  ACTIVE_RULE,
  BLOCK_TIME,
  HEAD,
  NO_RULE,
  OP_BLOCK,
  PASSKEY_SIGNATURE,
  PAYEE,
  PAYER,
  STORED_HASH,
  TX_HASH,
  chainLayer,
  failure,
  fakeClient,
  installed,
  landingRoute,
  ownerOpEndedLog,
  releasedLog,
  releasedReceipt,
  removed,
  suggestedRule,
  uninstallResultLog,
  usdgTransferLog,
  type ChainState,
} from './__tests__/fake-chain';
import { kernelAccountFor } from './accounts';
import { runUnbracketedOp } from './owner-op';
import { previewOnChain, previewUnbracketed, withdrawSteps } from './preview';
import type { PreparedOp, PrepareRequest } from './user-ops';

/**
 * Remove Sleeve, the send of an account without the module and the reinstall, run through the chain data layer itself
 * (D-040) on the fake chain in __tests__/fake-chain.ts. Every assertion reads what the layer read back, the way the
 * chain would answer it.
 */

function sendOut(amount: bigint): (state: ChainState) => void {
  return (state) => {
    state.balanceAfter = state.balanceBefore - amount;
  };
}

function takeModuleOff(state: ChainState): void {
  state.initialized = false;
  state.listed = false;
  state.rule = NO_RULE;
}

describe('removeSleeve on chain', () => {
  it('uninstalls in one bracketed op with the fixed call gas, and resolves with each RELEASED receipt once the module reads back off', async () => {
    // #given an installed account with 75 USDG waiting to buy SPY, and an uninstall that releases it
    const state = installed();
    const released = releasedReceipt(700n, 0, 75_000_000n);
    const route = landingRoute(state, takeModuleOff, [releasedLog(released, 2), uninstallResultLog(true, 3)]);
    const client = fakeClient(state);
    const layer = chainLayer(client, route);

    // #when the owner removes Sleeve
    const result = await layer.removeSleeve();

    // #then the op was the bracketed uninstall with the fixed call gas limit
    const [request] = route.prepared;
    expect(request?.callGasLimit).toBe(UNINSTALL_CALL_GAS_LIMIT);
    const calls = assertBracketed(request?.callData ?? '0x');
    expect(calls.slice(1, -1).map((call) => call.data)).toEqual([uninstallSleeveModuleCall(ACCOUNT, SLEEVE_MODULE).data]);
    // #then the result is read from the transaction and the account after it
    expect(result.txHash).toBe(TX_HASH);
    expect(result.at).toEqual({ l2Block: OP_BLOCK, timestamp: BLOCK_TIME });
    expect(result.released.map(({ receipt }) => [receipt.id, receipt.status, receipt.tickerId, receipt.usdgToSpend])).toEqual([
      [700n, 'RELEASED', 0, 75_000_000n],
    ]);
    expect(result.released[0]?.receiptHash).toBe(STORED_HASH);
    expect((await layer.getAccount(ACCOUNT)).moduleInstalled).toBe(false);
  });

  it('refuses with UninstallFailed when Kernel reports that the module did not release', async () => {
    // #given an uninstall whose onUninstall reverted: Kernel took the module off the list and went on
    const state = installed();
    const route = landingRoute(
      state,
      (chain) => {
        chain.listed = false;
      },
      [uninstallResultLog(false, 3)],
    );
    const layer = chainLayer(fakeClient(state), route);
    // #when / #then the removal is refused by name, with the result Kernel gave
    expect((await failure(layer.removeSleeve())).detail).toEqual({ code: 'UninstallFailed', result: false });
  });

  it('refuses with UninstallFailed when the transaction carries no result for the module', async () => {
    const state = installed();
    const route = landingRoute(state, takeModuleOff, []);
    const layer = chainLayer(fakeClient(state), route);
    expect((await failure(layer.removeSleeve())).detail).toEqual({ code: 'UninstallFailed', result: null });
  });

  it('refuses when the account still reads back with the module, whatever the logs say', async () => {
    const state = installed();
    const route = landingRoute(state, () => undefined, [uninstallResultLog(true, 3)]);
    const layer = chainLayer(fakeClient(state), route);
    expect((await failure(layer.removeSleeve())).code).toBe('SourceUnavailable');
  });
});

describe('a send from an account without the module', () => {
  it('sends one plain transfer without brackets and reads it back from its own USDG Transfer log', async () => {
    // #given an account Sleeve was removed from, holding 500 USDG
    const state = removed();
    const route = landingRoute(state, sendOut(120_000_000n), [usdgTransferLog(ACCOUNT, PAYEE, 120_000_000n, 1)]);
    const layer = chainLayer(fakeClient(state), route);

    // #when the owner sends 120 USDG
    const result = await layer.withdraw({ to: PAYEE, amount: 120_000_000n });

    // #then the op was the bare transfer, which the bracket check refuses, and the balances are there to show
    const callData = route.prepared[0]?.callData ?? '0x';
    expect(callData).toBe(buildUnbracketedOp(ACCOUNT, { kind: 'send', to: PAYEE, amount: 120_000_000n }).callData);
    expect(() => assertBracketed(callData)).toThrow(NotBracketedError);
    expect([result.balanceBefore, result.balanceAfter, result.from]).toEqual([500_000_000n, 380_000_000n, null]);
  });

  it('reads a send back by its Transfer log when USDG also lands in the same block', async () => {
    // #given a block where the send leaves and a 30 USDG payment arrives, so the balance falls by only 90
    const state = removed();
    const route = landingRoute(
      state,
      (chain) => {
        chain.balanceAfter = chain.balanceBefore - 120_000_000n + 30_000_000n;
      },
      [usdgTransferLog(ACCOUNT, PAYEE, 120_000_000n, 1), usdgTransferLog(PAYER, ACCOUNT, 30_000_000n, 2)],
    );
    const layer = chainLayer(fakeClient(state), route);

    // #when the owner sends 120 USDG
    const result = await layer.withdraw({ to: PAYEE, amount: 120_000_000n });

    // #then the send reads back from its own log, and the balances show what the block did
    expect(result.request.amount).toBe(120_000_000n);
    expect([result.balanceBefore, result.balanceAfter]).toEqual([500_000_000n, 410_000_000n]);
  });

  it('refuses a send whose transaction carries no USDG Transfer of exactly the amount to the destination', async () => {
    // #given transactions whose logs move another token, another amount, or USDG to someone else
    const cases = [
      [usdgTransferLog(ACCOUNT, PAYEE, 120_000_000n, 1, PAYER)],
      [usdgTransferLog(ACCOUNT, PAYEE, 119_000_000n, 1)],
      [usdgTransferLog(ACCOUNT, PAYER, 120_000_000n, 1)],
    ];
    for (const logs of cases) {
      const state = removed();
      const layer = chainLayer(fakeClient(state), landingRoute(state, sendOut(120_000_000n), logs));
      // #when the send lands / #then it is not read back, even though the balance fell by the amount
      const error = await failure(layer.withdraw({ to: PAYEE, amount: 120_000_000n }));
      expect([error.code, error.message]).toEqual(['SourceUnavailable', 'The send did not read back as the amount leaving the account']);
    }
  });

  it('refuses the unbracketed path for an account the module is installed on, before anything is prepared', async () => {
    // #given an installed account and its Kernel account
    const state = installed();
    const client = fakeClient(state);
    const route = landingRoute(state, () => undefined, []);
    const kernel = await kernelAccountFor(
      client,
      { kind: 'passkey', credentialId: 'c2xlZXZlLXRlc3Q', publicKey: { x: 1n, y: 2n }, sign: async () => PASSKEY_SIGNATURE },
      ACCOUNT,
    );
    // #when an op without brackets is asked for
    const error = await failure(runUnbracketedOp(client, route, kernel, { kind: 'send', to: PAYEE, amount: 1n }));
    // #then it is refused by name and nothing reached the bundler
    expect(error.code).toBe('ModuleInstalled');
    expect(route.prepared).toEqual([]);
  });

  it('keeps a send from an installed account in the bracketed owner op', async () => {
    const state = installed();
    const route = landingRoute(state, sendOut(120_000_000n), [ownerOpEndedLog(-120_000_000n, 120_000_000n, 4)]);
    const layer = chainLayer(fakeClient(state), route);
    const result = await layer.withdraw({ to: PAYEE, amount: 120_000_000n });
    expect(() => assertBracketed(route.prepared[0]?.callData ?? '0x')).not.toThrow();
    expect(result.from).toEqual({ spend: 120_000_000n, unsorted: 0n, buckets: [] });
  });
});

describe('turning Sleeve back on', () => {
  it('sends the install op without brackets and resolves with the rule once the module reads back installed', async () => {
    // #given an account Sleeve was removed from, whose last rule was version 2
    const state = removed();
    const installedRule = suggestedRule(3);
    const route = landingRoute(
      state,
      (chain) => {
        chain.initialized = true;
        chain.listed = true;
        chain.rule = installedRule;
      },
      [],
    );
    const layer = chainLayer(fakeClient(state), route);

    // #when the owner turns it back on with the suggested rule
    const rule = await layer.reinstallSleeve({ ...RULE_DEFAULTS });

    // #then the op was onboarding's install op, sent as built, and the rule read back is the one asked for
    expect(route.prepared).toEqual([{ callData: buildUnbracketedOp(ACCOUNT, { kind: 'install', rule: { ...RULE_DEFAULTS } }).callData, callGasLimit: null }]);
    expect(rule).toEqual(installedRule);
    expect((await layer.getAccount(ACCOUNT)).moduleInstalled).toBe(true);
  });

  it('refuses an account the module is installed on', async () => {
    const state = installed();
    const route = landingRoute(state, () => undefined, []);
    const layer = chainLayer(fakeClient(state), route);
    expect((await failure(layer.reinstallSleeve({ ...RULE_DEFAULTS }))).code).toBe('ModuleInstalled');
    expect(route.prepared).toEqual([]);
  });
});

describe('a send over the balance', () => {
  it('is blocked as InsufficientBalance, worded in USDG, never as a Stock Token sale', () => {
    // #given an installed account holding 500 USDG / #when a send of 500.000001 USDG is planned
    const blocked = withdrawSteps(ACCOUNT, { to: PAYEE, amount: 500_000_001n }, 500_000_000n);
    // #then it is the USDG transfer's own refusal, with what the account holds
    expect(blocked).toEqual({ code: 'InsufficientBalance', balance: 500_000_000n, needed: 500_000_001n });
    expect(Array.isArray(blocked) ? null : blockText(blocked)).toBe('That is more than your account holds, 500.00 USDG.');
    expect(withdrawSteps(ACCOUNT, { to: PAYEE, amount: 500_000_000n }, 500_000_000n)).toEqual([
      { kind: 'withdraw', to: PAYEE, amount: 500_000_000n },
    ]);
  });
});

describe('previews on chain', () => {
  const MARKET: MarketSnapshot = {
    asOf: { l2Block: HEAD, timestamp: BLOCK_TIME },
    tickers: [],
    usdgUsd: { feed: ADDRESSES.USDG_USD_FEED, roundId: 1n, answer: 100_000_000n, updatedAt: BLOCK_TIME },
  };

  function preparing(requests: PrepareRequest[]) {
    return async (callData: Hex, callGasLimit: bigint | null): Promise<PreparedOp> => {
      requests.push({ callData, callGasLimit });
      const userOp: UserOperation<'0.7'> = {
        sender: ACCOUNT,
        nonce: 0n,
        callData,
        callGasLimit: callGasLimit ?? 300_000n,
        verificationGasLimit: 700_000n,
        preVerificationGas: 60_000n,
        maxFeePerGas: 2n,
        maxPriorityFeePerGas: 0n,
        signature: '0x',
      };
      return { userOp, sponsored: true, gas: 1_000_000n, maxCostWei: 2_000_000n };
    };
  }

  function simulating(success: boolean, logs: RpcLog[]) {
    return async () => ({ success, revertData: null, gasUsed: 200_000n, logs: logs.map((log) => formatLog(log)) });
  }

  it('previews a removal from its simulation: each waiting bucket to spend, prepared with the fixed call gas', async () => {
    const requests: PrepareRequest[] = [];
    const preview = await previewOnChain({
      action: { kind: 'remove' },
      account: ACCOUNT,
      asOf: MARKET.asOf,
      market: MARKET,
      rule: ACTIVE_RULE,
      unsorted: 0n,
      steps: [{ kind: 'uninstall' }],
      sellPlan: null,
      prepare: preparing(requests),
      gasPrice: async () => 1n,
      simulate: simulating(true, [releasedLog(releasedReceipt(700n, 0, 75_000_000n), 2), uninstallResultLog(true, 3)]),
      client: fakeClient(installed()),
    });
    expect(preview.legs).toEqual([
      { from: { kind: 'waiting', tickerId: 0 }, to: { kind: 'spend' }, sends: { asset: { kind: 'USDG' }, amount: 75_000_000n }, receives: null },
    ]);
    expect(preview.warnings).toEqual([{ code: 'REMOVE_STOPS_SPLITS' }, { code: 'RELEASE_ENDS_WAIT', tickerId: 0 }]);
    expect(preview.blocked).toBeNull();
    expect(requests.map((request) => request.callGasLimit)).toEqual([UNINSTALL_CALL_GAS_LIMIT]);
  });

  it('blocks a removal whose simulated uninstall would not release, and prepares nothing', async () => {
    const requests: PrepareRequest[] = [];
    const preview = await previewOnChain({
      action: { kind: 'remove' },
      account: ACCOUNT,
      asOf: MARKET.asOf,
      market: MARKET,
      rule: ACTIVE_RULE,
      unsorted: 0n,
      steps: [{ kind: 'uninstall' }],
      sellPlan: null,
      prepare: preparing(requests),
      gasPrice: async () => 1n,
      simulate: simulating(true, [uninstallResultLog(false, 3)]),
      client: fakeClient(installed()),
    });
    expect(preview.blocked).toEqual({ code: 'UninstallFailed', result: false });
    expect(requests).toEqual([]);
  });

  it('previews a send without the module from the USDG transfer its simulation emits', async () => {
    const preview = await previewUnbracketed({
      action: { kind: 'withdraw', request: { to: PAYEE, amount: 120_000_000n } },
      account: ACCOUNT,
      asOf: MARKET.asOf,
      balance: 500_000_000n,
      rule: null,
      step: { kind: 'send', to: PAYEE, amount: 120_000_000n },
      prepare: preparing([]),
      gasPrice: async () => 1n,
      simulate: simulating(true, [usdgTransferLog(ACCOUNT, PAYEE, 120_000_000n, 1)]),
      client: fakeClient(removed()),
    });
    expect(preview.legs).toEqual([
      { from: { kind: 'spend' }, to: { kind: 'outside', address: PAYEE }, sends: { asset: { kind: 'USDG' }, amount: 120_000_000n }, receives: null },
    ]);
    expect([preview.warnings, preview.blocked]).toEqual([[], null]);
  });

  it('previews the reinstall as the rule it installs, with the balance staying spendable', async () => {
    const after = suggestedRule(3);
    const preview = await previewUnbracketed({
      action: { kind: 'reinstall', rule: { ...RULE_DEFAULTS } },
      account: ACCOUNT,
      asOf: MARKET.asOf,
      balance: 500_000_000n,
      rule: { before: NO_RULE, after },
      step: { kind: 'install', rule: { ...RULE_DEFAULTS } },
      prepare: preparing([]),
      gasPrice: async () => 1n,
      simulate: simulating(true, []),
      client: fakeClient(removed()),
    });
    expect([preview.legs, preview.rule, preview.blocked]).toEqual([[], { before: NO_RULE, after }, null]);
    expect(preview.warnings).toEqual([{ code: 'SNAPSHOT_KEEPS_BALANCE', amount: 500_000_000n }]);
  });
});
