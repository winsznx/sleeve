import type { Address, Hex } from 'viem';

/**
 * Who is signed in, and the passkey records sign-in needs. A session holds only public data: the account, how its
 * owner signs, and for a passkey its credential id and public key. Nothing here can sign; every owner op asks the
 * passkey or the wallet again.
 *
 * Passkey records go to Sleeve's server route, which writes Supabase with the service role (zerodev-passkey.md 6.4,
 * the passkey_credentials table). While the server has no Supabase key the route answers 501, and records stay in
 * this browser's storage for development, so a passkey then signs in only on the device that made it.
 */

export type SessionSigner =
  | { kind: 'passkey'; credentialId: string; rpId: string; publicKey: Hex }
  | { kind: 'wallet'; owner: Address };

export interface StoredSession {
  account: Address;
  signer: SessionSigner;
  /** Unix seconds as a decimal string: JSON has no bigint. */
  signedInAt: string;
}

export interface SessionStore {
  read(): StoredSession | null;
  write(session: StoredSession | null): void;
}

const SESSION_KEY = 'sleeve:chain-session';
const RECORDS_KEY = 'sleeve:passkey-records';

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isSession(value: unknown): value is StoredSession {
  if (typeof value !== 'object' || value === null) return false;
  const session = value as Partial<StoredSession>;
  const signer = session.signer as Partial<SessionSigner> | undefined;
  return (
    typeof session.account === 'string' &&
    typeof session.signedInAt === 'string' &&
    signer !== undefined &&
    (signer.kind === 'passkey' || signer.kind === 'wallet')
  );
}

/** localStorage when it works; memory for the tab when it does not (a private window, blocked storage). */
export function browserSessionStore(): SessionStore {
  let memory: StoredSession | null = null;
  return {
    read() {
      const store = storage();
      if (store === null) return memory;
      try {
        const raw = store.getItem(SESSION_KEY);
        const parsed: unknown = raw === null ? null : JSON.parse(raw);
        return isSession(parsed) ? parsed : memory;
      } catch {
        return memory;
      }
    },
    write(session) {
      memory = session;
      const store = storage();
      if (store === null) return;
      try {
        if (session === null) store.removeItem(SESSION_KEY);
        else store.setItem(SESSION_KEY, JSON.stringify(session));
      } catch {
        // Storage refused the write (quota or policy): the session lasts for this tab only, as `memory` holds it.
      }
    },
  };
}

export function memorySessionStore(initial: StoredSession | null = null): SessionStore {
  let session = initial;
  return {
    read: () => session,
    write(next) {
      session = next;
    },
  };
}

/** A passkey's public record: what the passkey_credentials table holds. */
export interface PasskeyRecord {
  credentialId: string;
  /** SEC1 uncompressed P-256 key, 0x04 then x and y. */
  publicKey: Hex;
  rpId: string;
  accountAddress: Address;
}

export interface CredentialStore {
  save(record: PasskeyRecord): Promise<void>;
  find(credentialId: string): Promise<PasskeyRecord | null>;
}

export const PASSKEY_ROUTE = '/api/passkeys';

function readLocalRecords(): Record<string, PasskeyRecord> {
  const store = storage();
  if (store === null) return {};
  try {
    const parsed: unknown = JSON.parse(store.getItem(RECORDS_KEY) ?? '{}');
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, PasskeyRecord>) : {};
  } catch {
    return {};
  }
}

/** Records in this browser's storage only: development without Supabase, and tests. */
export function localCredentialStore(): CredentialStore {
  const memory = new Map<string, PasskeyRecord>();
  return {
    async save(record) {
      memory.set(record.credentialId, record);
      const store = storage();
      if (store === null) return;
      const records = { ...readLocalRecords(), [record.credentialId]: record };
      try {
        store.setItem(RECORDS_KEY, JSON.stringify(records));
      } catch {
        // Storage refused the write: the record lives in `memory` for this tab, and sign-in elsewhere needs Supabase.
      }
    },
    async find(credentialId) {
      return memory.get(credentialId) ?? readLocalRecords()[credentialId] ?? null;
    },
  };
}

/**
 * The server route first. A 501 means the server has no Supabase service key: records then stay in this browser,
 * which is the development setup the env template describes. Any other failure is an error.
 */
export function routeCredentialStore(fetcher: typeof fetch = (input, init) => fetch(input, init)): CredentialStore {
  const local = localCredentialStore();
  return {
    async save(record) {
      const response = await fetcher(PASSKEY_ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(record),
        cache: 'no-store',
      });
      if (response.status === 501) return local.save(record);
      if (!response.ok) throw new Error(`The passkey record was not saved: ${response.status}`);
      await local.save(record);
    },
    async find(credentialId) {
      const fromLocal = await local.find(credentialId);
      if (fromLocal !== null) return fromLocal;
      const response = await fetcher(`${PASSKEY_ROUTE}?credentialId=${encodeURIComponent(credentialId)}`, { cache: 'no-store' });
      if (response.status === 501 || response.status === 404) return null;
      if (!response.ok) throw new Error(`The passkey record did not load: ${response.status}`);
      return (await response.json()) as PasskeyRecord;
    },
  };
}
