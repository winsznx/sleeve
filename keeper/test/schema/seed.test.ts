import type { PGlite } from '@electric-sql/pglite';
import {
  ACCOUNTING_MODES,
  type Hex,
  REASONS,
  STATUSES,
  TRIGGERS,
  discountBps,
  enumMember,
  exceedsPremium,
  execPriceBuy,
  execPriceSell,
  minOutForBuy,
  minOutForSell,
  premiumBps,
} from '@sleeve/core';
import { keccak256 } from 'viem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Session, openDatabase } from './database';
import { RECEIPT_COLUMNS, RECEIPT_FIELD_NAMES, decodeReceiptData } from './fixtures';

/**
 * supabase/seed.sql, the local development data, loads on top of the migration and holds together: every receipt's
 * hash is keccak256 of its event data, which decodes back to its columns, its prices follow packages/core's math,
 * and the lots are the ones its receipts make.
 */

let db: PGlite;

beforeAll(async () => {
  db = await openDatabase({ seed: true });
});

afterAll(async () => {
  await db?.close();
});

type ReceiptText = Record<string, string> & { receipt_hash: string; event_data: string };

async function receipts(): Promise<ReceiptText[]> {
  const columns = [...Object.values(RECEIPT_COLUMNS), 'receipt_hash', 'event_data'];
  let rows: ReceiptText[] = [];
  await Session.rolledBack(db, 'anon', async (session) => {
    rows = await session.rows<ReceiptText>(
      `select ${columns.map((column) => `${column}::text as ${column}`).join(', ')} from public.receipts order by receipt_id`,
    );
  });
  return rows;
}

function big(row: ReceiptText, column: string): bigint {
  const value = row[column];
  if (value === undefined) throw new Error(`receipt has no ${column}`);
  return BigInt(value);
}

describe('seed.sql', () => {
  it('fills every table', async () => {
    await Session.rolledBack(db, 'postgres', async (session) => {
      // #when
      const rows = await session.rows<{ table_name: string; count: number }>(
        `select 'accounts' as table_name, count(*)::int as count from public.accounts
         union all select 'rule_versions', count(*)::int from public.rule_versions
         union all select 'receipts', count(*)::int from public.receipts
         union all select 'reconciliations', count(*)::int from public.reconciliations
         union all select 'lots', count(*)::int from public.lots
         union all select 'payments', count(*)::int from public.payments
         union all select 'keeper_runs', count(*)::int from public.keeper_runs
         union all select 'bucket_waits', count(*)::int from public.bucket_waits
         union all select 'chain_cursor', count(*)::int from public.chain_cursor
         union all select 'passkey_credentials', count(*)::int from public.passkey_credentials
         union all select 'cards', count(*)::int from public.cards`,
      );
      // #then
      expect(Object.fromEntries(rows.map((row) => [row.table_name, row.count]))).toEqual({
        accounts: 2,
        rule_versions: 2,
        receipts: 6,
        reconciliations: 1,
        lots: 2,
        payments: 5,
        keeper_runs: 9,
        bucket_waits: 1,
        chain_cursor: 2,
        passkey_credentials: 1,
        cards: 2,
      });
    });
  });

  it('stores each receipt hash as keccak256 of its event data', async () => {
    // #when
    const rows = await receipts();
    // #then
    expect(rows.map((row) => row.receipt_hash)).toEqual(rows.map((row) => keccak256(row.event_data as Hex)));
  });

  it('decodes each receipt event data back to its columns with viem', async () => {
    // #given
    const rows = await receipts();
    for (const row of rows) {
      // #when
      const decoded = decodeReceiptData(row.event_data as Hex);
      const columns: Record<string, string> = {};
      for (const field of RECEIPT_FIELD_NAMES) {
        const value = decoded[field];
        const column = RECEIPT_COLUMNS[field];
        if (field === 'trigger') columns[column] = enumMember(TRIGGERS, Number(value));
        else if (field === 'status') columns[column] = enumMember(STATUSES, Number(value));
        else if (field === 'reason') columns[column] = enumMember(REASONS, Number(value));
        else if (field === 'mode') columns[column] = enumMember(ACCOUNTING_MODES, Number(value));
        else columns[column] = String(value).toLowerCase();
      }
      // #then
      const stored = Object.fromEntries(Object.values(RECEIPT_COLUMNS).map((column) => [column, row[column]]));
      expect(stored, `receipt ${row.receipt_id}`).toEqual(columns);
    }
  });

  it("prices each buy and sale with packages/core's math at the rule's 100 bps cap and 50 bps slippage", async () => {
    // #given
    const rows = await receipts();
    for (const row of rows) {
      const status = row.status;
      // #when
      const expected =
        status === 'FILLED' || status === 'SETTLED'
          ? {
              exec_price: execPriceBuy(big(row, 'usdg_spent'), big(row, 'tokens_out')),
              premium_bps: premiumBps(big(row, 'usdg_spent'), big(row, 'tokens_out'), big(row, 'answer')),
              min_out: minOutForBuy(big(row, 'usdg_to_equity'), big(row, 'quote'), 50),
            }
          : status === 'PART_SOLD' || status === 'SOLD'
            ? {
                exec_price: execPriceSell(big(row, 'usdg_out'), big(row, 'tokens_in')),
                premium_bps: discountBps(big(row, 'usdg_out'), big(row, 'tokens_in'), big(row, 'answer')),
                min_out: minOutForSell(big(row, 'tokens_in'), big(row, 'quote'), 50),
              }
            : null;
      if (expected === null) continue;
      // #then
      expect(
        { exec_price: big(row, 'exec_price'), premium_bps: big(row, 'premium_bps'), min_out: big(row, 'min_out') },
        `receipt ${row.receipt_id}`,
      ).toEqual(expected);
      expect(big(row, 'premium_bps') <= 100n, `receipt ${row.receipt_id} within the cap`).toBe(true);
    }
  });

  it('queues the PREMIUM receipt above the cap, with the minimum the module would ask', async () => {
    // #given
    const rows = await receipts();
    const premium = rows.find((row) => row.reason === 'PREMIUM');
    if (premium === undefined) throw new Error('the seed has no PREMIUM receipt');
    // #then
    expect({
      above: big(premium, 'premium_bps') > 100n,
      minOut: big(premium, 'min_out'),
      queued: big(premium, 'usdg_queued'),
    }).toEqual({
      above: true,
      minOut: minOutForBuy(big(premium, 'usdg_to_equity'), big(premium, 'quote'), 50),
      queued: big(premium, 'usdg_to_equity'),
    });
    expect(exceedsPremium(big(premium, 'usdg_to_equity'), 81_890_000_000_000_000n, big(premium, 'answer'), 100)).toBe(
      true,
    );
  });

  it('keeps I2 on every split: USDG in is spend plus spent plus queued', async () => {
    // #given
    const rows = await receipts();
    const splits = rows.filter((row) => ['FILLED', 'QUEUED'].includes(row.status ?? '') && big(row, 'usdg_in') > 0n);
    // #then
    expect(splits.length).toBe(3);
    for (const row of splits) {
      expect(big(row, 'usdg_in'), `receipt ${row.receipt_id}`).toBe(
        big(row, 'usdg_to_spend') + big(row, 'usdg_spent') + big(row, 'usdg_queued'),
      );
    }
  });

  it('holds the lots its receipts make: half of lot 1 sold, lot 3 whole', async () => {
    await Session.rolledBack(db, 'anon', async (session) => {
      // #when
      const rows = await session.rows<Record<string, string>>(
        `select lot_id::text, status::text, tokens_bought::text, tokens_remaining::text, last_receipt_id::text
           from public.lots order by lot_id`,
      );
      // #then
      expect(rows).toEqual([
        {
          lot_id: '1',
          status: 'PART_SOLD',
          tokens_bought: '74391022480000000',
          tokens_remaining: '37195511240000000',
          last_receipt_id: '4',
        },
        {
          lot_id: '3',
          status: 'SETTLED',
          tokens_bought: '44590120000000000',
          tokens_remaining: '44590120000000000',
          last_receipt_id: '3',
        },
      ]);
    });
  });

  it("reads Ada's inbox newest first, each sorted payment with its receipt and lot", async () => {
    await Session.rolledBack(db, 'service_role', async (session) => {
      // #when
      const rows = await session.rows<Record<string, string | null>>(
        `select p.amount::text, p.status::text, p.grace_ends_at::text, p.sorted_by_receipt_id::text,
                nullif(r.lot_id, 0)::text as lot_id
           from public.payments p
           left join public.receipts r on r.receipt_id = p.sorted_by_receipt_id
          where p.to_address = '0xada0000000000000000000000000000000000001'
          order by p.block_number desc, p.log_index desc`,
      );
      // #then
      expect(rows).toEqual([
        { amount: '75000000', status: 'RECEIVED', grace_ends_at: null, sorted_by_receipt_id: null, lot_id: null },
        {
          amount: '200000000',
          status: 'WAITING_GRACE',
          grace_ends_at: '1792437600',
          sorted_by_receipt_id: null,
          lot_id: null,
        },
        { amount: '300000000', status: 'SORTED', grace_ends_at: null, sorted_by_receipt_id: '2', lot_id: null },
        { amount: '500000000', status: 'SORTED', grace_ends_at: null, sorted_by_receipt_id: '1', lot_id: '1' },
      ]);
    });
  });
});
