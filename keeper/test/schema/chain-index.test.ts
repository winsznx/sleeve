import type { PGlite } from '@electric-sql/pglite';
import type { Receipt } from '@sleeve/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type PostgresError, Session, openDatabase } from './database';
import {
  ADA,
  BASE,
  BO,
  KEEPER,
  type LogPosition,
  activeRule,
  at,
  baseWorldInserts,
  blankReceipt,
  buyReceipt,
  insertAccount,
  insertPayment,
  insertReceipt,
  insertRow,
  insertRuleVersion,
  lotReceipt,
  queuedReceipt,
  receiptRow,
} from './fixtures';

/**
 * The rules on the chain index: accounts, rule versions, receipts, the lots they move, reconciliations and payments.
 * The keeper writes these with the service role, so every write here runs as service_role. Each refusal is
 * asserted by its error code and its rule's name, which is what a writer catches.
 */

const CHECK_VIOLATION = '23514';
const FOREIGN_KEY_VIOLATION = '23503';
const UNIQUE_VIOLATION = '23505';

function refusal(error: PostgresError): { code: string; constraint: string | undefined } {
  return { code: error.code, constraint: error.constraint };
}

function rule(constraint: string, code = CHECK_VIOLATION): { code: string; constraint: string } {
  return { code, constraint };
}

let db: PGlite;

beforeAll(async () => {
  db = await openDatabase({ seed: false });
  await Session.committed(db, 'service_role', async (session) => {
    for (const { sql, params } of baseWorldInserts()) await session.run(sql, params);
  });
});

afterAll(async () => {
  await db?.close();
});

/** Runs a test's statements as the service role in a transaction that is rolled back. */
function asKeeper(work: (session: Session) => Promise<void>): Promise<void> {
  return Session.rolledBack(db, 'service_role', work);
}

/** Writes a receipt the test builds on. A refusal fails the test. */
async function addReceipt(session: Session, receipt: Receipt, log: LogPosition): Promise<void> {
  const { sql, params } = insertReceipt(receipt, log);
  await session.run(sql, params);
}

async function attemptReceipt(session: Session, receipt: Receipt, log: LogPosition): Promise<PostgresError | null> {
  const { sql, params } = insertReceipt(receipt, log);
  return session.attempt(sql, params);
}

async function refuseReceipt(session: Session, receipt: Receipt, log: LogPosition): Promise<PostgresError> {
  const { sql, params } = insertReceipt(receipt, log);
  return session.refused(sql, params);
}

interface LotRow {
  lot_id: string;
  account: string;
  ticker_id: number;
  status: string;
  tokens_bought: string;
  tokens_remaining: string;
  last_receipt_id: string;
}

async function lot(session: Session, lotId: bigint): Promise<LotRow | undefined> {
  const rows = await session.rows<LotRow>(
    `select lot_id::text, account::text, ticker_id::int, status::text, tokens_bought::text, tokens_remaining::text,
            last_receipt_id::text
       from public.lots where lot_id = $1`,
    [lotId.toString()],
  );
  return rows[0];
}

describe('value types', () => {
  it.each([
    [
      'a checksummed address',
      `select '0xAda0000000000000000000000000000000000001'::public.evm_address`,
      'evm_address_format',
    ],
    [
      'an address without 0x',
      `select 'ada0000000000000000000000000000000000001'::public.evm_address`,
      'evm_address_format',
    ],
    ['a short hash', `select '0x1234'::public.bytes32`, 'bytes32_format'],
    ['odd-length data', `select '0xabc'::public.hex_data`, 'hex_data_format'],
    ['a negative uint256', `select '-1'::public.uint256`, 'uint256_range'],
    ['a fraction', `select '1.5'::public.uint256`, 'uint256_range'],
    ['a stored scale', `select '1.0'::public.uint256`, 'uint256_range'],
    ['2^256', `select (2::numeric ^ 256)::public.uint256`, 'uint256_range'],
    ['2^255 as an int256', `select (2::numeric ^ 255)::public.int256`, 'int256_range'],
    ['2^80 as a round id', `select (2::numeric ^ 80)::public.uint80`, 'uint80_range'],
    ['256 as a uint8', `select 256::public.uint8`, 'uint8_range'],
    ['65,536 as a uint16', `select 65536::public.uint16`, 'uint16_range'],
    ['2^32 as a uint32', `select 4294967296::public.uint32`, 'uint32_range'],
    ['2^64 as a uint64', `select (2::numeric ^ 64)::public.uint64`, 'uint64_range'],
    ['2^128 as a uint128', `select (2::numeric ^ 128)::public.uint128`, 'uint128_range'],
    ['a negative bucket in a list', `select '{0,-1}'::public.uint256[]`, 'uint256_range'],
  ])('refuses %s', async (_label, sql, constraint) => {
    await asKeeper(async (session) => {
      // #when
      const error = await session.refused(sql);
      // #then
      expect(refusal(error)).toEqual(rule(constraint));
    });
  });

  it('matches nothing for a checksummed address in a filter, so readers lowercase first', async () => {
    await Session.rolledBack(db, 'anon', async (session) => {
      // #when
      const count = async (account: string): Promise<number | undefined> =>
        (
          await session.rows<{ count: number }>(
            `select count(*)::int as count from public.receipts where account = $1`,
            [account],
          )
        )[0]?.count;
      // #then
      expect([await count('0xAda0000000000000000000000000000000000001'), await count(ADA)]).toEqual([0, 2]);
    });
  });

  it('keeps the extremes each type can hold', async () => {
    await asKeeper(async (session) => {
      // #when
      const rows = await session.rows<Record<string, string>>(
        `select (2::numeric ^ 256 - 1)::public.uint256::text as uint256_max,
                (-(2::numeric ^ 255))::public.int256::text as int256_min,
                (2::numeric ^ 80 - 1)::public.uint80::text as uint80_max`,
      );
      // #then
      expect(rows[0]).toEqual({
        uint256_max: (2n ** 256n - 1n).toString(),
        int256_min: (-(2n ** 255n)).toString(),
        uint80_max: (2n ** 80n - 1n).toString(),
      });
    });
  });
});

describe('accounts', () => {
  const CARL = '0xca71000000000000000000000000000000000006';

  it("starts an account installed without a rule at ruleOf's empty rule", async () => {
    await asKeeper(async (session) => {
      // #given
      const { sql, params } = insertAccount({ address: CARL, installedAtBlock: 1_500 });
      // #when
      await session.run(sql, params);
      // #then
      const rows = await session.rows<{ rule: unknown }>('select rule from public.accounts where address = $1', [CARL]);
      expect(rows[0]?.rule).toEqual({
        version: 0,
        status: 'NONE',
        equityBps: 0,
        tickerId: 0,
        premiumCapBps: 0,
        slippageBps: 0,
        minClip: '0',
      });
    });
  });

  it.each([
    [
      'a missing key',
      { version: 1, status: 'ACTIVE', equityBps: 1_000, tickerId: 0, premiumCapBps: 100, slippageBps: 50 },
    ],
    ['an extra key', { ...activeRule(1), spendBps: 9_000 }],
    ['minClip as a number', { ...activeRule(1), minClip: 25_000_000 }],
    ['minClip with a leading zero', { ...activeRule(1), minClip: '025000000' }],
    ['a status the module has not', { ...activeRule(1), status: 'DRAFT' }],
    ['a null status', { ...activeRule(1), status: null }],
    ['a null minClip', { ...activeRule(1), minClip: null }],
    ['a null version', { ...activeRule(1), version: null }],
    ['equity above 10,000 bps', { ...activeRule(1), equityBps: 10_001 }],
    ['a ticker id above uint8', { ...activeRule(1), tickerId: 256 }],
    ['a fractional version', { ...activeRule(1), version: 1.5 }],
    ['a version as a string', { ...activeRule(1), version: '1' }],
  ])('refuses a rule with %s', async (_label, shape) => {
    await asKeeper(async (session) => {
      // #given
      const { sql, params } = insertAccount({ address: CARL, installedAtBlock: 1_500, rule: shape });
      // #when
      const error = await session.refused(sql, params);
      // #then
      expect(refusal(error)).toEqual(rule('accounts_rule_shape'));
    });
  });

  it('lets the keeper move the install, keeper, rule and sightings, and stamps updated_at', async () => {
    await asKeeper(async (session) => {
      // #given
      await session.run(`update public.accounts set updated_at = '2020-01-01' where address = $1`, [ADA]);
      // #when
      await session.run(
        `update public.accounts
            set uninstalled_at_block = 5000, keeper = $2, rule = $3, last_seen_block = 5000, last_seen_at = now()
          where address = $1`,
        [ADA, '0x0000000000000000000000000000000000000000', JSON.stringify({ ...activeRule(1), status: 'NONE' })],
      );
      // #then
      const rows = await session.rows<{ fresh: boolean }>(
        `select updated_at > '2020-01-02' as fresh from public.accounts where address = $1`,
        [ADA],
      );
      expect(rows).toEqual([{ fresh: true }]);
    });
  });

  it.each([
    ['address', `update public.accounts set address = '0xada0000000000000000000000000000000000009' where address = $1`],
    ['created_at', `update public.accounts set created_at = '2020-01-01' where address = $1`],
  ])('never changes %s', async (_column, sql) => {
    await asKeeper(async (session) => {
      // #when
      const error = await session.refused(sql, [ADA]);
      // #then
      expect(refusal(error)).toEqual(rule('accounts_identity_fixed'));
    });
  });

  it.each([
    ['install block', 'installed_at_block = -1', 'accounts_installed_at_block_range'],
    ['install log index', 'installed_at_log_index = -1', 'accounts_installed_at_log_index_range'],
    ['last seen block', 'last_seen_block = -1', 'accounts_last_seen_block_range'],
  ])('refuses a negative %s', async (_label, assignment, constraint) => {
    await asKeeper(async (session) => {
      // #when
      const error = await session.refused(`update public.accounts set ${assignment} where address = $1`, [ADA]);
      // #then
      expect(refusal(error)).toEqual(rule(constraint));
    });
  });

  it('refuses an uninstall before the install', async () => {
    await asKeeper(async (session) => {
      // #when
      const error = await session.refused(`update public.accounts set uninstalled_at_block = 999 where address = $1`, [
        ADA,
      ]);
      // #then
      expect(refusal(error)).toEqual(rule('accounts_uninstall_after_install'));
    });
  });
});

describe('rule_versions', () => {
  it("takes the account's next version", async () => {
    await asKeeper(async (session) => {
      // #given
      const { sql, params } = insertRuleVersion(ADA, 2, at(BASE.nextBlock));
      // #then
      expect(await session.attempt(sql, params)).toBeNull();
    });
  });

  it('refuses a version that skips one, since a RuleSet log was missed', async () => {
    await asKeeper(async (session) => {
      // #given
      const { sql, params } = insertRuleVersion(ADA, 3, at(BASE.nextBlock));
      // #when
      const error = await session.refused(sql, params);
      // #then
      expect(refusal(error)).toEqual(rule('rule_versions_in_sequence'));
    });
  });

  it('refuses an equity share above 10,000 bps', async () => {
    await asKeeper(async (session) => {
      // #given
      const { sql, params } = insertRuleVersion(ADA, 2, at(BASE.nextBlock), { equityBps: 10_001 });
      // #when
      const error = await session.refused(sql, params);
      // #then
      expect(refusal(error)).toEqual(rule('rule_versions_equity_bps_range'));
    });
  });

  it('starts every account at version 1', async () => {
    await asKeeper(async (session) => {
      // #given
      const carl = '0xca71000000000000000000000000000000000006';
      const account = insertAccount({ address: carl, installedAtBlock: 1_500 });
      await session.run(account.sql, account.params);
      const { sql, params } = insertRuleVersion(carl, 2, at(1_500, 1));
      // #when
      const error = await session.refused(sql, params);
      // #then
      expect(refusal(error)).toEqual(rule('rule_versions_in_sequence'));
    });
  });

  it('replays a version it holds unchanged and refuses a changed one', async () => {
    await asKeeper(async (session) => {
      // #given
      const upsert = `insert into public.rule_versions
          (account, version, equity_bps, ticker_id, premium_cap_bps, slippage_bps, min_clip, tx_hash, block_number, log_index)
        values ($1, 1, $2, 0, 100, 50, 25000000, $3, $4, 1)
        on conflict (account, version) do update set equity_bps = excluded.equity_bps`;
      const install = at(BASE.adaInstall.blockNumber, 1);
      // #when
      const replay = await session.attempt(upsert, [ADA, 1_000, install.txHash, install.blockNumber]);
      const change = await session.refused(upsert, [ADA, 2_000, install.txHash, install.blockNumber]);
      // #then
      expect([replay, refusal(change)]).toEqual([null, rule('rule_versions_append_only')]);
    });
  });
});

describe('receipts', () => {
  it('takes the next receipt when its columns encode to its event data', async () => {
    await asKeeper(async (session) => {
      // #when
      const error = await attemptReceipt(session, queuedReceipt(4n, ADA, 100_000_000n), at(BASE.nextBlock));
      // #then
      expect(error).toBeNull();
    });
  });

  it('refuses a receipt that skips an id, since a log was missed', async () => {
    await asKeeper(async (session) => {
      // #when
      const error = await refuseReceipt(session, queuedReceipt(5n, ADA, 100_000_000n), at(BASE.nextBlock));
      // #then
      expect(refusal(error)).toEqual(rule('receipts_in_sequence'));
    });
  });

  it('refuses the first receipt of an empty index unless it is receipt 1', async () => {
    await Session.rolledBack(db, 'postgres', async (session) => {
      // #given
      await session.run('truncate public.receipts cascade');
      await session.become('service_role');
      // #when
      const error = await refuseReceipt(session, queuedReceipt(4n, ADA, 100_000_000n), at(BASE.nextBlock));
      // #then
      expect(refusal(error)).toEqual(rule('receipts_in_sequence'));
    });
  });

  it("refuses a receipt from a log before the last receipt's", async () => {
    await asKeeper(async (session) => {
      // #when
      const error = await refuseReceipt(session, queuedReceipt(4n, ADA, 100_000_000n), at(2_200, 4));
      // #then
      expect(refusal(error)).toEqual(rule('receipts_in_log_order'));
    });
  });

  it('refuses a rule version the index does not hold, and takes 0 for no rule', async () => {
    await asKeeper(async (session) => {
      // #given
      const unknown = { ...queuedReceipt(4n, ADA, 100_000_000n), ruleVersion: 7 };
      const none = {
        ...lotReceipt(4n, ADA, { status: 'PART_SOLD', lotId: 1n, tickerId: 0, tokensIn: 1n }),
        ruleVersion: 0,
      };
      // #when
      const refused = await refuseReceipt(session, unknown, at(BASE.nextBlock));
      const taken = await attemptReceipt(session, none, at(BASE.nextBlock));
      // #then
      expect([refusal(refused), taken]).toEqual([rule('receipts_rule_known'), null]);
    });
  });

  it('refuses typed columns that differ from the event data', async () => {
    await asKeeper(async (session) => {
      // #given
      const row = receiptRow(queuedReceipt(4n, ADA, 100_000_000n), at(BASE.nextBlock));
      const insert = insertRow('receipts', { ...row, usdg_to_spend: '90000001' });
      // #when
      const error = await session.refused(insert.sql, insert.params);
      // #then
      expect(refusal(error)).toEqual(rule('receipts_match_event_data'));
    });
  });

  it('refuses event data that differs from the typed columns', async () => {
    await asKeeper(async (session) => {
      // #given
      const row = receiptRow(queuedReceipt(4n, ADA, 100_000_000n), at(BASE.nextBlock));
      const data = String(row.event_data);
      const tampered = `${data.slice(0, -1)}${data.endsWith('0') ? '1' : '0'}`;
      const insert = insertRow('receipts', { ...row, event_data: tampered });
      // #when
      const error = await session.refused(insert.sql, insert.params);
      // #then
      expect(refusal(error)).toEqual(rule('receipts_match_event_data'));
    });
  });

  it('refuses a status read as the wrong member, since enums encode by position', async () => {
    await asKeeper(async (session) => {
      // #given
      const row = receiptRow(queuedReceipt(4n, ADA, 100_000_000n), at(BASE.nextBlock));
      const insert = insertRow('receipts', { ...row, status: 'SETTLED' });
      // #when
      const error = await session.refused(insert.sql, insert.params);
      // #then
      expect(refusal(error)).toEqual(rule('receipts_match_event_data'));
    });
  });

  it('replays an indexed receipt as a no-op and refuses any change to it', async () => {
    await asKeeper(async (session) => {
      // #given an upsert shaped like PostgREST's merge-duplicates: every sent column set from excluded
      const first = BASE.receipts[0];
      const row = receiptRow(first.receipt, first.log);
      const insert = insertRow('receipts', row);
      const assignments = Object.keys(row).map((column) => `${column} = excluded.${column}`);
      const merge = `${insert.sql} on conflict (receipt_id) do update set ${assignments.join(', ')}`;
      const changed = insertRow('receipts', { ...row, usdg_in: '1' });
      // #when
      const replay = await session.attempt(merge, insert.params);
      const conflicting = await session.refused(merge, changed.params);
      const duplicate = await session.refused(insert.sql, insert.params);
      // #then
      expect([replay, refusal(conflicting), duplicate.code]).toEqual([
        null,
        rule('receipts_append_only'),
        UNIQUE_VIOLATION,
      ]);
    });
  });

  it('takes a batch of receipts in one statement, each checked against the ones before it', async () => {
    await asKeeper(async (session) => {
      // #given a buy and a sale of its lot, written by one insert as a PostgREST bulk insert is
      const buy = receiptRow(buyReceipt(4n, ADA, { tickerId: 0, tokensOut: 2n * 10n ** 16n }), at(2_201, 0));
      const sale = receiptRow(
        lotReceipt(5n, ADA, { status: 'SOLD', lotId: 4n, tickerId: 0, tokensIn: 2n * 10n ** 16n }),
        at(2_201, 1),
      );
      const columns = Object.keys(buy);
      const values = [0, 1].map(
        (index) => `(${columns.map((_, position) => `$${index * columns.length + position + 1}`).join(', ')})`,
      );
      const params = [buy, sale].flatMap((row) => columns.map((column) => row[column] ?? null));
      // #when
      await session.run(`insert into public.receipts (${columns.join(', ')}) values ${values.join(', ')}`, params);
      // #then
      expect(await lot(session, 4n)).toMatchObject({ status: 'SOLD', tokens_remaining: '0', last_receipt_id: '5' });
    });
  });

  it('refuses a second receipt at a log position already indexed', async () => {
    await asKeeper(async (session) => {
      // #when
      const error = await refuseReceipt(session, queuedReceipt(4n, ADA, 100_000_000n), {
        ...BASE.receipts[2].log,
        blockNumber: BASE.nextBlock,
      });
      // #then
      expect(refusal(error)).toEqual(rule('receipts_log_key', UNIQUE_VIOLATION));
    });
  });

  it('refuses a negative block or log index', async () => {
    await asKeeper(async (session) => {
      // #given
      const row = receiptRow(queuedReceipt(4n, ADA, 100_000_000n), at(BASE.nextBlock));
      const negative = insertRow('receipts', { ...row, log_index: -1 });
      // #when
      const error = await session.refused(negative.sql, negative.params);
      // #then
      expect(refusal(error)).toEqual(rule('receipts_log_index_range'));
    });
  });

  it('refuses a receipt for an account that never installed', async () => {
    await asKeeper(async (session) => {
      // #given
      const stranger = '0x5778000000000000000000000000000000000007';
      // #when
      const error = await refuseReceipt(
        session,
        { ...blankReceipt(4n, stranger), status: 'RELEASED' },
        at(BASE.nextBlock),
      );
      // #then
      expect(refusal(error)).toEqual(rule('receipts_account_fkey', FOREIGN_KEY_VIOLATION));
    });
  });
});

describe('lots, moved by their receipts', () => {
  it('opens a lot from a buy, holding all it bought', async () => {
    await asKeeper(async (session) => {
      // #when
      await addReceipt(
        session,
        buyReceipt(4n, ADA, { tickerId: 0, tokensOut: 3n * 10n ** 16n, status: 'SETTLED' }),
        at(BASE.nextBlock),
      );
      // #then
      expect(await lot(session, 4n)).toEqual({
        lot_id: '4',
        account: ADA,
        ticker_id: 0,
        status: 'SETTLED',
        tokens_bought: '30000000000000000',
        tokens_remaining: '30000000000000000',
        last_receipt_id: '4',
      });
    });
  });

  it('takes a partial sale off the lot and marks it PART_SOLD', async () => {
    await asKeeper(async (session) => {
      // #when
      const sale = lotReceipt(4n, ADA, { status: 'PART_SOLD', lotId: 1n, tickerId: 0, tokensIn: 4n * 10n ** 16n });
      await addReceipt(session, sale, at(BASE.nextBlock));
      // #then
      expect(await lot(session, 1n)).toMatchObject({
        status: 'PART_SOLD',
        tokens_remaining: '60000000000000000',
        last_receipt_id: '4',
      });
    });
  });

  it('takes a second partial sale and then the last token', async () => {
    await asKeeper(async (session) => {
      // #when
      await addReceipt(
        session,
        lotReceipt(4n, ADA, { status: 'PART_SOLD', lotId: 1n, tickerId: 0, tokensIn: 10n ** 16n }),
        at(2_201),
      );
      await addReceipt(
        session,
        lotReceipt(5n, ADA, { status: 'PART_SOLD', lotId: 1n, tickerId: 0, tokensIn: 10n ** 16n }),
        at(2_202),
      );
      await addReceipt(
        session,
        lotReceipt(6n, ADA, { status: 'SOLD', lotId: 1n, tickerId: 0, tokensIn: 8n * 10n ** 16n }),
        at(2_203),
      );
      // #then
      expect(await lot(session, 1n)).toMatchObject({ status: 'SOLD', tokens_remaining: '0', last_receipt_id: '6' });
    });
  });

  it('trims a lot on a lot reconcile and keeps its status', async () => {
    await asKeeper(async (session) => {
      // #when
      const trim = lotReceipt(4n, ADA, { status: 'RECONCILED', lotId: 1n, tickerId: 0, tokensIn: 10n ** 17n });
      await addReceipt(session, trim, at(BASE.nextBlock));
      // #then
      expect(await lot(session, 1n)).toMatchObject({ status: 'FILLED', tokens_remaining: '0', last_receipt_id: '4' });
    });
  });

  it('leaves the lots alone for a ledger reconcile, which names no lot', async () => {
    await asKeeper(async (session) => {
      // #given
      const reconcile: Receipt = {
        ...blankReceipt(4n, ADA),
        ruleVersion: 1,
        trigger: 'OWNER',
        status: 'RECONCILED',
        usdgIn: 60_000_000n,
        usdgSpent: 60_000_000n,
      };
      // #when
      await addReceipt(session, reconcile, at(BASE.nextBlock));
      // #then
      expect(await lot(session, 1n)).toMatchObject({ status: 'FILLED', last_receipt_id: '1' });
    });
  });

  it.each([
    [
      'a sale larger than the lot',
      lotReceipt(4n, ADA, { status: 'SOLD', lotId: 1n, tickerId: 0, tokensIn: 2n * 10n ** 17n }),
      'lots_take_what_they_hold',
    ],
    [
      'a sale of nothing',
      lotReceipt(4n, ADA, { status: 'PART_SOLD', lotId: 1n, tickerId: 0, tokensIn: 0n }),
      'lots_take_what_they_hold',
    ],
    [
      'a PART_SOLD that empties the lot',
      lotReceipt(4n, ADA, { status: 'PART_SOLD', lotId: 1n, tickerId: 0, tokensIn: 10n ** 17n }),
      'lots_sold_when_empty',
    ],
    [
      'a SOLD that leaves tokens',
      lotReceipt(4n, ADA, { status: 'SOLD', lotId: 1n, tickerId: 0, tokensIn: 1n }),
      'lots_sold_when_empty',
    ],
    [
      "a sale of another account's lot",
      lotReceipt(4n, BO, { status: 'PART_SOLD', lotId: 1n, tickerId: 0, tokensIn: 1n }),
      'lots_same_account_and_ticker',
    ],
    [
      'a sale of the lot under another ticker',
      lotReceipt(4n, ADA, { status: 'PART_SOLD', lotId: 1n, tickerId: 2, tokensIn: 1n }),
      'lots_same_account_and_ticker',
    ],
    [
      'a sale of a lot the index does not hold',
      lotReceipt(4n, ADA, { status: 'PART_SOLD', lotId: 2n, tickerId: 0, tokensIn: 1n }),
      'lots_known',
    ],
    [
      'a QUEUED receipt that names a lot',
      { ...queuedReceipt(4n, ADA, 100_000_000n), lotId: 1n },
      'lots_changed_by_lot_receipts',
    ],
    [
      'a buy that names another lot',
      { ...buyReceipt(4n, ADA, { tickerId: 0, tokensOut: 1n }), lotId: 1n },
      'lots_buy_takes_receipt_id',
    ],
  ])('refuses %s, and the receipt with it', async (_label, receipt, constraint) => {
    await asKeeper(async (session) => {
      // #when
      const error = await refuseReceipt(session, receipt, at(BASE.nextBlock));
      const written = await session.rows<{ count: number }>('select count(*)::int as count from public.receipts');
      // #then
      expect([refusal(error), written[0]?.count]).toEqual([rule(constraint), 3]);
    });
  });

  it('keeps a SOLD lot final', async () => {
    await asKeeper(async (session) => {
      // #given
      await addReceipt(
        session,
        lotReceipt(4n, ADA, { status: 'SOLD', lotId: 1n, tickerId: 0, tokensIn: 10n ** 17n }),
        at(2_201),
      );
      // #when
      const error = await refuseReceipt(
        session,
        lotReceipt(5n, ADA, { status: 'SOLD', lotId: 1n, tickerId: 0, tokensIn: 1n }),
        at(2_202),
      );
      // #then
      expect(refusal(error)).toEqual(rule('lots_take_what_they_hold'));
    });
  });

  it.each([
    ['raise its tokens', `update public.lots set tokens_remaining = 5, last_receipt_id = 3 where lot_id = 1`],
    ['move it back to FILLED', `update public.lots set status = 'FILLED', last_receipt_id = 3 where lot_id = 1`],
    ['apply an older receipt', `update public.lots set last_receipt_id = 1 where lot_id = 1`],
    ['change it without a new receipt', `update public.lots set tokens_remaining = 0 where lot_id = 1`],
  ])('holds SPEC 14 even for the table owner: no write may %s', async (_label, sql) => {
    await Session.rolledBack(db, 'postgres', async (session) => {
      // #given lot 1 as receipt 2 would have left it, written by hand as only the owner can
      await session.run(
        `update public.lots set status = 'PART_SOLD', tokens_remaining = 1, last_receipt_id = 2 where lot_id = 1`,
      );
      // #when
      const error = await session.refused(sql);
      // #then
      expect(refusal(error)).toEqual(rule('lots_move_forward'));
    });
  });
});

describe('reconciliations', () => {
  it('takes the Reconciled event of a receipt and never changes it', async () => {
    await asKeeper(async (session) => {
      // #given
      const reconcile: Receipt = {
        ...blankReceipt(4n, ADA),
        ruleVersion: 1,
        trigger: 'OWNER',
        status: 'RECONCILED',
        usdgIn: 60_000_000n,
        usdgSpent: 50_000_000n,
        usdgQueued: 10_000_000n,
      };
      const log = at(BASE.nextBlock, 0);
      await addReceipt(session, reconcile, log);
      const event = insertRow('reconciliations', {
        receipt_id: '4',
        balance: '40000000',
        from_spend: '50000000',
        from_buckets: '{0,10000000,0,0}',
        tx_hash: log.txHash,
        block_number: log.blockNumber,
        log_index: 1,
      });
      // #when
      const taken = await session.attempt(event.sql, event.params);
      const change = await session.refused(`update public.reconciliations set from_spend = 1 where receipt_id = 4`);
      // #then
      expect([taken, refusal(change)]).toEqual([null, rule('reconciliations_append_only')]);
    });
  });

  it('refuses a Reconciled event for a receipt the index does not hold', async () => {
    await asKeeper(async (session) => {
      // #given
      const log = at(BASE.nextBlock, 1);
      const event = insertRow('reconciliations', {
        receipt_id: '9',
        balance: '0',
        from_spend: '0',
        from_buckets: '{}',
        tx_hash: log.txHash,
        block_number: log.blockNumber,
        log_index: log.logIndex,
      });
      // #when
      const error = await session.refused(event.sql, event.params);
      // #then
      expect(refusal(error)).toEqual(rule('reconciliations_receipt_id_fkey', FOREIGN_KEY_VIOLATION));
    });
  });
});

describe('payments', () => {
  it('records a transfer as RECEIVED on Robinhood Chain unless told otherwise', async () => {
    await asKeeper(async (session) => {
      // #when
      const rows = await session.rows<{ chain_id: number; status: string }>(
        'select chain_id, status::text from public.payments where tx_hash = $1',
        [BASE.payment2.log.txHash],
      );
      // #then
      expect(rows).toEqual([{ chain_id: 4663, status: 'RECEIVED' }]);
    });
  });

  it('sorts a payment by a later split of the same account', async () => {
    await asKeeper(async (session) => {
      // #when
      const error = await session.attempt(
        `update public.payments set status = 'SORTED', sorted_by_receipt_id = 2 where tx_hash = $1`,
        [BASE.payment2.log.txHash],
      );
      // #then
      expect(error).toBeNull();
    });
  });

  it.each([
    ['a settle', () => buyReceipt(4n, ADA, { tickerId: 0, tokensOut: 1n, status: 'SETTLED' })],
    [
      'a settle refusal, which carries no USDG in',
      () => ({ ...blankReceipt(4n, ADA), ruleVersion: 1, status: 'REFUSED_TICKER' as const, usdgToSpend: 30_000_000n }),
    ],
    [
      'a release',
      () => ({
        ...blankReceipt(4n, ADA),
        ruleVersion: 1,
        trigger: 'OWNER' as const,
        status: 'RELEASED' as const,
        usdgToSpend: 30_000_000n,
      }),
    ],
  ])('refuses %s as the receipt that sorted a payment', async (_label, makeReceipt) => {
    await asKeeper(async (session) => {
      // #given
      await addReceipt(session, makeReceipt(), at(BASE.nextBlock));
      // #when
      const error = await session.refused(
        `update public.payments set status = 'SORTED', sorted_by_receipt_id = 4 where tx_hash = $1`,
        [BASE.payment2.log.txHash],
      );
      // #then
      expect(refusal(error)).toEqual(rule('payments_sorted_by_a_split'));
    });
  });

  it('refuses a split written before the payment arrived', async () => {
    await asKeeper(async (session) => {
      // #given
      const late = insertPayment({
        to: ADA,
        amount: 1_000_000n,
        log: at(2_150, 0),
        timestamp: 1_791_700_000,
        status: 'SORTED',
        sortedBy: 2n,
      });
      // #when
      const error = await session.refused(late.sql, late.params);
      // #then
      expect(refusal(error)).toEqual(rule('payments_sorted_after_arrival'));
    });
  });

  it('refuses a split of another account', async () => {
    await asKeeper(async (session) => {
      // #when
      const error = await session.refused(
        `update public.payments set status = 'SORTED', sorted_by_receipt_id = 3 where tx_hash = $1`,
        [BASE.payment2.log.txHash],
      );
      // #then
      expect(refusal(error)).toEqual(rule('payments_sorted_by_receipt_fkey', FOREIGN_KEY_VIOLATION));
    });
  });

  it.each([
    [
      'back to RECEIVED',
      `update public.payments set status = 'RECEIVED', sorted_by_receipt_id = null where tx_hash = $1`,
    ],
    ['to another receipt', `update public.payments set sorted_by_receipt_id = 2 where tx_hash = $1`],
  ])('keeps SORTED final: no move %s', async (_label, sql) => {
    await asKeeper(async (session) => {
      // #when
      const error = await session.refused(sql, [BASE.payment1.log.txHash]);
      // #then
      expect(refusal(error)).toEqual(rule('payments_sorted_is_final'));
    });
  });

  it.each([
    ['WAITING_GRACE without the grace end', { status: 'WAITING_GRACE' as const }, 'payments_waiting_has_grace'],
    ['a grace end while RECEIVED', { graceEndsAt: 1_791_650_000 }, 'payments_waiting_has_grace'],
    ['SORTED without its receipt', { status: 'SORTED' as const }, 'payments_sorted_has_receipt'],
    ['a receipt while RECEIVED', { sortedBy: 2n }, 'payments_sorted_has_receipt'],
    ['an amount of zero', { amount: 0n }, 'payments_amount_range'],
    ['a transfer to itself', { from: ADA }, 'payments_not_to_self'],
  ])('refuses %s', async (_label, change, constraint) => {
    await asKeeper(async (session) => {
      // #given
      const { sql, params } = insertPayment({
        to: ADA,
        amount: 2_000_000n,
        log: at(2_098, 0),
        timestamp: 1_791_640_000,
        ...change,
      });
      // #when
      const error = await session.refused(sql, params);
      // #then
      expect(refusal(error)).toEqual(rule(constraint));
    });
  });

  it('refuses a payment from another chain', async () => {
    await asKeeper(async (session) => {
      // #given
      const log = at(2_098, 0);
      const { sql, params } = insertRow('payments', {
        chain_id: 42_161,
        tx_hash: log.txHash,
        log_index: log.logIndex,
        block_number: log.blockNumber,
        block_timestamp: 1_791_640_000,
        from_address: BO,
        to_address: ADA,
        amount: '2000000',
      });
      // #when
      const error = await session.refused(sql, params);
      // #then
      expect(refusal(error)).toEqual(rule('payments_chain_id_robinhood'));
    });
  });

  it('refuses a payment to an address that never installed the module', async () => {
    await asKeeper(async (session) => {
      // #given
      const { sql, params } = insertPayment({
        to: KEEPER,
        amount: 2_000_000n,
        log: at(2_098, 0),
        timestamp: 1_791_640_000,
      });
      // #when
      const error = await session.refused(sql, params);
      // #then
      expect(refusal(error)).toEqual(rule('payments_to_address_fkey', FOREIGN_KEY_VIOLATION));
    });
  });

  it('never changes what the transfer log said', async () => {
    await asKeeper(async (session) => {
      // #when
      const error = await session.refused(`update public.payments set amount = 1 where tx_hash = $1`, [
        BASE.payment2.log.txHash,
      ]);
      // #then
      expect(refusal(error)).toEqual(rule('payments_identity_fixed'));
    });
  });
});
