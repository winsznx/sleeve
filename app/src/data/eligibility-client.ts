import { parseEligibilityResult } from '@/lib/eligibility';

import { DataLayerError } from './errors';
import type { EligibilityInput, EligibilityResult } from './types';

/** Where the server checks eligibility against the request's country (app/api/eligibility). */
export const ELIGIBILITY_ROUTE = '/api/eligibility';

/**
 * Asks the server, which reads the country Vercel resolves from the request IP. A failed check fails closed: the
 * screen says the check did not finish and offers it again, and onboarding never goes on without an answer.
 */
export async function checkEligibilityOnServer(
  input: EligibilityInput,
  fetcher: typeof fetch = fetch,
): Promise<EligibilityResult> {
  let response: Response;
  try {
    response = await fetcher(ELIGIBILITY_ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
      cache: 'no-store',
    });
  } catch {
    throw new DataLayerError({ code: 'SourceUnavailable' }, 'The eligibility check could not reach Sleeve');
  }
  const result = response.ok ? parseEligibilityResult(await response.json().catch(() => null)) : null;
  if (result === null) {
    throw new DataLayerError({ code: 'SourceUnavailable' }, `The eligibility check answered ${response.status}`);
  }
  return result;
}
