/**
 * Where onboarding is blocked, by ISO 3166-1 alpha-2 code. From the issuer's restricted jurisdictions page and
 * Base Prospectus as read on 2 October 2026 (docs/research/issuer-docs.md section 2), plus the British Virgin
 * Islands under D-014. The issuer can change these lists, so they are re-read at every release (PRD 3).
 */
export const PROHIBITED_JURISDICTIONS = {
  CU: 'Cuba',
  BY: 'Belarus',
  IR: 'Iran',
  KP: 'North Korea',
  RU: 'Russia',
  SY: 'Syria',
  UA: 'Ukraine',
  SS: 'South Sudan',
  SD: 'Sudan',
  MM: 'Myanmar',
  VE: 'Venezuela',
} as const;

export const RESTRICTED_JURISDICTIONS = {
  US: 'United States',
  CA: 'Canada',
  GB: 'United Kingdom',
  CH: 'Switzerland',
  VG: 'British Virgin Islands',
} as const;

export type JurisdictionBlock = 'PROHIBITED' | 'RESTRICTED';

export function jurisdictionBlock(countryCode: string): JurisdictionBlock | null {
  const code = countryCode.trim().toUpperCase();
  if (Object.hasOwn(PROHIBITED_JURISDICTIONS, code)) return 'PROHIBITED';
  if (Object.hasOwn(RESTRICTED_JURISDICTIONS, code)) return 'RESTRICTED';
  return null;
}
