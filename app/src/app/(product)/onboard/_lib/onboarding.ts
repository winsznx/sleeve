import { formatBps, formatUsdg, shortAddress, type Address, type RuleInput } from '@sleeve/core';

import { percentWords, tickerSymbol } from '@/components/sleeve/text';
import type { EligibilityBlock, PasskeyCredential, Session } from '@/data/types';
import { countryName } from '@/lib/countries';
import { PROHIBITED_JURISDICTIONS, RESTRICTED_JURISDICTIONS } from '@/lib/jurisdictions';

/**
 * Onboarding as a sequence (PRD 7.12, D-003, D-014, D-022): where the person lives, how they sign, an optional recovery
 * wallet, the rule, then the account. The rule comes before the account because the module installs with it in the
 * account's first UserOp (SPEC 6, D-019): one approval, and no payment can arrive before the rule exists.
 */

export const STEPS = ['eligibility', 'signer', 'recovery', 'rule', 'create'] as const;
export type Step = (typeof STEPS)[number];

export type ChosenSigner = { kind: 'passkey'; credential: PasskeyCredential } | { kind: 'wallet'; address: Address };
export type ChosenRecovery = { kind: 'wallet'; address: Address } | { kind: 'none' } | { kind: 'not-needed' };

export interface OnboardState {
  step: Step;
  residence: string | null;
  signer: ChosenSigner | null;
  recovery: ChosenRecovery | null;
  rule: RuleInput | null;
  session: Session | null;
}

export const INITIAL_STATE: OnboardState = {
  step: 'eligibility',
  residence: null,
  signer: null,
  recovery: null,
  rule: null,
  session: null,
};

export type OnboardAction =
  | { type: 'eligible'; residence: string }
  | { type: 'signer'; signer: ChosenSigner }
  | { type: 'recovery'; recovery: ChosenRecovery }
  | { type: 'rule'; rule: RuleInput }
  | { type: 'created'; session: Session }
  | { type: 'goto'; step: Step };

function indexOf(step: Step): number {
  return STEPS.indexOf(step);
}

/** Whether a step can be opened: every step before it is done, and the account does not exist yet. */
export function canOpen(state: OnboardState, step: Step): boolean {
  if (state.session !== null) return false;
  const done: Record<Step, boolean> = {
    eligibility: state.residence !== null,
    signer: state.signer !== null,
    recovery: state.recovery !== null,
    rule: state.rule !== null,
    create: false,
  };
  return STEPS.slice(0, indexOf(step)).every((before) => done[before]);
}

export function onboardReducer(state: OnboardState, action: OnboardAction): OnboardState {
  switch (action.type) {
    case 'eligible':
      return { ...state, residence: action.residence, step: 'signer' };
    case 'signer':
      // A wallet owns its account and can recover it, so it needs no separate recovery wallet (wallet-connect.md 8).
      return action.signer.kind === 'wallet'
        ? { ...state, signer: action.signer, recovery: { kind: 'not-needed' }, step: 'rule' }
        : { ...state, signer: action.signer, recovery: state.recovery?.kind === 'not-needed' ? null : state.recovery, step: 'recovery' };
    case 'recovery':
      return { ...state, recovery: action.recovery, step: 'rule' };
    case 'rule':
      return { ...state, rule: action.rule, step: 'create' };
    case 'created':
      return { ...state, session: action.session };
    case 'goto':
      return canOpen(state, action.step) ? { ...state, step: action.step } : state;
  }
}

const JURISDICTION_NAMES: Record<string, string> = { ...PROHIBITED_JURISDICTIONS, ...RESTRICTED_JURISDICTIONS };

/** "the United Kingdom", "Nigeria": country names that read with an article get one. */
export function countryPhrase(code: string): string {
  const name = JURISDICTION_NAMES[code.toUpperCase()] ?? countryName(code);
  return ['US', 'GB', 'VG', 'AE', 'NL', 'PH', 'BS', 'GM', 'CF', 'CZ', 'DO', 'KY', 'MV', 'MH', 'SB', 'TC', 'VI', 'VA', 'UM'].includes(
    code.toUpperCase(),
  )
    ? `the ${name}`
    : name;
}

/** "the United States, Canada or the United Kingdom": places as a reader says them. */
export function joinedPlaces(codes: readonly string[]): string {
  const phrases = codes.map(countryPhrase);
  if (phrases.length <= 1) return phrases[0] ?? '';
  return `${phrases.slice(0, -1).join(', ')} or ${phrases[phrases.length - 1] ?? ''}`;
}

/** Why onboarding stops, one plain sentence per block. */
export function blockSentence(block: EligibilityBlock): string {
  switch (block.kind) {
    case 'RESIDENCE_PROHIBITED':
      return `You live in ${countryPhrase(block.country)}, where the issuer does not offer Stock Tokens.`;
    case 'RESIDENCE_RESTRICTED':
      return `You live in ${countryPhrase(block.country)}, where the issuer restricts offers of Stock Tokens.`;
    case 'IP_PROHIBITED':
      return `Your connection comes from ${countryPhrase(block.country)}, where the issuer does not offer Stock Tokens.`;
    case 'IP_RESTRICTED':
      return `Your connection comes from ${countryPhrase(block.country)}, where the issuer restricts offers of Stock Tokens.`;
    case 'US_PERSON':
      return 'Stock Tokens are not offered to US persons.';
    case 'SANCTIONS':
      return 'Sleeve cannot be used by anyone subject to sanctions.';
  }
}

/** The one-line summaries the stepper shows under a finished step. */
export function signerSummary(signer: ChosenSigner): string {
  return signer.kind === 'passkey'
    ? `Passkey for ${signer.credential.rpId}`
    : `Wallet ${shortAddress(signer.address)}`;
}

export function recoverySummary(recovery: ChosenRecovery): string {
  switch (recovery.kind) {
    case 'wallet':
      return `Recovery wallet ${shortAddress(recovery.address)}`;
    case 'none':
      return 'Skipped. You can add one later.';
    case 'not-needed':
      return 'Not needed: your wallet owns the account';
  }
}

export function ruleSummary(rule: RuleInput): string {
  return `${formatBps(rule.equityBps)} of each payment buys ${tickerSymbol(rule.tickerId)}, cap ${percentWords(rule.premiumCapBps)}, minimum ${formatUsdg(rule.minClip, { minFractionDigits: 0 })} USDG`;
}
