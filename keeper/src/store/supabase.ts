import { type Address, type Hex, REASONS, RULE_STATUSES, type Reason, type Rule, enumMember } from '@sleeve/core';
import { type PostgrestError, createClient } from '@supabase/supabase-js';

import { lower } from '../chain/events';
import { StoreError } from '../errors';
import { KEEPER_VERSION } from '../version';
import {
  type Row,
  accountRow,
  bucketWaitRow,
  paymentRow,
  receiptRow,
  reconciliationRow,
  ruleVersionRow,
  runFinishRow,
  runStartRow,
} from './rows';
import {
  type AccountRecord,
  type BucketWaitRecord,
  type Cursor,
  type EarlierPaymentsUpdate,
  type InstallPosition,
  type KeeperStore,
  STREAMS,
  type StreamName,
} from './store';

export interface SupabaseStoreOptions {
  url: string;
  serviceRoleKey: string;
  /** Replaces the global fetch, for tests that put the API in front of PGlite. */
  fetch?: typeof fetch;
  /** Rows per write request. */
  batchSize?: number;
  /** Rows per read page. Supabase caps a response at 1,000 rows by default. */
  pageSize?: number;
}

const WAITING: ['RECEIVED', 'WAITING_GRACE'] = ['RECEIVED', 'WAITING_GRACE'];

/** The named rule a refusal carries: quoted as a constraint, or leading the message of a trigger's exception. */
export function ruleName(message: string): string | null {
  const quoted = /constraint "([a-z0-9_]+)"/.exec(message);
  if (quoted?.[1] !== undefined) return quoted[1];
  const leading = /^([a-z][a-z0-9_]*): /.exec(message);
  return leading?.[1] ?? null;
}

function fail(operation: string, error: PostgrestError): never {
  throw new StoreError(operation, error.code === '' ? null : error.code, error.message, ruleName(error.message));
}

function chunks<T>(rows: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < rows.length; start += size) out.push(rows.slice(start, start + size));
  return out;
}

function text(value: unknown, column: string): string {
  if (typeof value !== 'string') throw new StoreError('read', null, `${column} came back as ${typeof value}, not text`);
  return value;
}

function parseRule(value: unknown): Rule {
  const rule = value as Record<string, unknown>;
  return {
    version: Number(rule.version),
    status: enumMember(RULE_STATUSES, RULE_STATUSES.indexOf(rule.status as (typeof RULE_STATUSES)[number])),
    equityBps: Number(rule.equityBps),
    tickerId: Number(rule.tickerId),
    premiumCapBps: Number(rule.premiumCapBps),
    slippageBps: Number(rule.slippageBps),
    minClip: BigInt(text(rule.minClip, 'rule.minClip')),
  };
}

export function createSupabaseStore(options: SupabaseStoreOptions): KeeperStore {
  const db = createClient(options.url, options.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      headers: { 'x-client-info': `sleeve-keeper/${KEEPER_VERSION}` },
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    },
    db: { schema: 'public' },
  });
  const batchSize = options.batchSize ?? 200;
  const pageSize = options.pageSize ?? 1_000;

  async function upsert(
    operation: string,
    table: string,
    rows: readonly Row[],
    onConflict: string,
    ignoreDuplicates = false,
  ): Promise<void> {
    // One statement cannot touch a row twice, so a key repeated in the batch keeps its last row.
    const keys = onConflict.split(',');
    const unique = new Map<string, Row>();
    for (const row of rows) unique.set(JSON.stringify(keys.map((key) => row[key] ?? null)), row);
    for (const batch of chunks([...unique.values()], batchSize)) {
      const { error } = await db.from(table).upsert(batch, { onConflict, ignoreDuplicates });
      if (error !== null) fail(operation, error);
    }
  }

  /** Every row of a select, page by page. */
  async function readAll(
    operation: string,
    page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: PostgrestError | null }>,
  ): Promise<Record<string, unknown>[]> {
    const rows: Record<string, unknown>[] = [];
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await page(from, from + pageSize - 1);
      if (error !== null) fail(operation, error);
      const received = (data ?? []) as Record<string, unknown>[];
      rows.push(...received);
      if (received.length < pageSize) return rows;
    }
  }

  async function updateWaiting(update: EarlierPaymentsUpdate, sameBlock: boolean): Promise<void> {
    const change: Row =
      update.change.status === 'SORTED'
        ? { status: 'SORTED', sorted_by_receipt_id: update.change.sortedBy.toString(), grace_ends_at: null }
        : { status: 'WAITING_GRACE', grace_ends_at: update.change.graceEndsAt.toString() };
    let query = db
      .from('payments')
      .update(change)
      .eq('to_address', lower(update.account))
      .in('status', WAITING)
      .lt('block_number', update.beforeBlock.toString());
    query = sameBlock
      ? query.eq('block_number', update.epoch.blockNumber.toString()).gt('log_index', update.epoch.logIndex)
      : query.gt('block_number', update.epoch.blockNumber.toString());
    const { error } = await query;
    if (error !== null) fail('updateEarlierPayments', error);
  }

  return {
    async readCursors() {
      const { data, error } = await db.from('chain_cursor').select('stream, last_block::text, last_block_hash');
      if (error !== null) fail('readCursors', error);
      const cursors = new Map<StreamName, Cursor>();
      for (const row of data as Record<string, unknown>[]) {
        const stream = row.stream as StreamName;
        if (!STREAMS.includes(stream)) continue;
        cursors.set(stream, {
          lastBlock: BigInt(text(row.last_block, 'last_block')),
          lastBlockHash: (row.last_block_hash as Hex | null) ?? null,
        });
      }
      return cursors;
    },

    async writeCursor(stream, cursor) {
      await upsert(
        'writeCursor',
        'chain_cursor',
        [
          {
            stream,
            last_block: cursor.lastBlock.toString(),
            last_block_hash: cursor.lastBlockHash === null ? null : lower(cursor.lastBlockHash),
          },
        ],
        'stream',
      );
    },

    async readAccounts() {
      const rows = await readAll('readAccounts', (from, to) =>
        db
          .from('accounts')
          .select('address, installed_at_block::text, installed_at_log_index, uninstalled_at_block::text, keeper, rule')
          .order('address')
          .range(from, to),
      );
      return rows.map((row) => ({
        address: lower(text(row.address, 'address') as Address),
        installedAt: {
          blockNumber: BigInt(text(row.installed_at_block, 'installed_at_block')),
          logIndex: Number(row.installed_at_log_index),
        },
        uninstalledAtBlock:
          row.uninstalled_at_block === null ? null : BigInt(text(row.uninstalled_at_block, 'uninstalled_at_block')),
        keeper: lower(text(row.keeper, 'keeper') as Address),
        rule: parseRule(row.rule),
      }));
    },

    upsertAccounts: (accounts) => upsert('upsertAccounts', 'accounts', accounts.map(accountRow), 'address'),

    upsertRuleVersions: (rows) =>
      upsert('upsertRuleVersions', 'rule_versions', rows.map(ruleVersionRow), 'account,version'),

    async upsertReceipts(rows) {
      const ordered = [...rows].sort((a, b) => Number(a.receipt.id - b.receipt.id));
      await upsert('upsertReceipts', 'receipts', ordered.map(receiptRow), 'receipt_id');
    },

    upsertReconciliations: (rows) =>
      upsert('upsertReconciliations', 'reconciliations', rows.map(reconciliationRow), 'receipt_id'),

    insertPayments: (rows) =>
      upsert('insertPayments', 'payments', rows.map(paymentRow), 'chain_id,tx_hash,log_index', true),

    async updateEarlierPayments(update) {
      await updateWaiting(update, false);
      await updateWaiting(update, true);
    },

    async oldestWaitingPayment(account: Address, epoch: InstallPosition) {
      const { data, error } = await db
        .from('payments')
        .select('block_number::text, log_index, block_timestamp::text')
        .eq('to_address', lower(account))
        .in('status', WAITING)
        .gte('block_number', epoch.blockNumber.toString())
        .order('block_number', { ascending: true })
        .order('log_index', { ascending: true })
        .limit(50);
      if (error !== null) fail('oldestWaitingPayment', error);
      for (const row of data as Record<string, unknown>[]) {
        const block = BigInt(text(row.block_number, 'block_number'));
        if (block === epoch.blockNumber && Number(row.log_index) <= epoch.logIndex) continue;
        return BigInt(text(row.block_timestamp, 'block_timestamp'));
      }
      return null;
    },

    async markAccountsSeen(accounts, block, at) {
      for (const batch of chunks(accounts.map(lower), batchSize)) {
        const { error } = await db
          .from('accounts')
          .update({ last_seen_block: block.toString(), last_seen_at: at.toISOString() })
          .in('address', batch);
        if (error !== null) fail('markAccountsSeen', error);
      }
    },

    async startRun(run) {
      const { data, error } = await db.from('keeper_runs').insert(runStartRow(run)).select('run_id').single();
      if (error !== null) fail('startRun', error);
      const runId = Number((data as { run_id: unknown }).run_id);
      if (!Number.isSafeInteger(runId)) throw new StoreError('startRun', null, 'run_id came back missing');
      return runId;
    },

    async finishRun(runId, finish) {
      const { error } = await db.from('keeper_runs').update(runFinishRow(finish)).eq('run_id', runId);
      if (error !== null) fail('finishRun', error);
    },

    async readBucketWaits() {
      const rows = await readAll('readBucketWaits', (from, to) =>
        db
          .from('bucket_waits')
          .select('account, ticker_id, reason, bucket_since::text, first_seen_at::text, last_seen_at::text')
          .order('account')
          .order('ticker_id')
          .range(from, to),
      );
      return rows.map(
        (row): BucketWaitRecord => ({
          account: lower(text(row.account, 'account') as Address),
          tickerId: Number(row.ticker_id),
          reason: enumMember(REASONS, REASONS.indexOf(row.reason as Reason)) as BucketWaitRecord['reason'],
          bucketSince: BigInt(text(row.bucket_since, 'bucket_since')),
          firstSeenAt: BigInt(text(row.first_seen_at, 'first_seen_at')),
          lastSeenAt: BigInt(text(row.last_seen_at, 'last_seen_at')),
        }),
      );
    },

    upsertBucketWait: (row) => upsert('upsertBucketWait', 'bucket_waits', [bucketWaitRow(row)], 'account,ticker_id'),

    async deleteBucketWait(account, tickerId) {
      const { error } = await db.from('bucket_waits').delete().eq('account', lower(account)).eq('ticker_id', tickerId);
      if (error !== null) fail('deleteBucketWait', error);
    },
  };
}
