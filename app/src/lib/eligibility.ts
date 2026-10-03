import type { EligibilityBlock, EligibilityInput, EligibilityResult } from '@/data/types';

import { jurisdictionBlock } from './jurisdictions';

/**
 * Who may set up Sleeve (PRD 3 and 7.12, D-014): a residency attestation plus the country of the request's IP.
 * Restricted and prohibited jurisdictions are blocked from onboarding only; checking a split stays open to anyone.
 * Sleeve cannot enforce this onchain, because Stock Tokens move freely, and it does not claim to.
 */

const COUNTRY_CODE = /^[A-Za-z]{2}$/;

/** An ISO 3166-1 alpha-2 code in capitals, or null for anything else. */
export function countryCode(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return COUNTRY_CODE.test(trimmed) ? trimmed.toUpperCase() : null;
}

/** Every reason the input and the IP country block onboarding, residence first. */
export function eligibilityBlocks(input: EligibilityInput, ipCountry: string | null): EligibilityBlock[] {
  const residence = countryCode(input.residence);
  if (residence === null) throw new RangeError(`residence must be an ISO 3166-1 alpha-2 code, got ${input.residence}`);
  const blocks: EligibilityBlock[] = [];
  const byResidence = jurisdictionBlock(residence);
  if (byResidence === 'PROHIBITED') blocks.push({ kind: 'RESIDENCE_PROHIBITED', country: residence });
  if (byResidence === 'RESTRICTED') blocks.push({ kind: 'RESIDENCE_RESTRICTED', country: residence });
  const byIp = ipCountry === null ? null : jurisdictionBlock(ipCountry);
  if (ipCountry !== null && byIp === 'PROHIBITED') blocks.push({ kind: 'IP_PROHIBITED', country: ipCountry });
  if (ipCountry !== null && byIp === 'RESTRICTED') blocks.push({ kind: 'IP_RESTRICTED', country: ipCountry });
  if (!input.notUsPerson) blocks.push({ kind: 'US_PERSON' });
  if (!input.notSanctioned) blocks.push({ kind: 'SANCTIONS' });
  return blocks;
}

export function evaluateEligibility(input: EligibilityInput, ipCountry: string | null): EligibilityResult {
  const country = countryCode(ipCountry);
  const blocks = eligibilityBlocks(input, country);
  return { eligible: blocks.length === 0, ipCountry: country, blocks };
}

/** The request body the eligibility route takes, checked field by field. Null when it is not one. */
export function parseEligibilityInput(value: unknown): EligibilityInput | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const { residence, notUsPerson, notSanctioned } = record;
  if (typeof residence !== 'string' || countryCode(residence) === null) return null;
  if (typeof notUsPerson !== 'boolean' || typeof notSanctioned !== 'boolean') return null;
  return { residence, notUsPerson, notSanctioned };
}

/** Parses the route's answer back into an EligibilityResult, refusing anything that is not one. */
export function parseEligibilityResult(value: unknown): EligibilityResult | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const { eligible, ipCountry, blocks } = record;
  if (typeof eligible !== 'boolean' || !Array.isArray(blocks)) return null;
  if (ipCountry !== null && countryCode(typeof ipCountry === 'string' ? ipCountry : null) === null) return null;
  const parsed: EligibilityBlock[] = [];
  for (const block of blocks) {
    const next = parseBlock(block);
    if (next === null) return null;
    parsed.push(next);
  }
  if (eligible !== (parsed.length === 0)) return null;
  return { eligible, ipCountry: ipCountry === null ? null : (ipCountry as string), blocks: parsed };
}

function parseBlock(value: unknown): EligibilityBlock | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  switch (record.kind) {
    case 'US_PERSON':
    case 'SANCTIONS':
      return { kind: record.kind };
    case 'RESIDENCE_PROHIBITED':
    case 'RESIDENCE_RESTRICTED':
    case 'IP_PROHIBITED':
    case 'IP_RESTRICTED': {
      const country = countryCode(typeof record.country === 'string' ? record.country : null);
      return country === null ? null : { kind: record.kind, country };
    }
    default:
      return null;
  }
}
