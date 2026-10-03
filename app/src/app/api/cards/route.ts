import { randomBytes } from 'node:crypto';

import { createChainContext, createReadClient } from '@/data/chain/context';
import { cardToJson, parseCardMessage, type StoredCard } from '@/data/chain/cards';
import { HistoryReader } from '@/data/chain/history';
import { readChainConfig } from '@/lib/chain/config';
import { SupabaseWriteError, findCardRow, saveCardRow, serviceSupabase } from '@/lib/chain/server-records';

/**
 * Shared cards on Robinhood Chain (PRD 7.10). A card is made only by the account that owns what it shows: the owner
 * signs the card's terms with the Sleeve account (ERC-1271 through Kernel), this route checks that signature on chain
 * and that a receipt card names one of the account's own buys, then stores it under a random opaque id. The id never
 * encodes the receipt or the account. Reads return only what the owner chose to show.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const CARD_ID = /^[A-Za-z0-9_-]{12,64}$/;
/** A signed card request is good for an hour of chain time either way. */
const FRESH_SECONDS = 3_600n;

function answer(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: NO_STORE });
}

export async function GET(request: Request): Promise<Response> {
  const cardId = new URL(request.url).searchParams.get('id') ?? '';
  if (!CARD_ID.test(cardId)) return answer(400, 'Send id as a card id.');
  const config = serviceSupabase();
  if (config === null) return answer(501, 'Cards need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the server.');
  const row = await findCardRow(config, cardId);
  if (row === null) return answer(404, 'No card has this id.');
  const card: StoredCard = {
    cardId: row.cardId,
    account: row.account,
    subject: row.receiptId !== null ? { kind: 'receipt', receiptId: BigInt(row.receiptId) } : { kind: 'week', weekStart: BigInt(row.weekStart ?? '0') },
    showAmounts: row.showAmounts,
    showProof: row.showProof,
  };
  return Response.json(cardToJson(card), { headers: NO_STORE });
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return answer(400, 'The body must be JSON.');
  }
  const fields = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const { message, signature, account } = fields;
  if (typeof message !== 'string' || typeof signature !== 'string' || !/^0x[0-9a-fA-F]+$/.test(signature) || typeof account !== 'string') {
    return answer(400, 'Send account, message and signature.');
  }
  const terms = parseCardMessage(message);
  if (terms === null || terms.account.toLowerCase() !== account.toLowerCase()) return answer(400, 'The message does not describe a card for this account.');

  const config = serviceSupabase();
  if (config === null) return answer(501, 'Cards need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the server.');

  const chain = readChainConfig();
  const client = createReadClient(chain);
  const issued = /^Issued: (\d+)$/m.exec(message)?.[1];
  const head = await client.getBlock({ blockTag: 'latest' });
  if (issued === undefined || BigInt(issued) + FRESH_SECONDS < head.timestamp || BigInt(issued) > head.timestamp + FRESH_SECONDS) {
    return answer(400, 'The card request is too old or from the future. Make the card again.');
  }
  const signed = await client.verifyMessage({ address: terms.account as `0x${string}`, message, signature: signature as `0x${string}` });
  if (!signed) return answer(403, 'The signature is not from this account.');

  if (terms.subject.kind === 'receipt') {
    const history = new HistoryReader(createChainContext(chain, client));
    const entry = await history.receiptLog(terms.subject.receiptId);
    const own = entry !== null && entry.receipt.account.toLowerCase() === terms.account.toLowerCase();
    if (!own || (entry.receipt.status !== 'FILLED' && entry.receipt.status !== 'SETTLED')) {
      return answer(404, 'A card shows one of your own buys.');
    }
  }

  const cardId = randomBytes(16).toString('base64url');
  try {
    await saveCardRow(config, {
      cardId,
      account: terms.account as `0x${string}`,
      receiptId: terms.subject.kind === 'receipt' ? terms.subject.receiptId.toString() : null,
      weekStart: terms.subject.kind === 'week' ? terms.subject.weekStart.toString() : null,
      showAmounts: terms.showAmounts,
      showProof: terms.showProof,
    });
  } catch (error) {
    // The cards table keys a receipt card to the keeper's index of the account and the receipt.
    if (error instanceof SupabaseWriteError && (error.status === 409 || error.status === 400)) {
      return answer(409, 'Sleeve has not indexed this account or receipt yet. Try again in a minute.');
    }
    throw error;
  }
  return Response.json({ cardId }, { status: 201, headers: NO_STORE });
}
