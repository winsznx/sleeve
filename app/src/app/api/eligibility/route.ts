import { evaluateEligibility, parseEligibilityInput } from '@/lib/eligibility';

import { requestCountry } from './country';

/**
 * Onboarding's eligibility check (PRD 7.12, D-014): the residency attestation the person gives, plus the country
 * Cloudflare resolves from the request IP. The answer lists every block. Nothing is stored and no IP is read, so the
 * answer is the only thing that leaves, and it is never cached.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'The body must be JSON.' }, { status: 400, headers: NO_STORE });
  }
  const input = parseEligibilityInput(body);
  if (input === null) {
    return Response.json(
      { error: 'Send residence as a two letter country code, and notUsPerson and notSanctioned as true or false.' },
      { status: 400, headers: NO_STORE },
    );
  }
  const { country } = requestCountry(request.headers, {
    SLEEVE_ENV: process.env.SLEEVE_ENV,
    ELIGIBILITY_IP_COUNTRY: process.env.ELIGIBILITY_IP_COUNTRY,
  });
  return Response.json(evaluateEligibility(input, country), { headers: NO_STORE });
}
