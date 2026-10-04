import type { Address, Hex } from 'viem';

/**
 * Server only. Supabase's REST API with the service role, for the records the app writes itself: passkey
 * credentials, shared cards and the waitlist (supabase/migrations, passkey_credentials, cards and waitlist). Row level
 * security gives anon nothing on these tables, so only these server paths read or write them. The key is read from the server's
 * environment at call time and never reaches a browser bundle as a value.
 */

export interface ServiceSupabase {
  url: string;
  key: string;
}

/** Null until both NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set on the server. */
export function serviceSupabase(): ServiceSupabase | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '';
  return url === '' || key === '' ? null : { url: url.replace(/\/+$/, ''), key };
}

async function rest(config: ServiceSupabase, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${config.url}/rest/v1/${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      apikey: config.key,
      authorization: `Bearer ${config.key}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

export class SupabaseWriteError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Supabase answered ${status}: ${body}`);
    this.name = 'SupabaseWriteError';
  }
}

export interface PasskeyRow {
  credentialId: string;
  publicKey: Hex;
  rpId: string;
  accountAddress: Address;
}

export async function findPasskey(config: ServiceSupabase, credentialId: string): Promise<PasskeyRow | null> {
  const response = await rest(
    config,
    `passkey_credentials?credential_id=eq.${encodeURIComponent(credentialId)}&select=credential_id,public_key,rp_id,account_address`,
  );
  if (!response.ok) throw new SupabaseWriteError(response.status, await response.text());
  const rows = (await response.json()) as { credential_id: string; public_key: Hex; rp_id: string; account_address: Address }[];
  const row = rows[0];
  return row === undefined
    ? null
    : { credentialId: row.credential_id, publicKey: row.public_key, rpId: row.rp_id, accountAddress: row.account_address };
}

/** Insert only. A second save of the same record is fine; a different record under the same id is a conflict. */
export async function savePasskey(config: ServiceSupabase, record: PasskeyRow): Promise<'created' | 'exists' | 'conflict'> {
  const row = {
    credential_id: record.credentialId,
    public_key: record.publicKey.toLowerCase(),
    rp_id: record.rpId.toLowerCase(),
    account_address: record.accountAddress.toLowerCase(),
  };
  const response = await rest(config, 'passkey_credentials', {
    method: 'POST',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify(row),
  });
  if (response.ok) return 'created';
  if (response.status !== 409) throw new SupabaseWriteError(response.status, await response.text());
  const existing = await findPasskey(config, record.credentialId);
  const same =
    existing !== null &&
    existing.publicKey.toLowerCase() === row.public_key &&
    existing.rpId === row.rp_id &&
    existing.accountAddress.toLowerCase() === row.account_address;
  return same ? 'exists' : 'conflict';
}

export interface CardRow {
  cardId: string;
  account: Address;
  receiptId: string | null;
  weekStart: string | null;
  showAmounts: boolean;
  showProof: boolean;
}

export async function findCardRow(config: ServiceSupabase, cardId: string): Promise<CardRow | null> {
  const response = await rest(config, `cards?card_id=eq.${encodeURIComponent(cardId)}&select=card_id,account,receipt_id,week_start,options`);
  if (!response.ok) throw new SupabaseWriteError(response.status, await response.text());
  const rows = (await response.json()) as {
    card_id: string;
    account: Address;
    receipt_id: number | string | null;
    week_start: number | string | null;
    options: { showAmounts?: boolean; showProof?: boolean };
  }[];
  const row = rows[0];
  if (row === undefined) return null;
  return {
    cardId: row.card_id,
    account: row.account,
    receiptId: row.receipt_id === null ? null : String(row.receipt_id),
    weekStart: row.week_start === null ? null : String(row.week_start),
    showAmounts: row.options.showAmounts === true,
    showProof: row.options.showProof === true,
  };
}

export async function saveCardRow(config: ServiceSupabase, card: CardRow): Promise<void> {
  const response = await rest(config, 'cards', {
    method: 'POST',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify({
      card_id: card.cardId,
      account: card.account.toLowerCase(),
      receipt_id: card.receiptId,
      week_start: card.weekStart === null ? null : Number(card.weekStart),
      options: { showAmounts: card.showAmounts, showProof: card.showProof },
    }),
  });
  if (!response.ok) throw new SupabaseWriteError(response.status, await response.text());
}

export interface WaitlistRow {
  email: string;
  paidWith: string | null;
  /** ISO 3166 alpha-2, or null when Cloudflare could not tell. */
  country: string | null;
  source: string;
}

/** Adds a person to the waitlist. Joining again with the same email changes nothing and is not an error. */
export async function saveWaitlistEntry(config: ServiceSupabase, row: WaitlistRow): Promise<void> {
  const response = await rest(config, 'waitlist?on_conflict=email', {
    method: 'POST',
    headers: { prefer: 'return=minimal,resolution=ignore-duplicates' },
    body: JSON.stringify({ email: row.email, paid_with: row.paidWith, country: row.country, source: row.source }),
  });
  if (!response.ok) throw new SupabaseWriteError(response.status, await response.text());
}

export const CREDENTIAL_ID = /^[A-Za-z0-9_-]{22,1364}$/;
const PUBLIC_KEY = /^0x04[0-9a-fA-F]{128}$/;
const RP_ID = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** A passkey record from a request body, or null when any field is malformed. */
export function parsePasskeyRow(body: unknown): PasskeyRow | null {
  if (typeof body !== 'object' || body === null) return null;
  const record = body as Record<string, unknown>;
  const { credentialId, publicKey, rpId, accountAddress } = record;
  if (typeof credentialId !== 'string' || !CREDENTIAL_ID.test(credentialId)) return null;
  if (typeof publicKey !== 'string' || !PUBLIC_KEY.test(publicKey)) return null;
  if (typeof rpId !== 'string' || rpId.length > 253 || !RP_ID.test(rpId)) return null;
  if (typeof accountAddress !== 'string' || !ADDRESS.test(accountAddress)) return null;
  return { credentialId, publicKey: publicKey as `0x${string}`, rpId, accountAddress: accountAddress as `0x${string}` };
}
