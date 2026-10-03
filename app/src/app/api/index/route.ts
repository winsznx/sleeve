import { STATUSES } from '@sleeve/core';

import { indexedInbox, indexedReceipt, indexedReceipts, indexedTo } from '@/lib/chain/server-index';
import { serviceSupabase } from '@/lib/chain/server-records';

/**
 * The keeper's index of the module (supabase/README.md) for the browser: an account's receipts a page at a time, one
 * receipt, or the inbox. Everything here is public chain data, read with the service role because the payments, rule
 * versions and reconciliations tables are closed to the anon key. Each answer carries `indexedTo`, the last L2 block
 * the index has read, so the data layer can read the chain instead when the index is behind. 501 until the server has
 * the Supabase key; the data layer then reads the chain.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const UINT = /^\d{1,78}$/;
const MAX_PAGE = 100;

function answer(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: NO_STORE });
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const config = serviceSupabase();
  if (config === null) return answer(501, 'The index needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the server.');
  const cursor = await indexedTo(config);
  if (cursor === null) return answer(503, 'The keeper has not indexed the module yet.');

  switch (params.get('view')) {
    case 'receipts': {
      const account = params.get('account') ?? '';
      const tickerId = params.get('tickerId');
      const status = params.get('status');
      const before = params.get('before');
      const limit = Number(params.get('limit') ?? '20');
      const valid =
        ADDRESS.test(account) &&
        (tickerId === null || /^\d{1,3}$/.test(tickerId)) &&
        (status === null || (STATUSES as readonly string[]).includes(status)) &&
        (before === null || UINT.test(before)) &&
        Number.isInteger(limit) &&
        limit >= 1 &&
        limit <= MAX_PAGE;
      if (!valid) return answer(400, 'Send account, and optionally tickerId, status, before and limit from 1 to 100.');
      const page = await indexedReceipts(config, { account, tickerId: tickerId === null ? null : Number(tickerId), status, before, limit });
      return Response.json({ indexedTo: cursor, ...page }, { headers: NO_STORE });
    }
    case 'receipt': {
      const id = params.get('id') ?? '';
      if (!UINT.test(id)) return answer(400, 'Send id as a receipt id.');
      return Response.json({ indexedTo: cursor, receipt: await indexedReceipt(config, id) }, { headers: NO_STORE });
    }
    case 'inbox': {
      const account = params.get('account') ?? '';
      if (!ADDRESS.test(account)) return answer(400, 'Send account as an address.');
      return Response.json({ indexedTo: cursor, payments: await indexedInbox(config, account) }, { headers: NO_STORE });
    }
    default:
      return answer(400, 'Send view as receipts, receipt or inbox.');
  }
}
