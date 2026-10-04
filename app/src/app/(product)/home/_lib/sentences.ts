import { TOTAL_BPS, formatBps, type Rule } from '@sleeve/core';

import { tickerSymbol } from '@/components/sleeve/text';
import { walletSigningFailureText } from '@/components/wallet/wallet-problems';
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

export interface HomeHeadline {
  /** The page's h1: what the rule does with a payment, short enough to read at a glance. */
  title: string;
  /** What happens to the rest, and what happens while the market is closed. */
  lede: string;
}

/**
 * Home's headline (PRD 1 and 15, D-024): the payday split as one sentence, in the rule's own numbers, with the off-hours
 * wait in the line under it.
 */
export function homeHeadline(rule: Rule): HomeHeadline {
  const symbol = tickerSymbol(rule.tickerId);
  const equity = formatBps(rule.equityBps);
  switch (rule.status) {
    case 'ACTIVE':
      if (rule.equityBps <= 0) {
        return { title: 'When you get paid, all of it stays spendable.', lede: 'Your rule buys no Stock Tokens right now. Set a share to start.' };
      }
      if (rule.equityBps >= TOTAL_BPS) {
        return {
          title: `When you get paid, all of it buys ${symbol}.`,
          lede: `${symbol} Stock Tokens go into your own account. When the market is closed, the payment waits as USDG and buys at the open.`,
        };
      }
      return {
        title: `When you get paid, ${equity} buys ${symbol}. The rest stays spendable.`,
        lede: `${symbol} Stock Tokens go into your own account. When the market is closed, the ${equity} waits as USDG and buys at the open.`,
      };
    case 'PAUSED':
      return {
        title: 'Your rule is paused.',
        lede: 'New payments stay unsorted and spendable USDG until you resume it. Nothing already split changes.',
      };
    case 'NONE':
      return {
        title: 'Set your rule to split every payment.',
        lede: 'Until then every payment stays spendable USDG. With a rule, part of each one buys a Stock Token into your own account.',
      };
  }
}

/** Owner writes these screens start. Each failure message names what to do next. */
export type HomeWrite = 'release' | 'sort' | 'buy' | 'send' | 'remove' | 'reinstall';

/** Why an owner write failed, in plain words, for the line under "did not go through" (PRD 15, Error). */
export function failureText(error: Error, action: HomeWrite): string {
  const wallet = walletSigningFailureText(error);
  if (wallet !== null) return wallet;
  if (!isDataLayerError(error)) return 'Try again in a moment.';
  switch (error.code) {
    case 'PasskeyCancelled':
      return 'The passkey prompt closed before you approved it.';
    case 'NotSignedIn':
      return 'You are signed out. Sign in, then try again.';
    case 'SourceUnavailable':
      return 'Sleeve could not reach Robinhood Chain. Try again in a moment.';
    case 'NothingWaiting':
      return action === 'sort'
        ? 'Nothing is waiting to be sorted any more.'
        : 'Nothing is waiting there any more. It may have been bought or moved to spend already.';
    case 'RuleNotActive':
      return 'Your rule is not active, so nothing can be sorted until you resume it.';
    case 'GuardNotClear':
      return error.detail.code === 'GuardNotClear' && error.detail.reason === 'SESSION'
        ? 'The market is closed, so it keeps waiting and buys after the open.'
        : 'The price check has not cleared, so it keeps waiting. Sleeve buys once it does.';
    case 'BelowClip':
      return 'The waiting amount is below your minimum buy, so it keeps waiting until more arrives.';
    case 'InsufficientBalance':
      return 'Your account holds less USDG than that now. Check what you can send and try a smaller amount.';
    case 'ZeroAmount':
      return 'Enter an amount above zero.';
    case 'SponsorshipUnavailable':
      return "Sleeve's paymaster did not cover this one, and your account holds too little ETH for the network fee.";
    case 'NotInstalled':
      return action === 'remove' ? 'Sleeve is already off for this account.' : 'Sleeve is off for this account. Turn it back on from Home first.';
    case 'ModuleInstalled':
      return 'Sleeve is already on for this account.';
    case 'UninstallFailed':
      return error.detail.code === 'UninstallFailed' && error.detail.result === false
        ? 'The module came off your account, but what waited to buy was not released yet. Turning Sleeve back on releases it to spend first.'
        : 'Sleeve could not confirm the removal on Robinhood Chain. Check Settings again in a moment.';
    case 'InvalidRule':
      return 'One of the rule values is outside what the rule allows. Check the caps and the minimum buy.';
    default:
      return 'Try again in a moment.';
  }
}
