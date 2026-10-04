import {
  formatBps,
  formatFeedPrice,
  formatStockToken,
  formatUnits,
  formatUsdg,
  shortAddress,
  TOTAL_BPS,
  type Rule,
} from '@sleeve/core';

import { reasonSentence, percentWords, tickerSymbol, usdgExactText } from '@/components/sleeve/text';
import { formatNewYork } from '@/components/ui/format-time';
import type { MoneyPlace, NetworkFee, PreviewAmount, PreviewBlock, PreviewPrice, PreviewWarning } from '@/data/types';

/**
 * The words a transaction preview prints, built from the preview's own numbers. Every string passes the copy lint:
 * no share as a noun, no performance words, no dashes, and a Stock Token is always named in full.
 */

/** Where money sits, as a short label: "Spendable", "Waiting to buy SPY", "0x12ab...cdef". */
export function placeLabel(place: MoneyPlace): string {
  switch (place.kind) {
    case 'spend':
      return 'Spendable';
    case 'unsorted':
      return 'Not sorted yet';
    case 'waiting':
      return `Waiting to buy ${tickerSymbol(place.tickerId)}`;
    case 'holding':
      return `${tickerSymbol(place.tickerId)} you hold`;
    case 'outside':
      return shortAddress(place.address);
  }
}

/** "120.00 USDG", "0.155872 SPY". */
export function amountText(amount: PreviewAmount): string {
  return amount.asset.kind === 'USDG'
    ? usdgExactText(amount.amount)
    : `${formatStockToken(amount.amount)} ${tickerSymbol(amount.asset.tickerId)}`;
}

export function amountValue(amount: PreviewAmount): string {
  return amount.asset.kind === 'USDG' ? formatUsdg(amount.amount, { maxFractionDigits: 6 }) : formatStockToken(amount.amount);
}

export function amountUnit(amount: PreviewAmount): string {
  return amount.asset.kind === 'USDG' ? 'USDG' : tickerSymbol(amount.asset.tickerId);
}

/** "about 0.0000243 ETH". Seven places show the fee of the cheapest owner op without rounding it to zero. */
export function feeAmountText(fee: NetworkFee): string {
  return `about ${formatUnits(fee.wei, 18, { minFractionDigits: 2, maxFractionDigits: 7 })} ETH`;
}

export function feeSentence(fee: NetworkFee): string {
  return fee.sponsored
    ? "Sleeve's paymaster pays it, so nothing leaves your account for gas."
    : 'Your account pays it in ETH on Robinhood Chain.';
}

/** "774.23 USDG per SPY" */
export function priceText(price: PreviewPrice): string {
  return `${formatUsdg(price.execPrice)} USDG per ${tickerSymbol(price.tickerId)}`;
}

/** "772.10 USD per SPY", the Chainlink answer as it reads. */
export function referenceText(price: PreviewPrice): string {
  return `${formatFeedPrice(price.reference.answer)} USD per ${tickerSymbol(price.tickerId)}`;
}

/** "0.28 percent above the reference", "0.10 percent below it", "at the reference". */
export function differenceText(price: PreviewPrice): string {
  if (price.differenceBps === 0n) return 'At the market reference';
  const above = price.side === 'BUY' ? price.differenceBps > 0n : price.differenceBps < 0n;
  return `${percentWords(price.differenceBps)} ${above ? 'above' : 'below'} the market reference`;
}

export function capText(price: PreviewPrice): string {
  const side = price.side === 'BUY' ? 'above' : 'below';
  return price.withinCap
    ? `Within your cap of ${percentWords(price.capBps)} ${side} it.`
    : `More than your cap of ${percentWords(price.capBps)} ${side} it.`;
}

/** Something to know before signing, as one sentence. */
export function warningText(warning: PreviewWarning): string {
  switch (warning.code) {
    case 'SENDS_UNSORTED':
      return `${usdgExactText(warning.amount)} of this arrived and is not sorted yet. Sending it now means your rule never splits it.`;
    case 'SENDS_WAITING':
      return `${usdgExactText(warning.amount)} of this is waiting to buy ${tickerSymbol(warning.tickerId)}. Sending it means it never buys.`;
    case 'RELEASE_ENDS_WAIT':
      return `It stops waiting and will not buy ${tickerSymbol(warning.tickerId)}. It stays in your account as spendable USDG.`;
    case 'EQUITY_WILL_WAIT': {
      const symbol = tickerSymbol(warning.tickerId);
      return warning.reason === 'SESSION'
        ? `The market is closed, so the equity share waits as USDG and buys ${symbol} after it reopens${
            warning.reopensAt === null ? '' : `, ${formatNewYork(warning.reopensAt)}`
          }.`
        : `The equity share waits as USDG instead of buying now. ${reasonSentence(warning.reason, { symbol })}`;
    }
    case 'EQUITY_TO_SPEND':
      return warning.status === 'REFUSED_ACCOUNT'
        ? `The issuer's blocklist includes this account, so ${tickerSymbol(warning.tickerId)} cannot be bought and the equity share goes to spend.`
        : `${tickerSymbol(warning.tickerId)} cannot be bought through Sleeve now, so the equity share goes to spend.`;
    case 'RECONCILES_FIRST':
      return `${usdgExactText(warning.shortfall)} left your account outside Sleeve, so this first lowers your ledgers to match the balance.`;
    case 'SKIPS_MARKET_WAIT':
      return warning.reopensAt === null
        ? 'The market is closed. This sale fills now at the pool price instead of waiting for the market reference.'
        : `The market is closed until ${formatNewYork(warning.reopensAt)}. This sale fills now at the pool price instead of waiting.`;
    case 'WIDER_CAP':
      return `It accepts up to ${percentWords(warning.capBps)} below the market reference for this sale only. Your rule's cap is ${percentWords(warning.ruleCapBps)}.`;
    case 'PAUSE_LEAVES_UNSORTED':
      return 'While it is paused, new payments stay unsorted and spendable. Nothing already split, bought or waiting changes.';
    case 'RESUME_SPLITS_UNSORTED':
      return `${usdgExactText(warning.amount)} arrived while it was paused. It splits by your rule at the next split.`;
    case 'REMOVE_STOPS_SPLITS':
      return 'From then on, payments stay as USDG and nothing splits them. Your USDG and Stock Tokens stay in your account.';
    case 'SNAPSHOT_KEEPS_BALANCE':
      return `The ${usdgExactText(warning.amount)} in your account now stays spendable. Your rule splits only payments that arrive after this.`;
  }
}

/** Why the action would not go through now, as one sentence. */
export function blockText(block: PreviewBlock): string {
  switch (block.code) {
    case 'InsufficientBalance':
      return `That is more than your account holds, ${usdgExactText(block.balance)}.`;
    case 'ZeroAmount':
      return 'Enter an amount above zero.';
    case 'ExceedsBalance':
      return 'That is more than your account holds of this Stock Token.';
    case 'InvalidDestination':
      return block.reason === 'SELF'
        ? 'That is your own payment address. Send to an address outside this account.'
        : 'That is the zero address. Anything sent there is gone for good.';
    case 'NothingWaiting':
      return 'Nothing is waiting there now. It may have been sorted, bought or moved to spend already.';
    case 'BelowClip':
      return `The waiting amount is below your minimum buy of ${usdgExactText(block.minClip)}.`;
    case 'GuardNotClear':
      return block.reason === 'NONE'
        ? 'The price check has not cleared yet.'
        : `The price check has not cleared. ${reasonSentence(block.reason, { symbol: 'the Stock Token' })}`;
    case 'SellWaits':
      return block.reason === 'SESSION'
        ? `The market is closed${block.reopensAt === null ? '' : ` until ${formatNewYork(block.reopensAt)}`}, so the sale waits.`
        : 'The market reference is out of date, so the sale waits for a fresh price.';
    case 'ExceedsLots':
      return 'That is more than your lots hold.';
    case 'DiscountAboveCap':
      return 'The pool price is further below the market reference than your cap allows.';
    case 'OverrideCapOutOfRange':
      return 'The cap for this sale is outside what Sleeve allows.';
    case 'AccountBlocked':
      return "The issuer's blocklist includes this account.";
    case 'RuleNotActive':
      return 'Your rule is not active.';
    case 'RuleNotPaused':
      return 'Your rule is not paused.';
    case 'InvalidRule':
      return 'One of the values is outside what the rule allows.';
    case 'GracePeriodActive':
      return "Sleeve's keeper and you go first until the grace period ends.";
    case 'NotSignedIn':
      return 'You are signed out.';
    case 'SourceUnavailable':
      return 'Sleeve could not reach Robinhood Chain.';
    case 'LedgersAboveBalance':
      return 'USDG left your account outside Sleeve. Sort your payments first, so the ledgers match the balance.';
    case 'EmptyBucket':
      return 'Nothing is waiting for this Stock Token.';
    case 'NotInstalled':
      return 'Sleeve is off for this account.';
    case 'ModuleInstalled':
      return 'Sleeve is already on for this account.';
    case 'UninstallFailed':
      return block.result === false
        ? 'The module would not release what waits to buy.'
        : 'The account would not report the module as removed.';
    default:
      return 'It cannot run right now.';
  }
}

export interface RuleLine {
  id: string;
  label: string;
  before: string;
  after: string;
  changed: boolean;
}

function splitWords(rule: Rule): string {
  if (rule.status === 'NONE') return 'No rule';
  return `${formatBps(TOTAL_BPS - rule.equityBps)} spendable, ${formatBps(rule.equityBps)} buys ${tickerSymbol(rule.tickerId)}`;
}

const STATUS_WORD: Record<Rule['status'], string> = { ACTIVE: 'Active', PAUSED: 'Paused', NONE: 'Not set' };

/** A rule change as rows of before and after. Unchanged rows are kept so the whole rule reads in one place. */
export function ruleLines(before: Rule, after: Rule): RuleLine[] {
  const rows: Omit<RuleLine, 'changed'>[] = [
    { id: 'status', label: 'Status', before: STATUS_WORD[before.status], after: STATUS_WORD[after.status] },
    { id: 'split', label: 'Each payment', before: splitWords(before), after: splitWords({ ...after, status: after.status === 'NONE' ? 'NONE' : 'ACTIVE' }) },
    {
      id: 'premium',
      label: 'Price cap',
      before: before.status === 'NONE' ? 'Not set' : `${formatBps(before.premiumCapBps)} above the reference`,
      after: `${formatBps(after.premiumCapBps)} above the reference`,
    },
    {
      id: 'slippage',
      label: 'Slippage limit',
      before: before.status === 'NONE' ? 'Not set' : formatBps(before.slippageBps),
      after: formatBps(after.slippageBps),
    },
    {
      id: 'clip',
      label: 'Minimum buy',
      before: before.status === 'NONE' ? 'Not set' : usdgExactText(before.minClip),
      after: usdgExactText(after.minClip),
    },
  ];
  return rows.map((row) => ({ ...row, changed: row.before !== row.after }));
}
