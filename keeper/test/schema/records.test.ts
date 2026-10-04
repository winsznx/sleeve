import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type PostgresError, Session, openDatabase } from './database';
import { ADA, BO, baseWorldInserts, insertCard, insertPasskey, insertRow } from './fixtures';

/**
 * The rules on the keeper's bookkeeping (chain_cursor, keeper_runs, bucket_waits) and on the records the app's server
 * routes write (passkey_credentials, cards). Both write with the service role.
 */

const CHECK_VIOLATION = '23514';
const FOREIGN_KEY_VIOLATION = '23503';
const UNIQUE_VIOLATION = '23505';

/** Monday 5 October 2026, 00:00 in New York (EDT, 04:00 UTC). */
const MONDAY_OCTOBER_5 = 1_791_172_800;
/** Monday 2 November 2026, 00:00 in New York, the day after daylight saving time ends (EST, 05:00 UTC). */
const MONDAY_NOVEMBER_2 = 1_793_595_600;

const PUBLIC_KEY = `0x04${'a1'.repeat(32)}${'b2'.repeat(32)}`;
const CREDENTIAL_ID = 'RJuF0LtqLPKfyXI4LLn21Q';

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

function asServer(work: (session: Session) => Promise<void>): Promise<void> {
  return Session.rolledBack(db, 'service_role', work);
}

describe('chain_cursor', () => {
  it.each(['Sleeve', 'usdg-transfers', '1stream', ''])('refuses the stream name %j', async (stream) => {
    await asServer(async (session) => {
      // #when
      const error = await session.refused(`insert into public.chain_cursor (stream, last_block) values ($1, 1)`, [
        stream,
      ]);
      // #then
      expect(refusal(error)).toEqual(rule('chain_cursor_stream_format'));
    });
  });

  it('stamps updated_at whenever the cursor moves', async () => {
    await asServer(async (session) => {
      // #given
      await session.run(
        `insert into public.chain_cursor (stream, last_block, updated_at) values ('sleeve_module', 1, '2020-01-01')`,
      );
      // #when
      await session.run(`update public.chain_cursor set last_block = 2 where stream = 'sleeve_module'`);
      // #then
      const rows = await session.rows<{ fresh: boolean }>(
        `select updated_at > '2020-01-02' as fresh from public.chain_cursor where stream = 'sleeve_module'`,
      );
      expect(rows).toEqual([{ fresh: true }]);
    });
  });
});

describe('keeper_runs', () => {
  it('opens a run and finishes it once', async () => {
    await asServer(async (session) => {
      // #given
      const opened = await session.rows<{ run_id: number }>(
        `insert into public.keeper_runs (action, account, ticker_id) values ('SPLIT', $1, 0) returning run_id::int`,
        [ADA],
      );
      const runId = opened[0]?.run_id ?? 0;
      // #when
      const finished = await session.attempt(
        `update public.keeper_runs set finished_at = now(), outcome = 'SKIPPED', detail = '{"reason": "SESSION"}' where run_id = $1`,
        [runId],
      );
      const changed = await session.refused(`update public.keeper_runs set detail = '{}' where run_id = $1`, [runId]);
      // #then
      expect([finished, refusal(changed)]).toEqual([null, rule('keeper_runs_finish_once')]);
    });
  });

  it('never changes what an open run is', async () => {
    await asServer(async (session) => {
      // #given
      await session.run(`insert into public.keeper_runs (action) values ('INDEX')`);
      // #when
      const error = await session.refused(`update public.keeper_runs set action = 'SPLIT'`);
      // #then
      expect(refusal(error)).toEqual(rule('keeper_runs_identity_fixed'));
    });
  });

  it.each([
    [
      'an outcome before the run finished',
      `('SPLIT', null, 'SUCCEEDED', null, null)`,
      'keeper_runs_outcome_when_finished',
    ],
    ['a finish without an outcome', `('SPLIT', now(), null, null, null)`, 'keeper_runs_outcome_when_finished'],
    ['a failure without its error', `('SPLIT', now(), 'FAILED', null, null)`, 'keeper_runs_error_when_failed'],
    ['an error on a success', `('SPLIT', now(), 'SUCCEEDED', 'boom', null)`, 'keeper_runs_error_when_failed'],
    [
      'a revert without its transaction',
      `('SPLIT', now(), 'REVERTED', 'GuardNotClear', null)`,
      'keeper_runs_revert_has_tx',
    ],
    [
      'a transaction sent while indexing',
      `('INDEX', now(), 'SUCCEEDED', null, '0x${'1'.repeat(64)}')`,
      'keeper_runs_index_sends_nothing',
    ],
    [
      'a finish before the start',
      `('SPLIT', now() - interval '1 hour', 'SKIPPED', null, null)`,
      'keeper_runs_finish_after_start',
    ],
  ])('refuses %s', async (_label, values, constraint) => {
    await asServer(async (session) => {
      // #when
      const error = await session.refused(
        `insert into public.keeper_runs (action, finished_at, outcome, error, tx_hash) values ${values}`,
      );
      // #then
      expect(refusal(error)).toEqual(rule(constraint));
    });
  });

  it('refuses detail that is not an object', async () => {
    await asServer(async (session) => {
      // #when
      const error = await session.refused(`insert into public.keeper_runs (action, detail) values ('INDEX', '[1]')`);
      // #then
      expect(refusal(error)).toEqual(rule('keeper_runs_detail_object'));
    });
  });
});

describe('bucket_waits', () => {
  it('records the reason a bucket waits and moves its last sighting', async () => {
    await asServer(async (session) => {
      // #given
      await session.run(
        `insert into public.bucket_waits (account, ticker_id, reason, bucket_since, first_seen_at, last_seen_at)
         values ($1, 1, 'PREMIUM', 1791982805, 1791982870, 1791982870)`,
        [BO],
      );
      // #when
      const moved = await session.attempt(
        `update public.bucket_waits set last_seen_at = 1792434600 where account = $1`,
        [BO],
      );
      // #then
      expect(moved).toBeNull();
    });
  });

  it.each([
    ['NONE as the reason', `('NONE', 10, 10)`, 'bucket_waits_reason_set'],
    ['a last sighting before the first', `('SESSION', 10, 9)`, 'bucket_waits_seen_in_order'],
  ])('refuses %s', async (_label, values, constraint) => {
    await asServer(async (session) => {
      // #when
      const error = await session.refused(
        `insert into public.bucket_waits (account, ticker_id, bucket_since, reason, first_seen_at, last_seen_at)
         select $1, 0, 1, v.reason::public.receipt_reason, v.first_seen_at, v.last_seen_at
           from (values ${values}) as v (reason, first_seen_at, last_seen_at)`,
        [ADA],
      );
      // #then
      expect(refusal(error)).toEqual(rule(constraint));
    });
  });

  it('refuses a wait for an account that never installed', async () => {
    await asServer(async (session) => {
      // #when
      const error = await session.refused(
        `insert into public.bucket_waits (account, ticker_id, reason, bucket_since, first_seen_at, last_seen_at)
         values ('0x5778000000000000000000000000000000000007', 0, 'SESSION', 1, 1, 1)`,
      );
      // #then
      expect(refusal(error)).toEqual(rule('bucket_waits_account_fkey', FOREIGN_KEY_VIOLATION));
    });
  });
});

describe('passkey_credentials', () => {
  function registration(overrides: Record<string, string | number> = {}): ReturnType<typeof insertPasskey> {
    return insertPasskey({
      credential_id: CREDENTIAL_ID,
      public_key: PUBLIC_KEY,
      rp_id: 'localhost',
      account_address: ADA,
      ...overrides,
    });
  }

  it('records a registration before the account deploys, with the counter at zero', async () => {
    await asServer(async (session) => {
      // #given
      const { sql, params } = registration({ account_address: '0xda70000000000000000000000000000000000008' });
      // #when
      await session.run(sql, params);
      // #then
      const rows = await session.rows<{ counter: number }>('select counter::int from public.passkey_credentials');
      expect(rows).toEqual([{ counter: 0 }]);
    });
  });

  it.each([
    ['a padded credential id', { credential_id: `${CREDENTIAL_ID}==` }, 'passkey_credentials_credential_id_format'],
    [
      'a credential id in plain base64',
      { credential_id: 'RJuF0LtqLPKfyXI4LLn2+Q' },
      'passkey_credentials_credential_id_format',
    ],
    [
      'a credential id under 16 bytes',
      { credential_id: 'RJuF0LtqLPKfyXI4LLn21' },
      'passkey_credentials_credential_id_format',
    ],
    [
      'a credential id over 1,023 bytes',
      { credential_id: 'A'.repeat(1_365) },
      'passkey_credentials_credential_id_format',
    ],
    ['a compressed public key', { public_key: `0x02${'a1'.repeat(32)}` }, 'passkey_credentials_public_key_format'],
    [
      'an uppercase public key',
      { public_key: PUBLIC_KEY.toUpperCase().replace('0X', '0x') },
      'passkey_credentials_public_key_format',
    ],
    ['an origin as the relying party id', { rp_id: 'https://sleeve.example' }, 'passkey_credentials_rp_id_format'],
    ['an uppercase relying party id', { rp_id: 'Sleeve.example' }, 'passkey_credentials_rp_id_format'],
    ['a relying party id with a trailing dot', { rp_id: 'sleeve.example.' }, 'passkey_credentials_rp_id_format'],
    ['a counter above uint32', { counter: 4_294_967_296 }, 'passkey_credentials_counter_range'],
  ])('refuses %s', async (_label, overrides, constraint) => {
    await asServer(async (session) => {
      // #given
      const { sql, params } = registration(overrides);
      // #when
      const error = await session.refused(sql, params);
      // #then
      expect(refusal(error)).toEqual(rule(constraint));
    });
  });

  it('accepts the longest credential id WebAuthn allows', async () => {
    await asServer(async (session) => {
      // #given
      const { sql, params } = registration({ credential_id: 'A'.repeat(1_364) });
      // #then
      expect(await session.attempt(sql, params)).toBeNull();
    });
  });

  it('refuses a second credential with the same public key', async () => {
    await asServer(async (session) => {
      // #given
      const first = registration();
      await session.run(first.sql, first.params);
      const second = registration({ credential_id: 'SKvG1MurMQLgzYJ5MMo32R' });
      // #when
      const error = await session.refused(second.sql, second.params);
      // #then
      expect(refusal(error)).toEqual(rule('passkey_credentials_public_key_key', UNIQUE_VIOLATION));
    });
  });

  it('lets the counter rise and never fall', async () => {
    await asServer(async (session) => {
      // #given
      const { sql, params } = registration();
      await session.run(sql, params);
      // #when
      const rise = await session.attempt(`update public.passkey_credentials set counter = 5, last_used_at = now()`);
      const fall = await session.refused(`update public.passkey_credentials set counter = 3`);
      // #then
      expect([rise, refusal(fall)]).toEqual([null, rule('passkey_credentials_counter_rises')]);
    });
  });

  it.each([
    ['account', `update public.passkey_credentials set account_address = '${BO}'`],
    ['public key', `update public.passkey_credentials set public_key = '0x04${'c3'.repeat(64)}'`],
    ['relying party', `update public.passkey_credentials set rp_id = 'sleeve.example'`],
  ])('never moves a credential to another %s', async (_label, sql) => {
    await asServer(async (session) => {
      // #given
      const { sql: insert, params } = registration();
      await session.run(insert, params);
      // #when
      const error = await session.refused(sql);
      // #then
      expect(refusal(error)).toEqual(rule('passkey_credentials_identity_fixed'));
    });
  });
});

describe('cards', () => {
  function card(overrides: Record<string, string | number | null>): ReturnType<typeof insertCard> {
    return insertCard({ card_id: 'Rc7pX2kR9vTa', account: ADA, receipt_id: null, week_start: null, ...overrides });
  }

  it("saves a card for one of the account's own buys, with amounts and proof off", async () => {
    await asServer(async (session) => {
      // #given
      const { sql, params } = card({ receipt_id: '1' });
      // #when
      await session.run(sql, params);
      // #then
      const rows = await session.rows<{ options: unknown }>('select options from public.cards');
      expect(rows).toEqual([{ options: { showAmounts: false, showProof: false } }]);
    });
  });

  it.each([
    ['on a daylight time Monday', MONDAY_OCTOBER_5],
    ['on the Monday after the clocks go back', MONDAY_NOVEMBER_2],
  ])('saves a week card starting at 00:00 New York time %s', async (_label, weekStart) => {
    await asServer(async (session) => {
      // #given
      const { sql, params } = card({ week_start: weekStart });
      // #then
      expect(await session.attempt(sql, params)).toBeNull();
    });
  });

  it.each([
    ['Monday 00:00 UTC, which is Sunday evening in New York', 1_791_158_400],
    ['Monday 01:00 in New York', 1_791_176_400],
    ['Tuesday 00:00 in New York', 1_791_259_200],
    ['04:00 UTC on 2 November, which is 23:00 on Sunday in New York', 1_793_592_000],
  ])('refuses a week starting %s', async (_label, weekStart) => {
    await asServer(async (session) => {
      // #given
      const { sql, params } = card({ week_start: weekStart });
      // #when
      const error = await session.refused(sql, params);
      // #then
      expect(refusal(error)).toEqual(rule('cards_week_starts_monday'));
    });
  });

  it('refuses a card for a receipt that is not a buy', async () => {
    await asServer(async (session) => {
      // #given
      const { sql, params } = card({ receipt_id: '2' });
      // #when
      const error = await session.refused(sql, params);
      // #then
      expect(refusal(error)).toEqual(rule('cards_receipt_is_a_buy'));
    });
  });

  it("refuses a card for another account's receipt", async () => {
    await asServer(async (session) => {
      // #given
      const { sql, params } = card({ receipt_id: '3' });
      // #when
      const error = await session.refused(sql, params);
      // #then
      expect(refusal(error)).toEqual(rule('cards_receipt_of_account_fkey', FOREIGN_KEY_VIOLATION));
    });
  });

  it.each([
    ['both a receipt and a week', { receipt_id: '1', week_start: MONDAY_OCTOBER_5 }, 'cards_one_subject'],
    ['neither a receipt nor a week', {}, 'cards_one_subject'],
    ['an id under 12 characters', { card_id: 'Rc7pX2kR9vT', receipt_id: '1' }, 'cards_card_id_format'],
    ['an id with a slash', { card_id: 'Rc7pX2kR9v/a', receipt_id: '1' }, 'cards_card_id_format'],
    ['the id of the sample route', { card_id: 'sample', receipt_id: '1' }, 'cards_card_id_format'],
    ['options without showProof', { receipt_id: '1', options: '{"showAmounts": true}' }, 'cards_options_shape'],
    [
      'options with a string toggle',
      { receipt_id: '1', options: '{"showAmounts": "no", "showProof": false}' },
      'cards_options_shape',
    ],
  ])('refuses %s', async (_label, overrides, constraint) => {
    await asServer(async (session) => {
      // #given
      const { sql, params } = card(overrides);
      // #when
      const error = await session.refused(sql, params);
      // #then
      expect(refusal(error)).toEqual(rule(constraint));
    });
  });

  it('lets the owner change only the options', async () => {
    await asServer(async (session) => {
      // #given
      const { sql, params } = card({ receipt_id: '1' });
      await session.run(sql, params);
      // #when
      const toggled = await session.attempt(
        `update public.cards set options = '{"showAmounts": true, "showProof": true}'`,
      );
      const moved = await session.refused(
        `update public.cards set week_start = ${MONDAY_OCTOBER_5}, receipt_id = null`,
      );
      // #then
      expect([toggled, refusal(moved)]).toEqual([null, rule('cards_identity_fixed')]);
    });
  });
});

describe('the service role and the app records', () => {
  it('removes a card and a credential when the owner asks', async () => {
    await asServer(async (session) => {
      // #given
      for (const { sql, params } of [
        insertCard({ card_id: 'Rc7pX2kR9vTa', account: ADA, receipt_id: '1' }),
        insertPasskey({
          credential_id: CREDENTIAL_ID,
          public_key: PUBLIC_KEY,
          rp_id: 'localhost',
          account_address: ADA,
        }),
        insertRow('bucket_waits', {
          account: ADA,
          ticker_id: 0,
          reason: 'SESSION',
          bucket_since: '1',
          first_seen_at: 1,
          last_seen_at: 2,
        }),
      ]) {
        await session.run(sql, params);
      }
      // #when
      await session.run('delete from public.cards');
      await session.run('delete from public.passkey_credentials');
      await session.run('delete from public.bucket_waits');
      // #then
      const rows = await session.rows<{ count: number }>(
        `select (select count(*) from public.cards) + (select count(*) from public.passkey_credentials)
              + (select count(*) from public.bucket_waits) as count`,
      );
      expect(Number(rows[0]?.count)).toBe(0);
    });
  });
});
