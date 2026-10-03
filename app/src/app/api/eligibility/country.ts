import { countryCode } from '@/lib/eligibility';

/** The country Vercel's edge resolves from the request IP. Vercel sets it on every request it serves. */
export const COUNTRY_HEADER = 'x-vercel-ip-country';

/**
 * Lets a local run or a preview stand in for a country, since a laptop has no Vercel edge in front of it: set
 * ELIGIBILITY_IP_COUNTRY=GB to see the restricted page, NG for an eligible one. A production deploy ignores it, so
 * a stray value can never switch the check off.
 */
export const COUNTRY_OVERRIDE_ENV = 'ELIGIBILITY_IP_COUNTRY';

export interface CountryEnv {
  VERCEL_ENV?: string;
  ELIGIBILITY_IP_COUNTRY?: string;
}

export type CountrySource = 'header' | 'override' | 'none';

/**
 * The request's country and where it came from. Only the country header is read: never x-forwarded-for, x-real-ip
 * or any other header that carries the IP itself, so no raw IP reaches Sleeve's code, its logs or its answer.
 */
export function requestCountry(headers: Headers, env: CountryEnv): { country: string | null; source: CountrySource } {
  const override = env.VERCEL_ENV === 'production' ? null : countryCode(env.ELIGIBILITY_IP_COUNTRY);
  if (override !== null) return { country: override, source: 'override' };
  const fromHeader = countryCode(headers.get(COUNTRY_HEADER));
  return fromHeader === null ? { country: null, source: 'none' } : { country: fromHeader, source: 'header' };
}
