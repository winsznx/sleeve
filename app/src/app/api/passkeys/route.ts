import { CREDENTIAL_ID, findPasskey, parsePasskeyRow, savePasskey, serviceSupabase } from '@/lib/chain/server-records';

/**
 * Sleeve's passkey records (zerodev-passkey.md 6.4, D-003): a synced passkey gives back its credential id and never
 * its public key, so sign-in on a new device looks the key and the account up here. Every field is public data (the
 * validator emits the key and the account when the account deploys), so reads need no session. Writes are insert
 * only, and sign-in rebuilds the account from the stored key, so a wrong record cannot send anyone to another account.
 *
 * 501 while the server has no Supabase service key: the browser then keeps records itself, for development.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

function notConfigured(): Response {
  return Response.json({ error: 'Passkey records need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the server.' }, { status: 501, headers: NO_STORE });
}

export async function GET(request: Request): Promise<Response> {
  const credentialId = new URL(request.url).searchParams.get('credentialId') ?? '';
  if (!CREDENTIAL_ID.test(credentialId)) {
    return Response.json({ error: 'Send credentialId as a base64url credential id.' }, { status: 400, headers: NO_STORE });
  }
  const config = serviceSupabase();
  if (config === null) return notConfigured();
  const record = await findPasskey(config, credentialId);
  if (record === null) return Response.json({ error: 'No record for this passkey.' }, { status: 404, headers: NO_STORE });
  return Response.json(record, { headers: NO_STORE });
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'The body must be JSON.' }, { status: 400, headers: NO_STORE });
  }
  const record = parsePasskeyRow(body);
  if (record === null) {
    return Response.json(
      { error: 'Send credentialId, publicKey as 0x04 then x and y, rpId as a host name, and accountAddress.' },
      { status: 400, headers: NO_STORE },
    );
  }
  const config = serviceSupabase();
  if (config === null) return notConfigured();
  const saved = await savePasskey(config, record);
  if (saved === 'conflict') {
    return Response.json({ error: 'A different record already holds this credential id.' }, { status: 409, headers: NO_STORE });
  }
  return Response.json({ saved }, { status: saved === 'created' ? 201 : 200, headers: NO_STORE });
}
