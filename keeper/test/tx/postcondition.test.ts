import type { Receipt } from '@sleeve/core';
import { type Log, type TransactionReceipt, keccak256 } from 'viem';
import { describe, expect, it } from 'vitest';

import type { KeeperCall } from '../../src/chain/calls';
import { PostconditionError } from '../../src/errors';
import { checkReceiptShape, confirmAction } from '../../src/tx/postcondition';
import { FakeChain, fakeAccount } from '../support/fake-chain';
import { receiptLog } from '../support/logs';
import { ADA, KEEPER, blankReceipt, buyReceipt, encodeReceipt, queuedReceipt } from '../schema/fixtures';

const SPLIT: KeeperCall = { fn: 'split', account: ADA, pool: '0xa7bb1ac63bbab0c44316e6c8c455213441689167', quote: 1n };
const SETTLE: KeeperCall = { fn: 'settle', account: ADA, tickerId: 0, pool: '0xa7bb1ac63bbab0c44316e6c8c455213441689167', quote: 1n };

function mined(logs: Log[], status: 'success' | 'reverted' = 'success'): TransactionReceipt {
  return {
    transactionHash: `0x${'a'.repeat(64)}`,
    status,
    blockNumber: 2_000n,
    gasUsed: 500_000n,
    effectiveGasPrice: 20_000_000n,
    logs,
  } as unknown as TransactionReceipt;
}

function chainWith(receipt: Receipt): FakeChain {
  const chain = new FakeChain();
  chain.accounts.set(ADA, fakeAccount(KEEPER));
  chain.receiptHashes.set(receipt.id, keccak256(encodeReceipt(receipt)));
  return chain;
}

const filled: Receipt = { ...buyReceipt(4n, ADA, { tickerId: 0, tokensOut: 6_400_000_000_000_000n, usdgIn: 10_000_000n }), usdgToEquity: 5_000_000n, usdgSpent: 5_000_000n, usdgToSpend: 5_000_000n };

describe('confirmAction', () => {
  it('confirms a split from its receipt, the stored hash, the ledger at the block and the lot', async () => {
    // #given
    const chain = chainWith(filled);
    chain.lots.set(4n, { account: ADA, tickerId: 0, status: 'FILLED', tokensBought: filled.tokensOut, tokensRemaining: filled.tokensOut });
    // #when
    const confirmed = await confirmAction(chain, 'SORT', SPLIT, mined([receiptLog(filled, { block: 2_000, index: 3 })]));
    // #then
    expect([confirmed.receipt.id, confirmed.receipt.status, confirmed.stateAtBlock]).toEqual([4n, 'FILLED', true]);
  });

  it('fails when the module stores a different hash', async () => {
    // #given
    const chain = chainWith(filled);
    chain.receiptHashes.set(4n, `0x${'b'.repeat(64)}`);
    // #when
    const attempt = confirmAction(chain, 'SORT', SPLIT, mined([receiptLog(filled, { block: 2_000, index: 3 })]));
    // #then
    await expect(attempt).rejects.toBeInstanceOf(PostconditionError);
  });

  it('fails when USDG is still unsorted at the block', async () => {
    // #given
    const queued = queuedReceipt(4n, ADA, 10_000_000n);
    const chain = chainWith(queued);
    chain.accounts.set(ADA, fakeAccount(KEEPER, { ledger: { balance: 12_000_000n, spend: 9_000_000n, pendingTotal: 1_000_000n, unsorted: 2_000_000n } }));
    // #when
    const attempt = confirmAction(chain, 'SORT', SPLIT, mined([receiptLog(queued, { block: 2_000, index: 3 })]));
    // #then
    await expect(attempt).rejects.toThrow('2000000 USDG still unsorted after the split');
  });

  it('fails when the transaction holds no receipt for the account', async () => {
    // #given
    const chain = chainWith(filled);
    // #when
    const attempt = confirmAction(chain, 'SORT', SPLIT, mined([]));
    // #then
    await expect(attempt).rejects.toThrow('expected one receipt');
  });

  it('confirms a settle when the bucket is empty at the block', async () => {
    // #given
    const settled: Receipt = { ...buyReceipt(5n, ADA, { tickerId: 0, tokensOut: 6_000_000_000_000_000n, status: 'SETTLED' }) };
    const chain = chainWith(settled);
    chain.lots.set(5n, { account: ADA, tickerId: 0, status: 'SETTLED', tokensBought: settled.tokensOut, tokensRemaining: settled.tokensOut });
    // #when
    const confirmed = await confirmAction(chain, 'SETTLE', SETTLE, mined([receiptLog(settled, { block: 2_000, index: 1 })]));
    // #then
    expect(confirmed.receipt.status).toBe('SETTLED');
  });

  it('fails a settle that left the bucket full', async () => {
    // #given
    const settled: Receipt = { ...buyReceipt(5n, ADA, { tickerId: 0, tokensOut: 6_000_000_000_000_000n, status: 'SETTLED' }) };
    const chain = chainWith(settled);
    chain.accounts.set(ADA, fakeAccount(KEEPER, { buckets: new Map([[0, { amount: 5_000_000n, since: 1n, reason: 'SESSION' }]]) }));
    // #when
    const attempt = confirmAction(chain, 'SETTLE', SETTLE, mined([receiptLog(settled, { block: 2_000, index: 1 })]));
    // #then
    await expect(attempt).rejects.toThrow('still holds 5000000 after settle');
  });

  it('refuses a reverted transaction', async () => {
    // #given
    const chain = chainWith(filled);
    // #when
    const attempt = confirmAction(chain, 'SORT', SPLIT, mined([], 'reverted'));
    // #then
    await expect(attempt).rejects.toThrow('reverted');
  });
});

describe('checkReceiptShape', () => {
  it('refuses a split receipt that breaks I2', () => {
    // #given
    const broken: Receipt = { ...queuedReceipt(4n, ADA, 10_000_000n), usdgQueued: 2n };
    // #when
    const check = () => checkReceiptShape('SORT', SPLIT, broken);
    // #then
    expect(check).toThrow('breaks I2');
  });

  it('refuses a receipt another trigger wrote', () => {
    // #given
    const owner: Receipt = { ...queuedReceipt(4n, ADA, 10_000_000n), trigger: 'OWNER' };
    // #when
    const check = () => checkReceiptShape('SORT', SPLIT, owner);
    // #then
    expect(check).toThrow('trigger OWNER');
  });

  it('accepts a reconcile whose shortfall equals its cuts', () => {
    // #given
    const reconciled: Receipt = { ...blankReceipt(6n, ADA), status: 'RECONCILED', usdgIn: 150n, usdgSpent: 100n, usdgQueued: 50n };
    // #when
    const check = () => checkReceiptShape('RECONCILE', SPLIT, reconciled);
    // #then
    expect(check).not.toThrow();
  });
});
