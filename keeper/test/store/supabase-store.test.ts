import type { PGlite } from '@electric-sql/pglite';
import type { Receipt } from '@sleeve/core';
import { keccak256 } from 'viem';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { LogPosition } from '../../src/chain/events';
import { StoreError } from '../../src/errors';
import type { AccountRecord, KeeperStore, ReceiptRecord } from '../../src/store/store';
import { RECEIPT_COLUMNS } from '../../src/store/rows';
import { createSupabaseStore, ruleName } from '../../src/store/supabase';
import { openDatabase } from '../schema/database';
import {
  ADA,
  BO,
  RECEIPT_COLUMNS as FIXTURE_COLUMNS,
  KEEPER,
  PAYER,
  buyReceipt,
  encodeReceipt,
  lotReceipt,
  queuedReceipt,
  txHashFor,
} from '../schema/fixtures';
import { type FakeRest, postgrestOnPglite } from '../support/postgrest';

/**
 * The production store, supabase-js and all, against the migration on PGlite through a stand-in for the REST API,
 * as the service role. Each test starts from an empty schema.
 */

let db: PGlite;
let rest: FakeRest;
let store: KeeperStore;

const RULE = { version: 1, status: 'ACTIVE' as const, equityBps: 5_000, tickerId: 0, premiumCapBps: 100, slippageBps: 50, minClip: 1_000_000n };

function pos(block: number, index: number): LogPosition {
  return { blockNumber: BigInt(block), logIndex: index, txHash: txHashFor(`${block}:${index}`) };
}

function account(address: `0x${string}`, block: number, overrides: Partial<AccountRecord> = {}): AccountRecord {
  return { address, installedAt: { blockNumber: BigInt(block), logIndex: 0 }, uninstalledAtBlock: null, keeper: KEEPER, rule: RULE, ...overrides };
}

function record(receipt: Receipt, at: LogPosition): ReceiptRecord {
  const data = encodeReceipt(receipt);
  return { receipt, data, hash: keccak256(data), pos: at };
}

async function refusal(work: Promise<unknown>): Promise<StoreError> {
  try {
    await work;
  } catch (error) {
    if (error instanceof StoreError) return error;
    throw error;
  }
  throw new Error('expected a StoreError');
}

async function seedAda(): Promise<void> {
  await store.upsertAccounts([account(ADA, 1_000)]);
  await store.upsertRuleVersions([{ account: ADA, rule: RULE, pos: pos(1_000, 1) }]);
}

beforeAll(async () => {
  db = await openDatabase({ seed: false });
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec(
    'truncate public.payments, public.bucket_waits, public.cards, public.reconciliations, public.lots, public.receipts, public.rule_versions, public.keeper_runs, public.chain_cursor, public.accounts cascade',
  );
  rest = postgrestOnPglite(db);
  store = createSupabaseStore({ url: rest.url, serviceRoleKey: 'test-test-test-test', fetch: rest.fetch });
});

describe('cursors', () => {
  it('writes and reads a cursor per stream', async () => {
    // #given
    await store.writeCursor('sleeve_module', { lastBlock: 79_338_400n, lastBlockHash: txHashFor('h') });
    await store.writeCursor('usdg_transfers', { lastBlock: 79_338_400n, lastBlockHash: null });
    // #when
    const cursors = await store.readCursors();
    // #then
    expect(Object.fromEntries(cursors)).toEqual({
      sleeve_module: { lastBlock: 79_338_400n, lastBlockHash: txHashFor('h') },
      usdg_transfers: { lastBlock: 79_338_400n, lastBlockHash: null },
    });
  });
});

describe('accounts and rule versions', () => {
  it('round trips an account with its rule', async () => {
    // #given
    await store.upsertAccounts([account(ADA, 1_000, { rule: { ...RULE, minClip: 340_282_366_920_938_463_463_374_607_431_768_211_455n } })]);
    // #when
    const accounts = await store.readAccounts();
    // #then
    expect(accounts).toEqual([account(ADA, 1_000, { rule: { ...RULE, minClip: 340_282_366_920_938_463_463_374_607_431_768_211_455n } })]);
  });

  it('replays an upsert as a no-op and moves what changed', async () => {
    // #given
    await store.upsertAccounts([account(ADA, 1_000)]);
    // #when
    await store.upsertAccounts([account(ADA, 1_000), account(ADA, 1_000, { uninstalledAtBlock: 1_500n, keeper: '0x0000000000000000000000000000000000000000' })]);
    // #then
    expect((await store.readAccounts())[0]?.uninstalledAtBlock).toBe(1_500n);
  });

  it('reports a skipped rule version by the rule that refused it', async () => {
    // #given
    await seedAda();
    // #when
    const error = await refusal(store.upsertRuleVersions([{ account: ADA, rule: { ...RULE, version: 3 }, pos: pos(1_010, 0) }]));
    // #then
    expect([error.pgCode, error.rule]).toEqual(['23514', 'rule_versions_in_sequence']);
  });
});

describe('receipts', () => {
  it('writes receipts in id order and keeps the lots in step', async () => {
    // #given
    await seedAda();
    const fill = record(buyReceipt(1n, ADA, { tickerId: 0, tokensOut: 2n ** 70n }), pos(2_000, 4));
    const sale = record(lotReceipt(2n, ADA, { status: 'PART_SOLD', lotId: 1n, tickerId: 0, tokensIn: 2n ** 60n }), pos(2_001, 0));
    // #when
    await store.upsertReceipts([sale, fill]);
    // #then
    const lots = await db.query<{ tokens_remaining: string; status: string }>('select tokens_remaining::text, status::text from public.lots');
    expect(lots.rows).toEqual([{ tokens_remaining: (2n ** 70n - 2n ** 60n).toString(), status: 'PART_SOLD' }]);
  });

  it('replays an indexed receipt as a no-op', async () => {
    // #given
    await seedAda();
    const fill = record(buyReceipt(1n, ADA, { tickerId: 0, tokensOut: 10n ** 17n }), pos(2_000, 4));
    await store.upsertReceipts([fill]);
    // #when
    await store.upsertReceipts([fill]);
    // #then
    expect((await db.query('select 1 from public.receipts')).rows.length).toBe(1);
  });

  it('fails loudly on a different row under an indexed id', async () => {
    // #given
    await seedAda();
    await store.upsertReceipts([record(queuedReceipt(1n, ADA, 10_000_000n), pos(2_000, 4))]);
    // #when
    const error = await refusal(store.upsertReceipts([record(queuedReceipt(1n, ADA, 20_000_000n), pos(2_000, 4))]));
    // #then
    expect(error.rule).toBe('receipts_append_only');
  });

  it('refuses a gap in receipt ids', async () => {
    // #given
    await seedAda();
    // #when
    const error = await refusal(store.upsertReceipts([record(queuedReceipt(2n, ADA, 10_000_000n), pos(2_000, 4))]));
    // #then
    expect(error.rule).toBe('receipts_in_sequence');
  });

  it('refuses typed columns that do not encode to the event data', async () => {
    // #given
    await seedAda();
    const honest = record(queuedReceipt(1n, ADA, 10_000_000n), pos(2_000, 4));
    // #when
    const error = await refusal(store.upsertReceipts([{ ...honest, receipt: { ...honest.receipt, usdgQueued: 2n } }]));
    // #then
    expect(error.rule).toBe('receipts_match_event_data');
  });

  it('writes a reconciliation with its per-bucket cuts', async () => {
    // #given
    await seedAda();
    await store.upsertReceipts([record({ ...queuedReceipt(1n, ADA, 0n), status: 'RECONCILED', reason: 'NONE', usdgIn: 150n, usdgToSpend: 0n, usdgToEquity: 0n, usdgSpent: 100n, usdgQueued: 50n, token: '0x0000000000000000000000000000000000000000' }, pos(2_000, 4))]);
    // #when
    await store.upsertReconciliations([{ receiptId: 1n, balance: 850n, fromSpend: 100n, fromBuckets: [50n, 0n, 0n, 0n], pos: pos(2_000, 5) }]);
    // #then
    const rows = await db.query<{ from_buckets: string[] }>('select from_buckets::text[] from public.reconciliations');
    expect(rows.rows).toEqual([{ from_buckets: ['50', '0', '0', '0'] }]);
  });
});

describe('payments', () => {
  const payment = (block: number, index: number, overrides = {}) => ({
    pos: pos(block, index),
    blockTimestamp: 1_791_000_000n + BigInt(block),
    from: PAYER,
    to: ADA,
    amount: 10_000_000n,
    status: 'RECEIVED' as const,
    graceEndsAt: null,
    sortedBy: null,
    ...overrides,
  });

  it('writes a payment once: a replay never resets its status', async () => {
    // #given
    await seedAda();
    await store.upsertReceipts([record(queuedReceipt(1n, ADA, 10_000_000n), pos(2_000, 4))]);
    await store.insertPayments([payment(1_999, 2, { status: 'SORTED', sortedBy: 1n })]);
    // #when
    await store.insertPayments([payment(1_999, 2)]);
    // #then
    const rows = await db.query<{ status: string }>('select status::text from public.payments');
    expect(rows.rows).toEqual([{ status: 'SORTED' }]);
  });

  it("moves an account's earlier unsorted payments of one install, and only those", async () => {
    // #given
    await store.upsertAccounts([account(ADA, 1_000), account(BO, 1_000)]);
    await store.upsertRuleVersions([{ account: ADA, rule: RULE, pos: pos(1_000, 1) }]);
    await store.insertPayments([
      payment(900, 0),
      payment(1_000, 0),
      payment(1_000, 3),
      payment(1_500, 1),
      payment(2_500, 0),
      { ...payment(1_600, 0), to: BO },
    ]);
    await store.upsertReceipts([record(queuedReceipt(1n, ADA, 20_000_000n), pos(2_000, 9))]);
    // #when
    await store.updateEarlierPayments({ account: ADA, epoch: { blockNumber: 1_000n, logIndex: 1 }, beforeBlock: 2_000n, change: { status: 'SORTED', sortedBy: 1n } });
    // #then
    const rows = await db.query<{ block_number: string; log_index: number; to_address: string; status: string }>(
      'select block_number::text, log_index, to_address::text, status::text from public.payments p order by p.block_number, p.log_index',
    );
    expect(rows.rows.map((row) => `${row.block_number}:${row.log_index}:${row.to_address === ADA ? 'ada' : 'bo'}:${row.status}`)).toEqual([
      '900:0:ada:RECEIVED',
      '1000:0:ada:RECEIVED',
      '1000:3:ada:SORTED',
      '1500:1:ada:SORTED',
      '1600:0:bo:RECEIVED',
      '2500:0:ada:RECEIVED',
    ]);
  });

  it('gives earlier payments the grace of an observation', async () => {
    // #given
    await seedAda();
    await store.insertPayments([payment(1_500, 1)]);
    // #when
    await store.updateEarlierPayments({ account: ADA, epoch: { blockNumber: 1_000n, logIndex: 0 }, beforeBlock: 2_000n, change: { status: 'WAITING_GRACE', graceEndsAt: 1_791_072_000n } });
    // #then
    const rows = await db.query<{ status: string; grace_ends_at: string }>('select status::text, grace_ends_at::text from public.payments');
    expect(rows.rows).toEqual([{ status: 'WAITING_GRACE', grace_ends_at: '1791072000' }]);
  });

  it('finds the oldest unsorted payment of the current install', async () => {
    // #given
    await seedAda();
    await store.insertPayments([payment(900, 0), payment(1_000, 0), payment(1_200, 0), payment(1_300, 0)]);
    // #when
    const oldest = await store.oldestWaitingPayment(ADA, { blockNumber: 1_000n, logIndex: 0 });
    // #then
    expect(oldest).toBe(1_791_001_200n);
  });
});

describe('keeper runs', () => {
  it('starts and finishes a run once', async () => {
    // #given
    const runId = await store.startRun({ action: 'SPLIT', account: ADA, tickerId: 0, startedAt: new Date('2026-10-04T00:00:00Z'), detail: { quote: 7n } });
    // #when
    await store.finishRun(runId, { finishedAt: new Date('2026-10-04T00:00:02Z'), outcome: 'SUCCEEDED', txHash: txHashFor('tx'), error: null, detail: { receiptId: 1n } });
    // #then
    const rows = await db.query<{ outcome: string; detail: unknown }>('select outcome::text, detail from public.keeper_runs');
    expect(rows.rows).toEqual([{ outcome: 'SUCCEEDED', detail: { receiptId: '1' } }]);
  });

  it('refuses a REVERTED run without its transaction', async () => {
    // #given
    const runId = await store.startRun({ action: 'SETTLE', account: null, tickerId: null, startedAt: new Date('2026-10-04T00:00:00Z'), detail: {} });
    // #when
    const error = await refusal(store.finishRun(runId, { finishedAt: new Date('2026-10-04T00:00:01Z'), outcome: 'REVERTED', txHash: null, error: 'reverted', detail: {} }));
    // #then
    expect(error.rule).toBe('keeper_runs_revert_has_tx');
  });
});

describe('bucket waits', () => {
  it('upserts, reads back and deletes a wait', async () => {
    // #given
    await seedAda();
    const wait = { account: ADA, tickerId: 0, reason: 'PREMIUM' as const, bucketSince: 1_791_068_000n, firstSeenAt: 1_791_068_100n, lastSeenAt: 1_791_068_100n };
    await store.upsertBucketWait(wait);
    await store.upsertBucketWait({ ...wait, lastSeenAt: 1_791_068_700n });
    // #when
    const read = await store.readBucketWaits();
    await store.deleteBucketWait(ADA, 0);
    // #then
    expect([read, await store.readBucketWaits()]).toEqual([[{ ...wait, lastSeenAt: 1_791_068_700n }], []]);
  });

  it('refuses a wait with no reason', async () => {
    // #given
    await seedAda();
    // #when
    const error = await refusal(store.upsertBucketWait({ account: ADA, tickerId: 0, reason: 'NONE' as never, bucketSince: 1n, firstSeenAt: 1n, lastSeenAt: 1n }));
    // #then
    expect(error.rule).toBe('bucket_waits_reason_set');
  });
});

describe('accounts seen', () => {
  it('records the block the keeper last read an account at', async () => {
    // #given
    await seedAda();
    // #when
    await store.markAccountsSeen([ADA], 79_400_000n, new Date('2026-10-04T00:00:00Z'));
    // #then
    const rows = await db.query<{ last_seen_block: string }>('select last_seen_block::text from public.accounts');
    expect(rows.rows).toEqual([{ last_seen_block: '79400000' }]);
  });
});

describe('receipt columns', () => {
  it('map every Receipt field the way the schema fixtures do', () => {
    // #when
    const same = JSON.stringify(RECEIPT_COLUMNS) === JSON.stringify(FIXTURE_COLUMNS);
    // #then
    expect(same).toBe(true);
  });
});

describe('ruleName', () => {
  it.each([
    ['new row for relation "payments" violates check constraint "payments_amount_range"', 'payments_amount_range'],
    ['receipts_in_sequence: the index holds receipts up to 4, so the next is 5, not 6', 'receipts_in_sequence'],
    ['permission denied for table lots', null],
  ])('reads the rule out of "%s"', (message, rule) => {
    // #when
    const name = ruleName(message);
    // #then
    expect(name).toBe(rule);
  });
});
