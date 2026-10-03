import { formatBps, formatUsdg, shortAddress, type TickerId } from '@sleeve/core';

import { premiumSentence } from '@/components/sleeve/premium-line';
import { tickerSymbol, tokenText, usdgExactText, waitCause } from '@/components/sleeve/text';
import { formatUtcDate } from '@/components/ui/format-time';
import type { ReceiptRecord } from '@/data/types';
import type { NotificationEvent, SleeveNotification } from '@/data/notifications';
import type { NotificationType } from '@/lib/settings';

/**
 * The words for each notification, built from its records' own numbers in the app's plain register (components/
 * sleeve/text.ts): number then unit, the direction as a word, never a share, never a gain. Each says where it leads.
 */

export type NotificationIcon = { kind: 'usdg' } | { kind: 'ticker'; tickerId: TickerId };

export interface NotificationView {
  title: string;
  text: string;
  href: string;
  icon: NotificationIcon;
  /** A Stock Token was bought or sold, so the item carries the debt security line. */
  stockToken: boolean;
}

/** The kinds as Settings lists them, in the order a payday runs. */
export const NOTIFICATION_TYPE_COPY: Record<NotificationType, { label: string; description: string }> = {
  'payment-arrived': { label: 'Payment arrived', description: 'USDG reached your payment address.' },
  'payment-split': { label: 'Payment split', description: 'What stayed spendable and what bought a Stock Token or waits.' },
  'buy-filled': { label: 'Buy filled', description: 'The Stock Token bought and its price against the market reference.' },
  'buy-waiting': { label: 'Buy waiting', description: 'The equity share waits as USDG, and why.' },
  'buy-settled': { label: 'Waiting buy settled', description: 'The market reopened or the wait ended, and the USDG bought.' },
  'sell-filled': { label: 'Sell filled', description: 'A sale back to USDG and what it paid.' },
  released: { label: 'Moved to spend', description: 'Waiting USDG you released to spend.' },
  'rule-changed': { label: 'Rule changed', description: 'A new rule took effect on a payment.' },
};

function receiptHref(record: ReceiptRecord): string {
  return `/receipts/${record.receipt.id}`;
}

function eachPrice(execPrice: bigint): string {
  return `${formatUsdg(execPrice)} USDG each`;
}

function splitText(record: ReceiptRecord): string {
  const r = record.receipt;
  const symbol = tickerSymbol(r.tickerId);
  const lead = `${usdgExactText(r.usdgIn)} split:`;
  switch (r.status) {
    case 'FILLED':
      return `${lead} ${usdgExactText(r.usdgToSpend)} stayed spendable and ${usdgExactText(r.usdgSpent)} bought ${symbol}.`;
    case 'QUEUED':
      return r.usdgQueued === 0n
        ? `${lead} all of it stayed spendable.`
        : `${lead} ${usdgExactText(r.usdgToSpend)} stayed spendable and ${usdgExactText(r.usdgQueued)} waits to buy ${symbol}.`;
    default:
      return `${lead} all of it stayed spendable, because ${symbol} could not be bought.`;
  }
}

function ruleText(record: ReceiptRecord): string {
  const rule = record.derived.rule;
  if (rule === null) return `Your new rule, version ${record.receipt.ruleVersion}, took effect with this payment.`;
  if (rule.equityBps === 0) return 'Your new rule took effect: every payment stays spendable.';
  return `Your new rule took effect: ${formatBps(rule.equityBps)} of each payment buys ${tickerSymbol(rule.tickerId)} and the rest stays spendable.`;
}

function viewOf(event: NotificationEvent): NotificationView {
  switch (event.type) {
    case 'payment-arrived': {
      const { item } = event;
      const lead = `${usdgExactText(item.amount)} arrived from ${shortAddress(item.from)}.`;
      return {
        title: 'Payment arrived',
        text: item.state === 'SORTED' ? lead : `${lead} It stays spendable until your rule splits it.`,
        href: '/payments',
        icon: { kind: 'usdg' },
        stockToken: false,
      };
    }
    case 'payment-split': {
      const r = event.record.receipt;
      const toTicker = r.status === 'FILLED' || (r.status === 'QUEUED' && r.usdgQueued > 0n);
      return {
        title: 'Payment split',
        text: splitText(event.record),
        href: '/payments',
        icon: toTicker ? { kind: 'ticker', tickerId: r.tickerId } : { kind: 'usdg' },
        stockToken: r.status === 'FILLED',
      };
    }
    case 'buy-filled': {
      const r = event.record.receipt;
      const symbol = tickerSymbol(r.tickerId);
      return {
        title: `Bought ${symbol}`,
        text: `${usdgExactText(r.usdgSpent)} became ${tokenText(r.tokensOut, symbol)}, ${eachPrice(r.execPrice)}. ${premiumSentence('buy', r.premiumBps)}`,
        href: receiptHref(event.record),
        icon: { kind: 'ticker', tickerId: r.tickerId },
        stockToken: true,
      };
    }
    case 'buy-waiting': {
      const r = event.record.receipt;
      const symbol = tickerSymbol(r.tickerId);
      return {
        title: `${symbol} buy waiting`,
        text: `${usdgExactText(r.usdgQueued)} waits as USDG to buy ${symbol}, because ${waitCause(r.reason)}.`,
        href: event.stillWaiting ? '/home' : receiptHref(event.record),
        icon: { kind: 'ticker', tickerId: r.tickerId },
        stockToken: false,
      };
    }
    case 'buy-settled': {
      const r = event.record.receipt;
      const since = r.queuedSince > 0n ? ` since ${formatUtcDate(r.queuedSince)}` : '';
      return {
        title: event.afterReopen ? 'Market reopened' : 'Waiting buy settled',
        text: `${usdgExactText(r.usdgSpent)} that waited${since} became ${tokenText(r.tokensOut, tickerSymbol(r.tickerId))}, ${eachPrice(r.execPrice)}.`,
        href: receiptHref(event.record),
        icon: { kind: 'ticker', tickerId: r.tickerId },
        stockToken: true,
      };
    }
    case 'sell-filled': {
      const [first] = event.records;
      const r = first.receipt;
      const symbol = tickerSymbol(r.tickerId);
      const tokens = event.records.reduce((sum, record) => sum + record.receipt.tokensIn, 0n);
      const usdg = event.records.reduce((sum, record) => sum + record.receipt.usdgOut, 0n);
      return {
        title: `Sold ${symbol}`,
        text: `${tokenText(tokens, symbol)} became ${usdgExactText(usdg)}, which went to spend. ${premiumSentence('sell', r.premiumBps)}`,
        href: receiptHref(first),
        icon: { kind: 'ticker', tickerId: r.tickerId },
        stockToken: true,
      };
    }
    case 'released': {
      const r = event.record.receipt;
      return {
        title: 'Moved to spend',
        text: `${usdgExactText(r.usdgIn)} that waited to buy ${tickerSymbol(r.tickerId)} moved to spend.`,
        href: receiptHref(event.record),
        icon: { kind: 'usdg' },
        stockToken: false,
      };
    }
    case 'rule-changed': {
      const rule = event.record.derived.rule;
      return {
        title: 'Rule changed',
        text: ruleText(event.record),
        href: '/rule',
        icon: rule === null ? { kind: 'usdg' } : { kind: 'ticker', tickerId: rule.tickerId },
        stockToken: false,
      };
    }
  }
}

export function describeNotification(notification: SleeveNotification): NotificationView {
  return viewOf(notification.event);
}
