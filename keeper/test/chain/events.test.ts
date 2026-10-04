import type { Rule } from '@sleeve/core';
import { describe, expect, it } from 'vitest';

import { decodeModuleLog, decodeTransferLog, userOperationBoundaries } from '../../src/chain/events';
import { moduleLog, receiptLog, ruleTuple, transferLog, txHash, userOperationLog } from '../support/logs';
import { ADA, KEEPER, PAYER, buyReceipt } from '../schema/fixtures';

const RULE: Rule = { version: 1, status: 'ACTIVE', equityBps: 5_000, tickerId: 0, premiumCapBps: 100, slippageBps: 50, minClip: 1_000_000n };

describe('decodeModuleLog', () => {
  it('decodes Installed with lowercase addresses and the log position', () => {
    // #when
    const event = decodeModuleLog(moduleLog('Installed', { account: ADA, keeper: KEEPER, spend: 3n }, { block: 79_400_000, index: 4, tx: txHash('install') }));
    // #then
    expect(event).toEqual({
      kind: 'Installed',
      pos: { blockNumber: 79_400_000n, logIndex: 4, txHash: txHash('install') },
      account: ADA,
      keeper: KEEPER,
      spend: 3n,
    });
  });

  it('decodes RuleSet with the rule status by name', () => {
    // #when
    const event = decodeModuleLog(moduleLog('RuleSet', { account: ADA, version: 1, rule: ruleTuple(RULE) }, { block: 1, index: 0 }));
    // #then
    expect(event).toMatchObject({ kind: 'RuleSet', account: ADA, version: 1, rule: RULE });
  });

  it('decodes a receipt with its enums named and keeps the raw data', () => {
    // #given
    const receipt = buyReceipt(1n, ADA, { tickerId: 0, tokensOut: 10n ** 17n });
    const log = receiptLog(receipt, { block: 2, index: 1 });
    // #when
    const event = decodeModuleLog(log);
    // #then
    expect(event).toEqual({ kind: 'ReceiptWritten', pos: expect.any(Object), receipt, data: log.data });
  });

  it.each([
    ['Uninstalled', { account: ADA, released: 5n }],
    ['RulePaused', { account: ADA, version: 2 }],
    ['RuleResumed', { account: ADA, version: 2 }],
    ['KeeperSet', { account: ADA, keeper: KEEPER }],
    ['Observed', { account: ADA, observedAt: 1_791_068_000n, observedUnsorted: 10_000_000n }],
    ['Reconciled', { account: ADA, receiptId: 9n, balance: 1n, fromSpend: 2n, fromBuckets: [0n, 3n] }],
    ['OwnerOpEnded', { account: ADA, balanceAtBegin: 1n, moduleDelta: 0n, ownerDelta: -4n, fromSpend: 4n, fromUnsorted: 0n, fromBuckets: [] }],
    ['LotsReconciled', { account: ADA, tickerId: 1, balance: 1n, trimmed: 2n }],
  ] as const)('decodes %s', (name, args) => {
    // #when
    const event = decodeModuleLog(moduleLog(name, args, { block: 3, index: 2 }));
    // #then
    expect(event?.kind).toBe(name);
  });

  it('answers null for a topic the module ABI does not hold', () => {
    // #given
    const log = { ...transferLog(PAYER, ADA, 1n, { block: 1, index: 0 }) };
    // #when
    const event = decodeModuleLog(log);
    // #then
    expect(event).toBeNull();
  });
});

describe('decodeTransferLog', () => {
  it('decodes a USDG transfer', () => {
    // #when
    const transfer = decodeTransferLog(transferLog(PAYER, ADA, 10_000_000n, { block: 5, index: 9, tx: txHash('pay') }));
    // #then
    expect(transfer).toEqual({ pos: { blockNumber: 5n, logIndex: 9, txHash: txHash('pay') }, from: PAYER, to: ADA, amount: 10_000_000n });
  });
});

describe('userOperationBoundaries', () => {
  it('lists the EntryPoint UserOperationEvent indexes in a transaction, in order', () => {
    // #given
    const logs = [
      userOperationLog(ADA, { block: 1, index: 9 }),
      transferLog(PAYER, ADA, 1n, { block: 1, index: 2 }),
      userOperationLog(PAYER, { block: 1, index: 3 }),
    ];
    // #when
    const boundaries = userOperationBoundaries(logs);
    // #then
    expect(boundaries).toEqual([3, 9]);
  });
});
