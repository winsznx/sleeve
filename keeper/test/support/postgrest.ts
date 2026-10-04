import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { PGlite } from '@electric-sql/pglite';

import type { ApiRole } from '../schema/database';

/**
 * A stand-in for Supabase's REST API (PostgREST) on top of PGlite, so the production store, supabase-js and all,
 * runs against the real migration in the test process. It covers the requests the keeper's store makes: selects with
 * filters, casts, order and limits; inserts and upserts with on_conflict and merge or ignore duplicates; updates and
 * deletes with filters. Each request runs in its own transaction as the API role, the way PostgREST runs it, so the
 * grants and row level security apply. Response bodies come from json_agg as PostgREST builds them, so numeric
 * columns arrive as JSON numbers and lose precision unless the select casts them to text, as on the hosted project.
 */

export interface RecordedRequest {
  method: string;
  table: string;
  query: string;
  prefer: string;
}

export interface FakeRest {
  url: string;
  fetch: typeof fetch;
  requests: RecordedRequest[];
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const CASTS = new Set(['text', 'text[]', 'int', 'bigint', 'numeric']);
const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);

class RestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function identifier(name: string): string {
  if (!IDENTIFIER.test(name)) throw new RestError(400, 'PGRST100', `"${name}" is not a plain identifier`);
  return `"${name}"`;
}

function selectList(select: string | null, source: string): string {
  if (select === null || select === '*') return `${source}.*`;
  // Each item is column, column::cast, alias:column or alias:column::cast. The key keeps the column name.
  return select
    .split(',')
    .map((item) => {
      const castAt = item.indexOf('::');
      const head = castAt === -1 ? item : item.slice(0, castAt);
      const cast = castAt === -1 ? undefined : item.slice(castAt + 2);
      const colon = head.indexOf(':');
      const column = colon === -1 ? head : head.slice(colon + 1);
      const name = colon === -1 ? column : head.slice(0, colon);
      if (cast !== undefined && !CASTS.has(cast)) throw new RestError(400, 'PGRST100', `cast ${cast} is not supported`);
      return `${source}.${identifier(column)}${cast === undefined ? '' : `::${cast}`} as ${identifier(name)}`;
    })
    .join(', ');
}

interface Clause {
  sql: string;
  params: string[];
}

function filters(query: URLSearchParams, source: string, offset: number): Clause {
  const parts: string[] = [];
  const params: string[] = [];
  const next = (value: string): string => {
    params.push(value);
    return `$${offset + params.length}`;
  };
  for (const [key, raw] of query.entries()) {
    if (RESERVED.has(key)) continue;
    const column = `${source}.${identifier(key)}`;
    const dot = raw.indexOf('.');
    const op = raw.slice(0, dot);
    const value = raw.slice(dot + 1);
    switch (op) {
      case 'eq':
        parts.push(`${column} = ${next(value)}`);
        break;
      case 'neq':
        parts.push(`${column} <> ${next(value)}`);
        break;
      case 'gt':
        parts.push(`${column} > ${next(value)}`);
        break;
      case 'gte':
        parts.push(`${column} >= ${next(value)}`);
        break;
      case 'lt':
        parts.push(`${column} < ${next(value)}`);
        break;
      case 'lte':
        parts.push(`${column} <= ${next(value)}`);
        break;
      case 'is':
        if (!['null', 'true', 'false'].includes(value)) throw new RestError(400, 'PGRST100', `is.${value}`);
        parts.push(`${column} is ${value}`);
        break;
      case 'in': {
        const items = value
          .replace(/^\(/, '')
          .replace(/\)$/, '')
          .split(',')
          .map((item) => item.replace(/^"(.*)"$/, '$1'));
        parts.push(`${column} in (${items.map(next).join(', ')})`);
        break;
      }
      default:
        throw new RestError(400, 'PGRST100', `operator ${op} is not supported`);
    }
  }
  return { sql: parts.length === 0 ? '' : ` where ${parts.join(' and ')}`, params };
}

function ordering(query: URLSearchParams, source: string): string {
  const order = query.get('order');
  const limit = query.get('limit');
  const offset = query.get('offset');
  let sql = '';
  if (order !== null) {
    sql += ` order by ${order
      .split(',')
      .map((item) => {
        const [column, direction = 'asc', nulls] = item.split('.') as [string, string | undefined, string | undefined];
        if (direction !== 'asc' && direction !== 'desc') throw new RestError(400, 'PGRST100', `order ${item}`);
        const nullsSql = nulls === undefined ? '' : nulls === 'nullsfirst' ? ' nulls first' : ' nulls last';
        return `${source}.${identifier(column)} ${direction}${nullsSql}`;
      })
      .join(', ')}`;
  }
  if (limit !== null) sql += ` limit ${Number.parseInt(limit, 10)}`;
  if (offset !== null) sql += ` offset ${Number.parseInt(offset, 10)}`;
  return sql;
}

function preferences(headers: Headers): Set<string> {
  return new Set(
    (headers.get('prefer') ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== ''),
  );
}

/** A write's rows as PostgREST returns them: the statement's returning rows, shaped by the select list, as JSON. */
function wrapBody(statement: string, select: string | null): string {
  const rows = `select ${selectList(select, 'c')} from changed as c`;
  return `with changed as (${statement}) select coalesce(json_agg(r), '[]'::json)::text as body from (${rows}) r`;
}

function statusFor(code: string): number {
  if (code === '23505' || code === '23503') return 409;
  if (code === '42501') return 403;
  if (code === '42P01') return 404;
  return 400;
}

export function postgrestOnPglite(db: PGlite, options: { role?: ApiRole; url?: string } = {}): FakeRest {
  const role = options.role ?? 'service_role';
  const base = options.url ?? 'http://supabase.test';
  const requests: RecordedRequest[] = [];
  let queue: Promise<unknown> = Promise.resolve();

  async function execute(sql: string, params: readonly unknown[]): Promise<string> {
    let body = '[]';
    await db.transaction(async (tx) => {
      await tx.exec(`set local role ${role}`);
      const result = await tx.query<{ body: string }>(sql, [...params]);
      body = result.rows[0]?.body ?? '[]';
    });
    return body;
  }

  async function handle(input: string | URL | Request, init: RequestInit | undefined): Promise<Response> {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = new Headers(init?.headers);
    const match = /^\/rest\/v1\/([a-z_][a-z0-9_]*)$/.exec(url.pathname);
    if (match?.[1] === undefined) throw new RestError(404, 'PGRST125', `no route ${url.pathname}`);
    const table = `public.${identifier(match[1])}`;
    const query = url.searchParams;
    const prefer = preferences(headers);
    const representation = prefer.has('return=representation');
    const select = query.get('select');
    requests.push({ method, table: match[1], query: query.toString(), prefer: [...prefer].join(',') });

    let sql: string;
    let params: unknown[] = [];
    if (method === 'GET') {
      const where = filters(query, 't', 0);
      const rows = `select ${selectList(select, 't')} from ${table} as t${where.sql}${ordering(query, 't')}`;
      sql = `select coalesce(json_agg(r), '[]'::json)::text as body from (${rows}) r`;
      params = where.params;
    } else if (method === 'POST') {
      const parsed: unknown = JSON.parse(typeof init?.body === 'string' ? init.body : 'null');
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      const columnsParam = query.get('columns');
      const columns = (columnsParam === null
        ? Object.keys((rows[0] ?? {}) as Record<string, unknown>)
        : columnsParam.split(',').map((column) => column.replace(/^"(.*)"$/, '$1'))
      ).map(identifier);
      let conflict = '';
      if (prefer.has('resolution=merge-duplicates') || prefer.has('resolution=ignore-duplicates')) {
        const target = (query.get('on_conflict') ?? '').split(',').filter((part) => part !== '').map(identifier);
        if (target.length === 0) throw new RestError(400, 'PGRST100', 'upserts here name on_conflict');
        const merge = columns.map((column) => `${column} = excluded.${column}`).join(', ');
        conflict = prefer.has('resolution=ignore-duplicates')
          ? ` on conflict (${target.join(', ')}) do nothing`
          : ` on conflict (${target.join(', ')}) do update set ${merge}`;
      }
      const list = columns.join(', ');
      const source = `json_populate_recordset(null::${table}, $1::json)`;
      sql = wrapBody(`insert into ${table} as t (${list}) select ${list} from ${source}${conflict} returning t.*`, select);
      params = [JSON.stringify(rows)];
    } else if (method === 'PATCH') {
      const values = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>;
      const assignments = Object.keys(values)
        .map(identifier)
        .map((column) => `${column} = b.${column}`)
        .join(', ');
      const where = filters(query, 't', 1);
      const source = `(select * from json_populate_record(null::${table}, $1::json)) as b`;
      sql = wrapBody(`update ${table} as t set ${assignments} from ${source}${where.sql} returning t.*`, select);
      params = [JSON.stringify(values), ...where.params];
    } else if (method === 'DELETE') {
      const where = filters(query, 't', 0);
      sql = wrapBody(`delete from ${table} as t${where.sql} returning t.*`, select);
      params = where.params;
    } else {
      throw new RestError(405, 'PGRST117', `method ${method}`);
    }

    const body = await execute(sql, params);
    const single = (headers.get('accept') ?? '').startsWith('application/vnd.pgrst.object+json');
    if (single) {
      const rows = JSON.parse(body) as unknown[];
      if (rows.length !== 1) throw new RestError(406, 'PGRST116', `expected one row, got ${rows.length}`);
      return json(method === 'POST' ? 201 : 200, JSON.stringify(rows[0]));
    }
    if (method === 'GET' || representation) return json(method === 'POST' ? 201 : 200, body);
    return new Response(null, { status: method === 'POST' ? 201 : 204 });
  }

  function json(status: number, body: string): Response {
    return new Response(body, { status, headers: { 'content-type': 'application/json' } });
  }

  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const run = queue.then(async () => {
      try {
        return await handle(input, init);
      } catch (error) {
        if (error instanceof RestError) {
          return json(error.status, JSON.stringify({ code: error.code, message: error.message, details: null, hint: null }));
        }
        const pg = error as { code?: unknown; message?: unknown; detail?: unknown; hint?: unknown };
        if (typeof pg.code === 'string') {
          const body = { code: pg.code, message: String(pg.message), details: pg.detail ?? null, hint: pg.hint ?? null };
          return json(statusFor(pg.code), JSON.stringify(body));
        }
        throw error;
      }
    });
    queue = run.catch(() => undefined);
    return run;
  }) as typeof fetch;

  return { url: base, fetch: fakeFetch, requests };
}

export interface ServedRest {
  url: string;
  close(): Promise<void>;
}

/** The same stand-in over HTTP on 127.0.0.1, for a keeper process started from the built bundle. */
export function serveRest(rest: FakeRest): Promise<ServedRest> {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        if (typeof value === 'string') headers.set(name, value);
        else if (Array.isArray(value)) for (const item of value) headers.append(name, item);
      }
      const body = chunks.length === 0 ? undefined : Buffer.concat(chunks).toString('utf8');
      rest
        .fetch(`${rest.url}${request.url ?? '/'}`, { method: request.method ?? 'GET', headers, ...(body === undefined ? {} : { body }) })
        .then(async (answer) => {
          response.writeHead(answer.status, { 'content-type': answer.headers.get('content-type') ?? 'application/json' });
          response.end(await answer.text());
        })
        .catch((error: unknown) => {
          response.writeHead(500, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ message: error instanceof Error ? error.message : String(error) }));
        });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise((done) => server.close(() => done())) });
    });
  });
}
