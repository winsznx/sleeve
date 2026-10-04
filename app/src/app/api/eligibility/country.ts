import { countryCode } from '@/lib/eligibility';

/** The country Cloudflare resolves from the request IP and sets on every request it serves (D-033). */
export const COUNTRY_HEADER = 'cf-ipcountry';

/** Cloudflare's code for an address it cannot place. It means no country, so it never matches a restricted one. */
const UNKNOWN_COUNTRY = 'XX';

/**
 * Lets a local run or a preview stand in for a country, since a laptop has no Cloudflare edge in front of it: set
 * ELIGIBILITY_IP_COUNTRY=GB to see the restricted page, NG for an eligible one. A production deploy ignores it, so
 * a stray value can never switch the check off.
 */
export const COUNTRY_OVERRIDE_ENV = 'ELIGIBILITY_IP_COUNTRY';

export interface CountryEnv {
  /** "production" on the deployed worker (wrangler.jsonc) and in its build. */
  SLEEVE_ENV?: string;
  ELIGIBILITY_IP_COUNTRY?: string;
}

export type CountrySource = 'header' | 'override' | 'none';

/**
 * The request's country and where it came from. Only the country header is read: never x-forwarded-for,
 * cf-connecting-ip or any other header that carries the IP itself, so no raw IP reaches Sleeve's code, its logs or
 * its answer.
 */
export function requestCountry(headers: Headers, env: CountryEnv): { country: string | null; source: CountrySource } {
  const override = env.SLEEVE_ENV === 'production' ? null : countryCode(env.ELIGIBILITY_IP_COUNTRY);
  if (override !== null) return { country: override, source: 'override' };
  const fromHeader = countryCode(headers.get(COUNTRY_HEADER));
  return fromHeader === null || fromHeader === UNKNOWN_COUNTRY ? { country: null, source: 'none' } : { country: fromHeader, source: 'header' };
}
