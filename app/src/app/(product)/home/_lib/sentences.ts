import { TOTAL_BPS, formatBps, type Rule } from '@sleeve/core';

import { tickerSymbol } from '@/components/sleeve/text';
import { isDataLayerError } from '@/data/errors';

/**
 * Plain words for the owner screens, built from the rule's own numbers. Every string passes the copy lint
 * (scripts/copy-lint.mjs): no share as a noun, no performance words, no dashes.
 */

function splitWords(equityBps: number, symbol: string): string {
  if (equityBps <= 0) return 'all of it stays spendable';
  if (equityBps >= TOTAL_BPS) return `all of it buys ${symbol} Stock Tokens into your own account`;
  return `${formatBps(TOTAL_BPS - equityBps)} stays spendable and ${formatBps(equityBps)} buys ${symbol} Stock Tokens into your own account`;
}

/** The sentence under the home title (PRD 15): what the owner's rule does with every payment. */
export function ruleSentence(rule: Rule): string {
  switch (rule.status) {
    case 'ACTIVE':
      return `When you get paid, ${splitWords(rule.equityBps, tickerSymbol(rule.tickerId))}.`;
    case 'PAUSED':
      return 'Your rule is paused, so new USDG stays unsorted and spendable until you resume it.';
    case 'NONE':
      return 'You have no rule yet, so nothing is split. Set one and part of every payment buys Stock Tokens into your own account, while the rest stays spendable.';
  }
}

/** Owner writes these screens start. Each failure message names what to do next. */
export type OwnerAction = 'release' | 'sort';

/** Why an owner write failed, in plain words, for the line under "did not go through" (PRD 15, Error). */
export function failureText(error: Error, action: OwnerAction): string {
  if (!isDataLayerError(error)) return 'Try again in a moment.';
  switch (error.code) {
    case 'PasskeyCancelled':
      return 'The passkey prompt closed before you approved it.';
    case 'NotSignedIn':
      return 'You are signed out. Sign in, then try again.';
    case 'SourceUnavailable':
      return 'Sleeve could not reach Robinhood Chain. Try again in a moment.';
    case 'NothingWaiting':
      return action === 'release'
        ? 'Nothing is waiting there any more. It may have been bought or moved to spend already.'
        : 'Nothing is waiting to be sorted any more.';
    case 'RuleNotActive':
      return 'Your rule is not active, so nothing can be sorted until you resume it.';
    default:
      return 'Try again in a moment.';
  }
}

/** Why a passkey sign in failed. A closed prompt and a device without the passkey look the same to the page. */
export function signInFailureText(error: Error): string {
  return isDataLayerError(error) && error.code === 'PasskeyCancelled'
    ? 'Your passkey did not sign you in. Try again, or set up Sleeve if you are new here.'
    : 'Sign in did not go through. Try again in a moment.';
}
