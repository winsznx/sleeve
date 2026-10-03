import type { Receipt } from '@sleeve/core';
import { keccak256 } from 'viem';
import { describe, expect, it } from 'vitest';

import { encodeReceipt } from './decode';
import { MAX_INDEX_LAG_BLOCKS, recordFromIndex, routeIndexSource } from './index-source';

const ACCOUNT = '0x00000000000000000000000000000000000000AA';

const RECONCILED: Receipt = {
  id: 12n,
  account: ACCOUNT,
  ruleVersion: 1,
  trigger: 'OWNER',
  payer: '0x0000000000000000000000000000000000000000',
  status: 'RECONCILED',
  reason: 'NONE',
  mode: 'WRAPPED',
  tickerId: 0,
  token: '0x0000000000000000000000000000000000000000',
  tokenUid: `0x${'00'.repeat(32)}`,
  usdgIn: 5_000_000n,
  usdgToSpend: 0n,
  usdgToEquity: 0n,
  usdgSpent: 3_000_000n,
  usdgQueued: 2_000_000n,
  tokensIn: 0n,
  tokensOut: 0n,
  usdgOut: 0n,
  uiMultiplier: 0n,
  execPrice: 0n,
  premiumBps: 0n,
  roundId: 0n,
  answer: 0n,
  updatedAt: 0n,
  usdgRoundId: 0n,
  usdgAnswer: 0n,
  quote: 0n,
  minOut: 0n,
  venueId: 0,
  pool: '0x0000000000000000000000000000000000000000',
  calendarVersion: 1,
  disclosureHash: '0x8408c7a59df30d1b5dbec102c388048f2bf8bba21a2e91ac0806df7d68068e89',
  l2Block: 79_500_000n,
  timestamp: 1_790_000_000n,
  lotId: 0n,
  queuedSince: 0n,
  overrideClosed: false,
  overrideCapBps: 0,
};

function indexed(receipt: Receipt, hash?: `0x${string}`) {
  const eventData = encodeReceipt(receipt);
  return {
    eventData,
    receiptHash: hash ?? keccak256(eventData),
    txHash: `0x${'ab'.repeat(32)}` as const,
    blockNumber: '79500000',
    logIndex: 4,
    rule: { version: 1, equityBps: 1_000, tickerId: 0, premiumCapBps: 100, slippageBps: 50, minClip: '25000000' },
    reconciliation: { fromSpend: '3000000', fromBuckets: ['2000000', '0'] },
    inbound: [],
  };
}

function fetcher(body: unknown, status = 200): typeof fetch {
  return async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('the keeper index as the data layer reads it', () => {
  it('decodes a receipt from its event data, with its rule and its reconcile', () => {
    const record = recordFromIndex(indexed(RECONCILED));
    expect(record.receipt).toEqual(RECONCILED);
    expect(record.derived.rule).toEqual({ version: 1, status: 'ACTIVE', equityBps: 1_000, tickerId: 0, premiumCapBps: 100, slippageBps: 50, minClip: 25_000_000n });
    expect(record.reconciliation).toEqual({ shortfall: 5_000_000n, fromSpend: 3_000_000n, fromBuckets: [{ tickerId: 0, amount: 2_000_000n }] });
  });

  it('refuses event data that does not hash to the stored receipt hash', () => {
    expect(() => recordFromIndex(indexed(RECONCILED, `0x${'00'.repeat(32)}`))).toThrow(/does not hash/);
  });

  it('pages receipts from the index while it is close to the chain head', async () => {
    const source = routeIndexSource(fetcher({ indexedTo: '1000', items: [indexed(RECONCILED)], more: true }));
    const page = await source.receipts({ account: ACCOUNT, before: null, limit: 1 }, 1_000n + MAX_INDEX_LAG_BLOCKS);
    expect([page?.items.length, page?.nextCursor]).toEqual([1, '12']);
  });

  it('sends the read to the chain when the index is behind, unconfigured or failing', async () => {
    const behind = routeIndexSource(fetcher({ indexedTo: '1000', items: [], more: false }));
    expect(await behind.receipts({ account: ACCOUNT, before: null, limit: 5 }, 1_001n + MAX_INDEX_LAG_BLOCKS)).toBeNull();
    expect(await routeIndexSource(fetcher({ error: 'no key' }, 501)).inbox(ACCOUNT, 10n)).toBeNull();
    const broken: typeof fetch = async () => {
      throw new TypeError('fetch failed');
    };
    expect(await routeIndexSource(broken).receipt(12n, 10n)).toBeUndefined();
  });

  it('lets only the chain say a receipt does not exist', async () => {
    expect(await routeIndexSource(fetcher({ indexedTo: '10', receipt: null })).receipt(99n, 10n)).toBeUndefined();
  });
});
