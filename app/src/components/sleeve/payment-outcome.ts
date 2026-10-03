import { isPoolAllowlisted, type Reason, type TickerId } from '@sleeve/core';

import type { BadgeTone } from '@/components/ui/badge';
import { formatUtc, formatUtcDate } from '@/components/ui/format-time';
import type { InboundState, InboxItem, ReceiptRecord } from '@/data/types';

import type { SplitParts } from './split-rail';
import { tickerSymbol, tokenText, usdgExactText, waitCause } from './text';

/**
 * What one payment became (D-024): the payday split first, the record behind it. A payment is an inbound USDG
 * transfer; the receipt that sorted it says how it split, and when its equity share waited, a later receipt says how
 * the wait ended. Every word is built from those records, so the row never says more than the chain holds.
 */

export const PAYMENT_STATE_LABEL: Record<InboundState, string> = {
  RECEIVED: 'Received',
  WAITING_GRACE: 'Waiting to sort',
  SORTED: 'Sorted',
};

export const PAYMENT_STATE_TONE: Record<InboundState, BadgeTone> = {
  RECEIVED: 'neutral',
  WAITING_GRACE: 'waiting',
  SORTED: 'success',
};

/** How a waiting equity share ended, read from the receipt that emptied its bucket. Null while it still waits. */
export type WaitEnd = { kind: 'bought' | 'released' | 'refused'; record: ReceiptRecord };

export type PaymentTone = 'unsorted' | 'loading' | 'bought' | 'waiting' | 'waited-bought' | 'waited-released' | 'refused' | 'covered';

export interface PaymentStory {
  tone: PaymentTone;
  /** For the row's thin rail: what stayed spendable, what bought, what waits. Null when nothing split. */
  parts: SplitParts | null;
  /** "675.00 USDG stayed spendable" */
  spendLine: string | null;
  /** "75.00 USDG waits to buy SPY", "75.00 USDG became 0.097109 SPY" */
  equityLine: string | null;
  /** Anything else the reader needs: why it waits, that it split with other payments, that it covered a pull. */
  note: string | null;
  /** The ticker the equity share went to, for its icon. Null when no equity share exists. */
  tickerId: TickerId | null;
  /** A Stock Token was bought from this payment, so the row carries the debt security line. */
  bought: boolean;
  /** Why the share waits, for a tag. NONE when nothing waits. */
  reason: Reason;
}

function together(record: ReceiptRecord): string | null {
  const others = record.derived.inbound.length - 1;
  if (others <= 0) return null;
  return others === 1 ? 'Split together with 1 other payment.' : `Split together with ${others} other payments.`;
}

function joined(...parts: (string | null)[]): string | null {
  const kept = parts.filter((part): part is string => part !== null && part !== '');
  return kept.length === 0 ? null : kept.join(' ');
}

/** The story of a payment, from its inbox item, the receipt that sorted it (undefined while loading) and how a wait ended. */
export function paymentStory(item: InboxItem, record: ReceiptRecord | null | undefined, waitEnd: WaitEnd | null = null): PaymentStory {
  const empty = { parts: null, spendLine: null, equityLine: null, tickerId: null, bought: false, reason: 'NONE' as Reason };
  if (item.state !== 'SORTED' || item.sortedBy === null) {
    const grace =
      item.state === 'WAITING_GRACE' && item.graceEndsAt !== null
        ? ` If Sleeve's keeper has not sorted it by ${formatUtc(item.graceEndsAt)}, anyone can start the split.`
        : '';
    return { ...empty, tone: 'unsorted', note: `Not sorted yet. It is spendable in your account until your rule splits it.${grace}` };
  }
  if (record === undefined) return { ...empty, tone: 'loading', note: null };
  if (record === null) return { ...empty, tone: 'loading', note: 'The record of this split did not load.' };

  const r = record.receipt;
  const symbol = tickerSymbol(r.tickerId);
  const spendLine = `${usdgExactText(r.usdgToSpend)} stayed spendable`;
  switch (r.status) {
    case 'FILLED':
      return {
        tone: 'bought',
        parts: { spend: r.usdgToSpend, equity: r.usdgSpent, waiting: 0n },
        spendLine,
        equityLine: `${usdgExactText(r.usdgSpent)} became ${tokenText(r.tokensOut, symbol)}`,
        note: together(record),
        tickerId: r.tickerId,
        bought: true,
        reason: 'NONE',
      };
    case 'QUEUED': {
      if (waitEnd?.kind === 'bought') {
        return {
          tone: 'waited-bought',
          parts: { spend: r.usdgToSpend, equity: r.usdgQueued, waiting: 0n },
          spendLine,
          equityLine: `${usdgExactText(r.usdgQueued)} waited, then bought ${symbol} on ${formatUtcDate(waitEnd.record.receipt.timestamp)}`,
          note: joined(`It waited because ${waitCause(r.reason)}.`, together(record)),
          tickerId: r.tickerId,
          bought: true,
          reason: 'NONE',
        };
      }
      if (waitEnd?.kind === 'released' || waitEnd?.kind === 'refused') {
        return {
          tone: 'waited-released',
          parts: { spend: r.usdgToSpend + r.usdgQueued, equity: 0n, waiting: 0n },
          spendLine,
          equityLine: `${usdgExactText(r.usdgQueued)} waited, then moved to spend on ${formatUtcDate(waitEnd.record.receipt.timestamp)}`,
          note: together(record),
          tickerId: r.tickerId,
          bought: false,
          reason: 'NONE',
        };
      }
      return {
        tone: 'waiting',
        parts: { spend: r.usdgToSpend, equity: 0n, waiting: r.usdgQueued },
        spendLine,
        equityLine: `${usdgExactText(r.usdgQueued)} waits as USDG to buy ${symbol}`,
        note: together(record),
        tickerId: r.tickerId,
        bought: false,
        reason: r.reason,
      };
    }
    case 'REFUSED_TICKER':
    case 'REFUSED_ACCOUNT':
      return {
        tone: 'refused',
        parts: { spend: r.usdgIn, equity: 0n, waiting: 0n },
        spendLine: `All ${usdgExactText(r.usdgIn)} stayed spendable`,
        equityLine: null,
        note: joined(
          r.status === 'REFUSED_ACCOUNT'
            ? `${symbol} could not be bought: the issuer's blocklist includes this account.`
            : isPoolAllowlisted(r.tickerId, r.pool)
              ? `${symbol} is no longer on Sleeve's ticker list, so the equity share went to spend.`
              : `The pool this split named is not on the ${symbol} allowlist, so the equity share went to spend.`,
          together(record),
        ),
        tickerId: r.tickerId,
        bought: false,
        reason: 'NONE',
      };
    case 'RECONCILED':
      return {
        ...empty,
        tone: 'covered',
        note: 'USDG had left your account outside Sleeve, so this payment went to match your balance and nothing was left to split.',
      };
    default:
      return { ...empty, tone: 'loading', note: null };
  }
}

/** Seconds from a payment's arrival to the split that sorted it, when the split came after it. */
export function secondsToSort(item: InboxItem, record: ReceiptRecord | null | undefined): bigint | null {
  if (record === null || record === undefined || record.receipt.timestamp < item.timestamp) return null;
  return record.receipt.timestamp - item.timestamp;
}
