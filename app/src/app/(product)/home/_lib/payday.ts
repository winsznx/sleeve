import type { Address, Trigger } from '@sleeve/core';

import { formatDuration } from '@/components/ui/format-time';
import type { InboxItem, ReceiptRecord } from '@/data/types';

import { latestPaymentSplit } from './latest-payment';

/**
 * This payday (D-024): the newest payment the rule split, who sent it, when it arrived and how soon it split. The
 * split receipt is the record; the senders and arrival times come from transfer logs, so they are derived.
 */
export interface Payday {
  record: ReceiptRecord;
  /** The sender when the split sorted one payment; null when it sorted several together. */
  from: Address | null;
  /** How many payments the split sorted. */
  payments: number;
  /** When the newest of those payments arrived. Null when the inbox does not list them. */
  arrivedAt: bigint | null;
}

export function latestPayday(receiptsNewestFirst: readonly ReceiptRecord[], inbox: readonly InboxItem[]): Payday | null {
  const record = latestPaymentSplit(receiptsNewestFirst);
  if (record === undefined) return null;
  const id = record.receipt.id;
  const sorted = inbox.filter((item) => item.sortedBy?.receiptId === id);
  const inbound = record.derived.inbound;
  const senders = new Set(inbound.map((ref) => ref.from.toLowerCase()));
  const first = inbound[0];
  return {
    record,
    from: senders.size === 1 && first !== undefined ? first.from : null,
    payments: Math.max(inbound.length, sorted.length, 1),
    arrivedAt: sorted.reduce<bigint | null>((latest, item) => (latest === null || item.timestamp > latest ? item.timestamp : latest), null),
  };
}

/** Payments that arrived and are not sorted yet: spendable now, split next. */
export function unsortedPayments(inbox: readonly InboxItem[]): { count: number; amount: bigint } {
  const waiting = inbox.filter((item) => item.state !== 'SORTED');
  return { count: waiting.length, amount: waiting.reduce((sum, item) => sum + item.amount, 0n) };
}

const SUBJECT: Record<Trigger, string> = {
  KEEPER: "Split by Sleeve's keeper",
  OWNER: 'You split it',
  PUBLIC: 'Split by someone else',
  PAYLINK: 'Split by the pay link, which is not available yet,',
};

/** "Split by Sleeve's keeper under a minute after it arrived, under rule version 2." */
export function sortedLine(payday: Payday): string {
  const r = payday.record.receipt;
  const when =
    payday.arrivedAt !== null && r.timestamp >= payday.arrivedAt
      ? ` ${formatDuration(r.timestamp - payday.arrivedAt)} after it arrived`
      : '';
  const why = r.trigger === 'PUBLIC' ? ' Anyone may start a split once a payment has waited out the one hour grace period.' : '';
  return `${SUBJECT[r.trigger]}${when}, under rule version ${r.ruleVersion}.${why}`;
}
