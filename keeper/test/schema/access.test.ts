import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { API_ROLES, type ApiRole, PUBLIC_ROLES, Session, openDatabase } from './database';

/**
 * Who may do what (supabase/README.md, access): anon and authenticated read receipts and lots and nothing else, and
 * write nothing. The service role, which the keeper and the app's server routes use, reads everything and writes
 * what its table allows. Each rule is checked by switching to the role and running the statement, and the grants and
 * the row level security policies are each shown to hold without the other.
 */

const TABLES = [
  'chain_cursor',
  'accounts',
  'rule_versions',
  'receipts',
  'reconciliations',
  'lots',
  'payments',
  'keeper_runs',
  'bucket_waits',
  'passkey_credentials',
  'cards',
  'waitlist',
] as const;
type Table = (typeof TABLES)[number];

const PUBLIC_READ: readonly Table[] = ['receipts', 'lots'];

type Privilege = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'TRUNCATE' | 'REFERENCES' | 'TRIGGER';
const PRIVILEGES: readonly Privilege[] = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];

/** The service role's grants per table: chain history is never deleted, and lots move only with their receipts. */
const SERVICE_ROLE_GRANTS: Record<Table, readonly Privilege[]> = {
  chain_cursor: ['SELECT', 'INSERT', 'UPDATE'],
  accounts: ['SELECT', 'INSERT', 'UPDATE'],
  rule_versions: ['SELECT', 'INSERT', 'UPDATE'],
  receipts: ['SELECT', 'INSERT', 'UPDATE'],
  reconciliations: ['SELECT', 'INSERT', 'UPDATE'],
  lots: ['SELECT'],
  payments: ['SELECT', 'INSERT', 'UPDATE'],
  keeper_runs: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  bucket_waits: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  passkey_credentials: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  cards: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  waitlist: ['SELECT', 'INSERT'],
};

function expectedGrants(role: ApiRole, table: Table): readonly Privilege[] {
  if (role === 'service_role') return SERVICE_ROLE_GRANTS[table];
  return PUBLIC_READ.includes(table) ? ['SELECT'] : [];
}

/** The first column of each table, for an UPDATE that the privilege check refuses before it touches a row. */
const FIRST_COLUMN: Record<Table, string> = {
  chain_cursor: 'stream',
  accounts: 'address',
  rule_versions: 'account',
  receipts: 'receipt_id',
  reconciliations: 'receipt_id',
  lots: 'lot_id',
  payments: 'chain_id',
  keeper_runs: 'started_at',
  bucket_waits: 'account',
  passkey_credentials: 'credential_id',
  cards: 'card_id',
  waitlist: 'email',
};

const PERMISSION_DENIED = '42501';

let db: PGlite;

beforeAll(async () => {
  db = await openDatabase({ seed: true });
});

afterAll(async () => {
  await db?.close();
});

describe('grants', () => {
  it('give each role exactly its privileges on every table', async () => {
    await Session.rolledBack(db, 'postgres', async (session) => {
      const rows = await session.rows<{ role: ApiRole; table_name: Table; privilege: Privilege; granted: boolean }>(
        `select role, table_name, privilege, has_table_privilege(role, 'public.' || table_name, privilege) as granted
           from unnest($1::text[]) as role, unnest($2::text[]) as table_name, unnest($3::text[]) as privilege`,
        [`{${API_ROLES.join(',')}}`, `{${TABLES.join(',')}}`, `{${PRIVILEGES.join(',')}}`],
      );
      expect(rows).toHaveLength(API_ROLES.length * TABLES.length * PRIVILEGES.length);
      for (const row of rows) {
        const expected = expectedGrants(row.role, row.table_name).includes(row.privilege);
        expect(row.granted, `${row.role} ${row.privilege} on ${row.table_name}`).toBe(expected);
      }
    });
  });

  it('let only the service role use the keeper_runs sequence', async () => {
    await Session.rolledBack(db, 'postgres', async (session) => {
      const rows = await session.rows<{ role: ApiRole; usable: boolean }>(
        `select role, has_sequence_privilege(role, 'public.keeper_runs_run_id_seq', 'USAGE') as usable
           from unnest($1::text[]) as role`,
        [`{${API_ROLES.join(',')}}`],
      );
      expect(Object.fromEntries(rows.map((row) => [row.role, row.usable]))).toEqual({
        anon: false,
        authenticated: false,
        service_role: true,
      });
    });
  });

  it('keep the private schema and its functions from anon and authenticated', async () => {
    await Session.rolledBack(db, 'postgres', async (session) => {
      const schema = await session.rows<{ role: ApiRole; usable: boolean }>(
        `select role, has_schema_privilege(role, 'private', 'USAGE') as usable from unnest($1::text[]) as role`,
        [`{${API_ROLES.join(',')}}`],
      );
      expect(Object.fromEntries(schema.map((row) => [row.role, row.usable]))).toEqual({
        anon: false,
        authenticated: false,
        service_role: true,
      });
      const callable = await session.rows<{ name: string; role: ApiRole }>(
        `select p.proname as name, role
           from pg_proc p, unnest($1::text[]) as role
          where p.pronamespace = 'private'::regnamespace and has_function_privilege(role, p.oid, 'EXECUTE')`,
        [`{${PUBLIC_ROLES.join(',')}}`],
      );
      expect(callable).toEqual([]);
    });
  });
});

describe('anon and authenticated', () => {
  for (const role of PUBLIC_ROLES) {
    it(`${role} reads receipts and lots`, async () => {
      await Session.rolledBack(db, role, async (session) => {
        const receipts = await session.rows<{ count: number }>('select count(*)::int as count from public.receipts');
        const lots = await session.rows<{ count: number }>('select count(*)::int as count from public.lots');
        expect(receipts[0]?.count).toBeGreaterThan(0);
        expect(lots[0]?.count).toBeGreaterThan(0);
      });
    });

    it(`${role} reads no other table`, async () => {
      await Session.rolledBack(db, role, async (session) => {
        for (const table of TABLES.filter((name) => !PUBLIC_READ.includes(name))) {
          const error = await session.refused(`select * from public.${table} limit 1`);
          expect(error.code, table).toBe(PERMISSION_DENIED);
        }
      });
    });

    it(`${role} writes nothing`, async () => {
      await Session.rolledBack(db, role, async (session) => {
        for (const table of TABLES) {
          const column = FIRST_COLUMN[table];
          const statements = [
            `insert into public.${table} default values`,
            `update public.${table} set ${column} = ${column}`,
            `delete from public.${table}`,
            `truncate public.${table}`,
          ];
          for (const statement of statements) {
            const error = await session.refused(statement);
            expect(error.code, statement).toBe(PERMISSION_DENIED);
          }
        }
      });
    });

    it(`${role} cannot reach the private functions`, async () => {
      await Session.rolledBack(db, role, async (session) => {
        const error = await session.refused(`select private.abi_word(1)`);
        expect(error.code).toBe(PERMISSION_DENIED);
      });
    });
  }
});

describe('service role', () => {
  it('reads every table', async () => {
    await Session.rolledBack(db, 'service_role', async (session) => {
      for (const table of TABLES) {
        expect(await session.attempt(`select * from public.${table} limit 1`), table).toBeNull();
      }
    });
  });

  it('never deletes chain history or writes lots', async () => {
    await Session.rolledBack(db, 'service_role', async (session) => {
      for (const table of ['chain_cursor', 'accounts', 'rule_versions', 'receipts', 'reconciliations', 'payments']) {
        expect((await session.refused(`delete from public.${table}`)).code, table).toBe(PERMISSION_DENIED);
      }
      expect((await session.refused('insert into public.lots default values')).code).toBe(PERMISSION_DENIED);
      expect((await session.refused('update public.lots set status = status')).code).toBe(PERMISSION_DENIED);
      expect((await session.refused('delete from public.lots')).code).toBe(PERMISSION_DENIED);
    });
  });

  it('deletes its own bookkeeping and the app records', async () => {
    await Session.rolledBack(db, 'service_role', async (session) => {
      for (const table of ['keeper_runs', 'bucket_waits', 'passkey_credentials', 'cards']) {
        expect(await session.attempt(`delete from public.${table}`), table).toBeNull();
      }
    });
  });

  it('adds to the waitlist, and never changes or removes a row', async () => {
    await Session.rolledBack(db, 'service_role', async (session) => {
      expect(await session.attempt(`insert into public.waitlist (email, paid_with, country, source) values ('ada@example.com', 'stablecoins', 'NG', 'footer')`)).toBeNull();
      expect((await session.refused(`update public.waitlist set source = 'site'`)).code).toBe(PERMISSION_DENIED);
      expect((await session.refused('delete from public.waitlist')).code).toBe(PERMISSION_DENIED);
    });
  });

  it('keeps the waitlist to a lowercased email, a listed answer and a two-letter country', async () => {
    await Session.rolledBack(db, 'service_role', async (session) => {
      for (const values of [
        `('Ada@Example.com', null, null, 'site')`,
        `('ada@example', null, null, 'site')`,
        `('ada@example.com', 'gold', null, 'site')`,
        `('ada@example.com', null, 'Nigeria', 'site')`,
        `('ada@example.com', null, null, 'Footer')`,
      ]) {
        expect((await session.refused(`insert into public.waitlist (email, paid_with, country, source) values ${values}`)).code, values).toBe('23514');
      }
    });
  });
});

describe('row level security', () => {
  it('is on for every table in public, with policies only for the public reads', async () => {
    await Session.rolledBack(db, 'postgres', async (session) => {
      const tables = await session.rows<{ name: string; rls: boolean }>(
        `select relname as name, relrowsecurity as rls from pg_class
          where relnamespace = 'public'::regnamespace and relkind in ('r', 'p') order by relname`,
      );
      expect(tables.map((table) => table.name)).toEqual([...TABLES].sort());
      expect(tables.filter((table) => !table.rls)).toEqual([]);

      const policies = await session.rows<{
        tablename: string;
        policyname: string;
        permissive: string;
        roles: string;
        cmd: string;
        qual: string;
        with_check: string | null;
      }>(
        `select tablename, policyname, permissive, roles::text, cmd, qual, with_check
           from pg_policies where schemaname = 'public' order by tablename`,
      );
      expect(policies).toEqual([
        {
          tablename: 'lots',
          policyname: 'lots_public_read',
          permissive: 'PERMISSIVE',
          roles: '{anon,authenticated}',
          cmd: 'SELECT',
          qual: 'true',
          with_check: null,
        },
        {
          tablename: 'receipts',
          policyname: 'receipts_public_read',
          permissive: 'PERMISSIVE',
          roles: '{anon,authenticated}',
          cmd: 'SELECT',
          qual: 'true',
          with_check: null,
        },
      ]);
    });
  });

  it('hides every row of a table without a policy even when a grant slips', async () => {
    await Session.rolledBack(db, 'postgres', async (session) => {
      for (const table of TABLES.filter((name) => !PUBLIC_READ.includes(name))) {
        await session.run(`grant select on public.${table} to anon`);
      }
      const held = await session.rows<{ table_name: string; count: number }>(
        `select 'payments' as table_name, count(*)::int as count from public.payments
         union all select 'passkey_credentials', count(*)::int from public.passkey_credentials
         union all select 'cards', count(*)::int from public.cards`,
      );
      expect(held.every((row) => row.count > 0)).toBe(true);

      await session.become('anon');
      for (const table of TABLES.filter((name) => !PUBLIC_READ.includes(name))) {
        const rows = await session.rows<{ count: number }>(`select count(*)::int as count from public.${table}`);
        expect(rows[0]?.count, table).toBe(0);
      }
    });
  });

  it('hides every receipt and lot when their policies are gone, though the grant stays', async () => {
    await Session.rolledBack(db, 'postgres', async (session) => {
      await session.run('drop policy receipts_public_read on public.receipts');
      await session.run('drop policy lots_public_read on public.lots');
      await session.become('anon');
      const receipts = await session.rows<{ count: number }>('select count(*)::int as count from public.receipts');
      const lots = await session.rows<{ count: number }>('select count(*)::int as count from public.lots');
      expect(receipts[0]?.count).toBe(0);
      expect(lots[0]?.count).toBe(0);
    });
  });

  it('refuses an insert when a write grant slips, since no policy allows a write', async () => {
    await Session.rolledBack(db, 'postgres', async (session) => {
      // #given
      await session.run('grant insert on public.chain_cursor to anon');
      await session.become('anon');
      // #when
      const error = await session.refused(
        `insert into public.chain_cursor (stream, last_block) values ('anon_stream', 1)`,
      );
      // #then
      expect([error.code, error.message]).toEqual([
        PERMISSION_DENIED,
        'new row violates row-level security policy for table "chain_cursor"',
      ]);
    });
  });

  it('lets updates and deletes reach no row when write grants slip', async () => {
    await Session.rolledBack(db, 'postgres', async (session) => {
      // #given
      const before = await session.rows<{ count: number }>(`select count(*)::int as count from public.payments`);
      await session.run('grant select, update, delete on public.payments to anon');
      await session.become('anon');
      // #when
      await session.run(`update public.payments set status = 'RECEIVED', sorted_by_receipt_id = null`);
      await session.run('delete from public.payments');
      await session.become('postgres');
      // #then
      const after = await session.rows<{ count: number; sorted: number }>(
        `select count(*)::int as count, count(*) filter (where status = 'SORTED')::int as sorted from public.payments`,
      );
      expect(after).toEqual([{ count: before[0]?.count, sorted: 3 }]);
    });
  });
});

describe('objects later migrations add', () => {
  it('start with nothing for anon and authenticated, as Supabase gives the service role its usual grants', async () => {
    await Session.rolledBack(db, 'postgres', async (session) => {
      // #given
      await session.run('create table public.later_table (id bigint generated always as identity primary key)');
      await session.run(`create function public.later_function() returns integer language sql as 'select 1'`);
      await session.run(`create function private.later_check() returns boolean language sql as 'select true'`);
      // #when
      const rows = await session.rows<{
        role: ApiRole;
        selects: boolean;
        sequence: boolean;
        executes: boolean;
        checks: boolean;
      }>(
        `select role,
                has_table_privilege(role, 'public.later_table', 'SELECT') as selects,
                has_sequence_privilege(role, 'public.later_table_id_seq', 'USAGE') as sequence,
                has_function_privilege(role, 'public.later_function()', 'EXECUTE') as executes,
                has_function_privilege(role, 'private.later_check()', 'EXECUTE') as checks
           from unnest($1::text[]) as role`,
        [`{${API_ROLES.join(',')}}`],
      );
      // #then
      expect(rows).toEqual([
        { role: 'anon', selects: false, sequence: false, executes: false, checks: false },
        { role: 'authenticated', selects: false, sequence: false, executes: false, checks: false },
        { role: 'service_role', selects: true, sequence: true, executes: true, checks: true },
      ]);
    });
  });
});
