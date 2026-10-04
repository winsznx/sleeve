import { requestCountry } from '@/app/api/eligibility/country';
import { SupabaseWriteError, saveWaitlistEntry, serviceSupabase } from '@/lib/chain/server-records';
import { parseWaitlistRequest } from '@/lib/waitlist';

/**
 * Joins the waitlist (D-038). Stores the email, the optional answer about how the person is paid, the country
 * Cloudflare resolved from the request and where the form was opened. It answers the same whether the email was new
 * or already on the list, so the endpoint cannot be used to learn who signed up, and a filled honeypot gets that same
 * answer with nothing stored.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

function answer(status: number, body: object): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return answer(400, { error: 'The body must be JSON.' });
  }
  const parsed = parseWaitlistRequest(body);
  if (parsed.kind === 'invalid') return answer(400, { error: parsed.error });
  if (parsed.kind === 'trap') return answer(201, { joined: true });

  const config = serviceSupabase();
  if (config === null) return answer(501, { error: 'The waitlist needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the server.' });

  const { country } = requestCountry(request.headers, {
    SLEEVE_ENV: process.env.SLEEVE_ENV,
    ELIGIBILITY_IP_COUNTRY: process.env.ELIGIBILITY_IP_COUNTRY,
  });
  try {
    await saveWaitlistEntry(config, { ...parsed.entry, country });
  } catch (error) {
    if (error instanceof SupabaseWriteError) return answer(502, { error: 'The waitlist could not be saved. Try again in a minute.' });
    throw error;
  }
  return answer(201, { joined: true });
}
