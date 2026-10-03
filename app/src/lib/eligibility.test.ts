import { describe, expect, it } from 'vitest';

import { lintText } from '../../../scripts/copy-lint.mjs';
import { COUNTRIES, countryName } from './countries';
import { countryCode, evaluateEligibility, parseEligibilityInput, parseEligibilityResult } from './eligibility';
import { PROHIBITED_JURISDICTIONS, RESTRICTED_JURISDICTIONS } from './jurisdictions';
import {
  CONTRACT_WALLET_LINE,
  NO_RECOVERY_LINE,
  PASSKEY_SITE_LINE,
  RECOVERY_WALLET_LINE,
  signerApprovalLine,
  signerKindOf,
  WALLET_OWNER_LINE,
} from './signer';

describe('countries', () => {
  it('lists every country once, sorted by name, including each blocked jurisdiction', () => {
    const codes = COUNTRIES.map(([code]) => code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.length).toBe(250);
    const names = COUNTRIES.map(([, name]) => name);
    expect([...names].sort((a, b) => a.localeCompare(b, 'en'))).toEqual(names);
    for (const code of [...Object.keys(PROHIBITED_JURISDICTIONS), ...Object.keys(RESTRICTED_JURISDICTIONS)]) {
      expect(codes).toContain(code);
    }
    expect(countryName('ng')).toBe('Nigeria');
    for (const name of names) expect(lintText(name)).toEqual([]);
  });
});

describe('eligibility', () => {
  it('reads two letter codes only', () => {
    expect(countryCode(' ng ')).toBe('NG');
    expect(countryCode('Nigeria')).toBeNull();
    expect(countryCode(null)).toBeNull();
  });

  it('lets a resident of Nigeria through from an unknown country, and blocks by residence and by IP', () => {
    expect(evaluateEligibility({ residence: 'NG', notUsPerson: true, notSanctioned: true }, null)).toEqual({
      eligible: true,
      ipCountry: null,
      blocks: [],
    });
    expect(evaluateEligibility({ residence: 'NG', notUsPerson: true, notSanctioned: true }, 'us').blocks).toEqual([
      { kind: 'IP_RESTRICTED', country: 'US' },
    ]);
    expect(evaluateEligibility({ residence: 'SD', notUsPerson: true, notSanctioned: true }, null).blocks).toEqual([
      { kind: 'RESIDENCE_PROHIBITED', country: 'SD' },
    ]);
  });

  it('parses only well formed attestations and answers', () => {
    expect(parseEligibilityInput({ residence: 'NG', notUsPerson: true, notSanctioned: false })).toEqual({
      residence: 'NG',
      notUsPerson: true,
      notSanctioned: false,
    });
    expect(parseEligibilityInput({ residence: 'NG', notUsPerson: 'true', notSanctioned: true })).toBeNull();
    expect(parseEligibilityInput(null)).toBeNull();
    const result = evaluateEligibility({ residence: 'GB', notUsPerson: false, notSanctioned: true }, 'GB');
    expect(parseEligibilityResult(JSON.parse(JSON.stringify(result)))).toEqual(result);
    expect(parseEligibilityResult({ eligible: true, ipCountry: null, blocks: [{ kind: 'US_PERSON' }] })).toBeNull();
    expect(parseEligibilityResult({ eligible: true, ipCountry: 'Nigeria', blocks: [] })).toBeNull();
  });
});

describe('signer words', () => {
  it('tells a wallet session from a passkey one the way the shell does', () => {
    expect(signerKindOf({ credentialId: '' })).toBe('wallet');
    expect(signerKindOf({ credentialId: 'pQ7v' })).toBe('passkey');
    expect(signerKindOf(null)).toBe('passkey');
  });

  it('passes the copy lint', () => {
    const lines = [
      signerApprovalLine('passkey'),
      signerApprovalLine('wallet'),
      PASSKEY_SITE_LINE,
      WALLET_OWNER_LINE,
      RECOVERY_WALLET_LINE,
      NO_RECOVERY_LINE,
      CONTRACT_WALLET_LINE,
    ];
    for (const line of lines) expect(lintText(line)).toEqual([]);
  });
});
