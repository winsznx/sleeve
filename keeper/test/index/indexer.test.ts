import type { PGlite } from '@electric-sql/pglite';
import type { Receipt, Rule } from '@sleeve/core';
import { type Log, keccak256 } from 'viem';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { IndexIntegrityError, ReorgBelowCursorError } from '../../src/errors';
import { Indexer } from '../../src/index/indexer';
import { silentLogger } from '../../src/log';
import { RunRecorder } from '../../src/runs';
import type { KeeperStore } from '../../src/store/store';
import { createSupabaseStore } from '../../src/store/supabase';
import { openDatabase } from '../schema/database';
import { ADA, KEEPER, PAYER, encodeReceipt, queuedReceipt } from '../schema/fixtures';
import { FakeChain } from '../support/fake-chain';
import { moduleLog, receiptLog, ruleTuple, transferLog, txHash, userOperationLog } from '../support/logs';
import { postgrestOnPglite } from '../support/postgrest';

const START = 1_000n;
const RULE: Rule = { version: 1, status: 'ACTIVE', equityBps: 5_000, tickerId: 0, premiumCapBps: 100, slippageBps: 50, minClip: 1_000_000n };

let db: PGlite;
let store: KeeperStore;
let chain: FakeChain;

function indexer(options: Partial<ConstructorParameters<typeof Indexer>[4]> = {}): Indexer {
  const runs = new RunRecorder({ store, log: silentLogger, redact: (text) => text });
  return new Indexer(chain, store, runs, silentLogger, {
    confirmations: 5,
    maxChunkBlocks: 100,
    startBlock: START,
    cursorWriteIntervalMs: 0,
    ...options,
  });
}

function head(number: bigint): void {
  chain.head_ = { number, hash: `0x${number.toString(16).padStart(64, '0')}`, timestamp: 1_791_000_000n + number, baseFeePerGas: 20_000_000n };
}

function withReceipt(receipt: Receipt, block: number, index: number, tx?: string): Log {
  chain.receiptHashes.set(receipt.id, keccak256(encodeReceipt(receipt)));
  return receiptLog(receipt, { block, index, ...(tx === undefined ? {} : { tx: txHash(tx) }) });
}

async function rows<T>(sql: string): Promise<T[]> {
  return (await db.query<T>(sql)).rows;
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
  const rest = postgrestOnPglite(db);
  store = createSupabaseStore({ url: rest.url, serviceRoleKey: 'test-test-test-test', fetch: rest.fetch });
  chain = new FakeChain();
  chain.logs = [
    moduleLog('Installed', { account: ADA, keeper: KEEPER, spend: 0n }, { block: 1_010, index: 1, tx: txHash('install') }),
    moduleLog('RuleSet', { account: ADA, version: 1, rule: ruleTuple(RULE) }, { block: 1_020, index: 0 }),
    transferLog(PAYER, ADA, 10_000_000n, { block: 1_150, index: 2, tx: txHash('pay') }),
    withReceipt({ ...queuedReceipt(1n, ADA, 10_000_000n), ruleVersion: 1 }, 1_160, 4, 'split'),
  ];
  head(1_305n);
});

describe('Indexer', () => {
  it('indexes from the deploy block to the confirmed head in ranges, with payments sorted by their split', async () => {
    // #given
    const index = indexer();
    await index.load();
    // #when
    const result = await index.catchUp(chain.head_);
    // #then
    const payments = await rows<{ status: string; sorted_by_receipt_id: string }>('select status::text, sorted_by_receipt_id::text from public.payments');
    const cursors = await rows<{ stream: string; last_block: string }>('select stream, last_block::text from public.chain_cursor order by stream');
    expect({ result, payments, cursors }).toEqual({
      result: { indexedTo: 1_300n, ranges: 4, caughtUp: true },
      payments: [{ status: 'SORTED', sorted_by_receipt_id: '1' }],
      cursors: [
        { stream: 'sleeve_module', last_block: '1300' },
        { stream: 'usdg_transfers', last_block: '1300' },
      ],
    });
  });

  it('keeps the blocks inside the confirmation window for a later pass', async () => {
    // #given
    const index = indexer();
    await index.load();
    chain.logs.push(transferLog(PAYER, ADA, 2_000_000n, { block: 1_303, index: 0 }));
    // #when
    await index.catchUp(chain.head_);
    // #then
    expect(await rows('select 1 from public.payments where block_number = 1303')).toEqual([]);
  });

  it('rides out a reorg inside the confirmation window: the replaced log is never indexed, its replacement is', async () => {
    // #given a payment two blocks under the head, inside the window
    const index = indexer();
    await index.load();
    const reorged = transferLog(PAYER, ADA, 2_000_000n, { block: 1_303, index: 0, tx: txHash('reorged') });
    chain.logs.push(reorged);
    await index.catchUp(chain.head_);
    // #given the block is replaced: the payment moves to a later block with another transaction
    chain.logs = chain.logs.filter((log) => log !== reorged);
    chain.logs.push(transferLog(PAYER, ADA, 2_000_000n, { block: 1_304, index: 1, tx: txHash('replacement') }));
    head(1_320n);
    // #when
    await index.catchUp(chain.head_);
    // #then
    expect(await rows<{ block_number: string }>('select block_number::text from public.payments where amount = 2000000')).toEqual([
      { block_number: '1304' },
    ]);
  });

  it('resumes after the stored cursor and remembers the accounts it indexed', async () => {
    // #given
    const first = indexer();
    await first.load();
    await first.catchUp(chain.head_);
    chain.logs.push(transferLog(PAYER, ADA, 3_000_000n, { block: 1_350, index: 0 }));
    head(1_400n);
    const second = indexer();
    await second.load();
    chain.calls = [];
    // #when
    await second.catchUp(chain.head_);
    // #then
    expect([chain.calls.filter((call) => call.startsWith('moduleLogs')), await rows<{ amount: string }>('select amount::text from public.payments where block_number = 1350')]).toEqual([
      ['moduleLogs:1301-1395'],
      [{ amount: '3000000' }],
    ]);
  });

  it('stops with ReorgBelowCursor when the cursor block changed, and writes nothing more', async () => {
    // #given
    const first = indexer();
    await first.load();
    await first.catchUp(chain.head_);
    chain.blockHashes.set(1_300n, `0x${'e'.repeat(64)}`);
    head(1_400n);
    const second = indexer();
    await second.load();
    // #when
    const attempt = second.catchUp(chain.head_);
    // #then
    await expect(attempt).rejects.toBeInstanceOf(ReorgBelowCursorError);
    expect((await rows<{ last_block: string }>('select last_block::text from public.chain_cursor'))[0]?.last_block).toBe('1300');
  });

  it('narrows the range when the provider refuses it, then widens again', async () => {
    // #given
    const index = indexer({ maxChunkBlocks: 400 });
    await index.load();
    let refusals = 0;
    const moduleLogs = chain.moduleLogs.bind(chain);
    chain.moduleLogs = async (from, to) => {
      if (to - from + 1n > 150n) {
        refusals += 1;
        throw new Error('query exceeds max block range');
      }
      return moduleLogs(from, to);
    };
    // #when
    const result = await index.catchUp(chain.head_);
    // #then
    expect([result.caughtUp, refusals > 0, (await rows('select 1 from public.receipts')).length]).toEqual([true, true, 1]);
  });

  it('learns the widest range the provider takes and stops asking for more', async () => {
    // #given a provider that refuses more than 101 blocks, as dRPC's free tier does on this chain
    head(5_105n);
    const index = indexer({ maxChunkBlocks: 10_000 });
    await index.load();
    const spans: bigint[] = [];
    const moduleLogs = chain.moduleLogs.bind(chain);
    chain.moduleLogs = async (from, to) => {
      spans.push(to - from + 1n);
      if (to - from + 1n > 101n) throw new Error('ranges over 10000 blocks are not supported on free plan');
      return moduleLogs(from, to);
    };
    // #when
    await index.catchUp(chain.head_);
    // #then the refusals happen while narrowing, then every range is 100 blocks
    const firstGood = spans.findIndex((span) => span <= 101n);
    expect([spans.slice(firstGood).every((span) => span <= 100n), index.cursorBlock]).toEqual([true, 1_000n + 20n * 100n - 1n]);
  });

  it('refuses a receipt whose stored hash differs from its event data, and keeps the cursor before it', async () => {
    // #given
    chain.receiptHashes.set(1n, `0x${'b'.repeat(64)}`);
    const index = indexer();
    await index.load();
    // #when
    const attempt = index.catchUp(chain.head_);
    // #then
    await expect(attempt).rejects.toBeInstanceOf(IndexIntegrityError);
    expect(index.cursorBlock).toBe(1_099n);
  });

  it('records an INDEX run for each range it wrote', async () => {
    // #given
    const index = indexer();
    await index.load();
    // #when
    await index.catchUp(chain.head_);
    // #then
    const runs = await rows<{ action: string; outcome: string; tx_hash: string | null }>('select action::text, outcome::text, tx_hash from public.keeper_runs order by run_id');
    expect(runs).toEqual([
      { action: 'INDEX', outcome: 'SUCCEEDED', tx_hash: null },
      { action: 'INDEX', outcome: 'SUCCEEDED', tx_hash: null },
    ]);
  });

  it('reads the UserOps of a bundle to keep a payer transfer next to an owner op', async () => {
    // #given
    const bundle = txHash('bundle');
    chain.logs.push(
      transferLog(PAYER, ADA, 4_000_000n, { block: 1_200, index: 3, tx: bundle }),
      moduleLog('OwnerOpEnded', { account: ADA, balanceAtBegin: 0n, moduleDelta: 0n, ownerDelta: 0n, fromSpend: 0n, fromUnsorted: 0n, fromBuckets: [] }, { block: 1_200, index: 8, tx: bundle }),
    );
    chain.txLogs.set(bundle, [userOperationLog(PAYER, { block: 1_200, index: 4, tx: bundle }), userOperationLog(ADA, { block: 1_200, index: 9, tx: bundle })]);
    const index = indexer();
    await index.load();
    // #when
    await index.catchUp(chain.head_);
    // #then
    expect(await rows<{ amount: string }>('select amount::text from public.payments where block_number = 1200')).toEqual([{ amount: '4000000' }]);
  });

  it('replays a range idempotently after a restart that lost the cursor', async () => {
    // #given
    const first = indexer();
    await first.load();
    await first.catchUp(chain.head_);
    await db.exec('truncate public.chain_cursor');
    const second = indexer();
    await second.load();
    // #when
    await second.catchUp(chain.head_);
    // #then
    expect([
      (await rows('select 1 from public.receipts')).length,
      (await rows('select 1 from public.payments')).length,
      (await rows<{ status: string }>('select status::text from public.payments'))[0]?.status,
    ]).toEqual([1, 1, 'SORTED']);
  });
});
