import { RULE_DEFAULTS, type RuleInput } from '@sleeve/core';
import { describe, expect, it } from 'vitest';

import type { EligibilityBlock, Session } from '@/data/types';

import { lintText } from '../../../../../../scripts/copy-lint.mjs';
import {
  blockSentence,
  canOpen,
  countryPhrase,
  INITIAL_STATE,
  joinedPlaces,
  onboardReducer,
  recoverySummary,
  ruleSummary,
  signerSummary,
  type ChosenSigner,
  type OnboardState,
} from './onboarding';

const PASSKEY: ChosenSigner = { kind: 'passkey', credential: { credentialId: 'abc', rpId: 'localhost', ceremony: 'webauthn' } };
const WALLET: ChosenSigner = { kind: 'wallet', address: '0x05a1C0FfEE00000000000000000000000000b92D' };
const RULE: RuleInput = { ...RULE_DEFAULTS };
const SESSION: Session = { account: '0x00000000000000000000000000000000000000aa', credentialId: 'abc', signedInAt: 1n };

function through(...actions: Parameters<typeof onboardReducer>[1][]): OnboardState {
  return actions.reduce(onboardReducer, INITIAL_STATE);
}

describe('onboardReducer', () => {
  it('walks eligibility, signer, recovery, rule and the account in order', () => {
    const state = through(
      { type: 'eligible', residence: 'NG' },
      { type: 'signer', signer: PASSKEY },
      { type: 'recovery', recovery: { kind: 'none' } },
      { type: 'rule', rule: RULE },
    );
    expect(state.step).toBe('create');
    expect(onboardReducer(state, { type: 'created', session: SESSION }).session).toEqual(SESSION);
  });

  it('skips the recovery wallet for an account a wallet owns, which can recover itself', () => {
    const state = through({ type: 'eligible', residence: 'NG' }, { type: 'signer', signer: WALLET });
    expect([state.step, state.recovery]).toEqual(['rule', { kind: 'not-needed' }]);
    // #and switching back to a passkey asks the recovery question again
    expect(onboardReducer(state, { type: 'signer', signer: PASSKEY }).recovery).toBeNull();
  });

  it('opens only steps whose earlier steps are done, and none once the account exists', () => {
    const early = through({ type: 'eligible', residence: 'NG' });
    expect(canOpen(early, 'signer')).toBe(true);
    expect(canOpen(early, 'rule')).toBe(false);
    expect(onboardReducer(early, { type: 'goto', step: 'create' })).toBe(early);
    const done = onboardReducer(through({ type: 'eligible', residence: 'NG' }), { type: 'created', session: SESSION });
    expect(canOpen(done, 'eligibility')).toBe(false);
  });
});

describe('words', () => {
  it('names each block in plain words, with articles where a country takes one', () => {
    const blocks: EligibilityBlock[] = [
      { kind: 'RESIDENCE_PROHIBITED', country: 'RU' },
      { kind: 'RESIDENCE_RESTRICTED', country: 'US' },
      { kind: 'IP_PROHIBITED', country: 'MM' },
      { kind: 'IP_RESTRICTED', country: 'VG' },
      { kind: 'US_PERSON' },
      { kind: 'SANCTIONS' },
    ];
    expect(blocks.map(blockSentence)).toEqual([
      'You live in Russia, where the issuer does not offer Stock Tokens.',
      'You live in the United States, where the issuer restricts offers of Stock Tokens.',
      'Your connection comes from Myanmar, where the issuer does not offer Stock Tokens.',
      'Your connection comes from the British Virgin Islands, where the issuer restricts offers of Stock Tokens.',
      'Stock Tokens are not offered to US persons.',
      'Sleeve cannot be used by anyone subject to sanctions.',
    ]);
    for (const sentence of blocks.map(blockSentence)) expect(lintText(sentence)).toEqual([]);
  });

  it('joins places as a reader says them', () => {
    expect(joinedPlaces(['US', 'CA', 'GB'])).toBe('the United States, Canada or the United Kingdom');
    expect(joinedPlaces(['NG'])).toBe('Nigeria');
    expect(countryPhrase('ng')).toBe('Nigeria');
  });

  it('sums up each finished step in one line', () => {
    expect(signerSummary(PASSKEY)).toBe('Passkey for localhost');
    expect(signerSummary(WALLET)).toBe('Wallet 0x05a1…b92D');
    expect(recoverySummary({ kind: 'none' })).toBe('Skipped. You can add one later.');
    expect(recoverySummary({ kind: 'not-needed' })).toBe('Not needed: your wallet owns the account');
    expect(ruleSummary(RULE)).toBe('10% of each payment buys SPY, cap 1.00 percent, minimum 25 USDG');
  });
});
