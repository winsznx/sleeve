import { readFile, readdir } from 'node:fs/promises';

import { PGlite } from '@electric-sql/pglite';

/**
 * Sleeve's Supabase schema on PGlite, Postgres compiled to WebAssembly, so the migration and its access rules run in
 * the test process with no Docker and no Supabase stack (owner's directive). PGlite 0.5 is Postgres 18; the hosted
 * project runs 17 (supabase/config.toml), and the schema uses nothing that differs between them.
 */

const SUPABASE_DIR = new URL('../../../supabase/', import.meta.url);

/**
 * What a hosted Supabase project holds before any migration runs, as far as the schema depends on it: the API roles,
 * usage on public, and the default privileges that give each new object in public to all three roles. The service
 * role bypasses row level security. Migrations run as postgres, the owner of what they create, as here.
 */
export const SUPABASE_BASELINE = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

export type ApiRole = 'anon' | 'authenticated' | 'service_role';
export const API_ROLES: readonly ApiRole[] = ['anon', 'authenticated', 'service_role'];
export const PUBLIC_ROLES: readonly ApiRole[] = ['anon', 'authenticated'];

/** The migrations in the order the Supabase CLI applies them: by file name, which starts with the timestamp. */
export async function migrationFiles(): Promise<URL[]> {
  const directory = new URL('migrations/', SUPABASE_DIR);
  const names = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  return names.map((name) => new URL(name, directory));
}

export async function readSeed(): Promise<string> {
  return readFile(new URL('seed.sql', SUPABASE_DIR), 'utf8');
}

/** A fresh in-memory database with the Supabase baseline and every migration applied, and the seed when asked. */
export async function openDatabase(options: { seed: boolean }): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_BASELINE);
  for (const file of await migrationFiles()) {
    await db.exec(await readFile(file, 'utf8'));
  }
  if (options.seed) await db.exec(await readSeed());
  return db;
}

/** The fields of a Postgres error the tests assert on. */
export interface PostgresError {
  code: string;
  constraint: string | undefined;
  message: string;
}

function asPostgresError(error: unknown): PostgresError {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    const constraint = 'constraint' in error && typeof error.constraint === 'string' ? error.constraint : undefined;
    return { code: error.code, constraint, message: error.message };
  }
  throw error;
}

export type Param = string | number | boolean | null;

/**
 * One transaction on the shared database that is always rolled back, so every test starts from the same state.
 * Statements run as `role`; `attempt` and `refused` wrap a statement in a savepoint so a refusal leaves the
 * transaction usable.
 */
export class Session {
  private constructor(private readonly db: PGlite) {}

  static async rolledBack(
    db: PGlite,
    role: ApiRole | 'postgres',
    work: (session: Session) => Promise<void>,
  ): Promise<void> {
    await db.exec('begin');
    try {
      const session = new Session(db);
      await session.become(role);
      await work(session);
    } finally {
      await db.exec('rollback');
    }
  }

  /** The same, committed: for state every test in a file starts from. */
  static async committed(
    db: PGlite,
    role: ApiRole | 'postgres',
    work: (session: Session) => Promise<void>,
  ): Promise<void> {
    await db.exec('begin');
    try {
      const session = new Session(db);
      await session.become(role);
      await work(session);
      await db.exec('commit');
    } catch (error) {
      await db.exec('rollback');
      throw error;
    }
  }

  /** Switches the role for the rest of the transaction. */
  async become(role: ApiRole | 'postgres'): Promise<void> {
    await this.db.exec(role === 'postgres' ? 'reset role' : `set local role ${role}`);
  }

  async rows<T>(sql: string, params: readonly Param[] = []): Promise<T[]> {
    const result = await this.db.query<T>(sql, [...params]);
    return result.rows;
  }

  async run(sql: string, params: readonly Param[] = []): Promise<void> {
    await this.db.query(sql, [...params]);
  }

  /** Runs a statement and reports how it ended, leaving the transaction usable either way. */
  async attempt(sql: string, params: readonly Param[] = []): Promise<PostgresError | null> {
    await this.db.exec('savepoint attempt');
    try {
      await this.db.query(sql, [...params]);
      await this.db.exec('release savepoint attempt');
      return null;
    } catch (error) {
      await this.db.exec('rollback to savepoint attempt');
      return asPostgresError(error);
    }
  }

  /** The error a statement must fail with. Fails the test when the statement succeeds. */
  async refused(sql: string, params: readonly Param[] = []): Promise<PostgresError> {
    const error = await this.attempt(sql, params);
    if (error === null) throw new Error(`expected a refusal, but this succeeded: ${sql}`);
    return error;
  }
}
