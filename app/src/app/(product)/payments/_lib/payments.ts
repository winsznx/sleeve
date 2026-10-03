import { waitOutcome } from '@/app/(product)/receipts/[id]/wait-links';
import { formatUtcDay, utcDayKey } from '@/app/(product)/receipts/_lib/register';
import type { WaitEnd } from '@/components/sleeve/payment-outcome';
import type { InboxItem, ReceiptRecord } from '@/data/types';

/**
 * Payments as the list shows them (D-024): every inbound USDG transfer, newest first, joined to the receipt that sorted
 * it and, for an equity share that waited, to the receipt that ended the wait.
 */

export type PaymentFilter = 'all' | 'unsorted' | 'sorted';

export const PAYMENT_FILTERS: readonly { id: PaymentFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'unsorted', label: 'Not sorted' },
  { id: 'sorted', label: 'Sorted' },
];

export function isSorted(item: InboxItem): boolean {
  return item.state === 'SORTED';
}

export function filterPayments(items: readonly InboxItem[], filter: PaymentFilter): InboxItem[] {
  if (filter === 'all') return [...items];
  return items.filter((item) => isSorted(item) === (filter === 'sorted'));
}

export function paymentCounts(items: readonly InboxItem[]): Record<PaymentFilter, number> {
  const sorted = items.filter(isSorted).length;
  return { all: items.length, sorted, unsorted: items.length - sorted };
}

export interface PaymentDay {
  key: string;
  label: string;
  items: InboxItem[];
}

/** Consecutive payments on one UTC day, in the order given, as History groups its actions. */
export function groupPaymentsByDay(items: readonly InboxItem[]): PaymentDay[] {
  const days: PaymentDay[] = [];
  for (const item of items) {
    const key = utcDayKey(item.timestamp);
    const last = days[days.length - 1];
    if (last !== undefined && last.key === key) last.items.push(item);
    else days.push({ key, label: formatUtcDay(item.timestamp), items: [item] });
  }
  return days;
}

/** The receipts read so far, by id. */
export function receiptsById(records: readonly ReceiptRecord[]): Map<string, ReceiptRecord> {
  return new Map(records.map((record) => [record.receipt.id.toString(), record]));
}

/**
 * How a QUEUED split's waiting share ended: the buy, the release or the refused settle that emptied its bucket, from
 * one ticker's receipts. Null while it still waits, or when the receipts read so far cannot tell.
 */
export function waitEndOf(queued: ReceiptRecord, records: readonly ReceiptRecord[], exhausted: boolean): WaitEnd | null {
  const ticker = queued.receipt.tickerId;
  const window = { records: records.filter((record) => record.receipt.tickerId === ticker), exhausted };
  const outcome = waitOutcome(queued.receipt, window, undefined);
  if (outcome === null || outcome.kind !== 'closed') return null;
  const status = outcome.record.receipt.status;
  return { kind: status === 'SETTLED' ? 'bought' : status === 'RELEASED' ? 'released' : 'refused', record: outcome.record };
}

export interface PaymentsSummary {
  received: bigint;
  count: number;
  unsorted: bigint;
  unsortedCount: number;
  /** Sorted payments whose split the keeper or, after the grace period, anyone started: no action from the owner. */
  sortedHandsFree: number;
  /** Sorted payments whose split is in the receipts read so far. */
  sortedKnown: number;
}

export function paymentsSummary(items: readonly InboxItem[], byId: ReadonlyMap<string, ReceiptRecord>): PaymentsSummary {
  let received = 0n;
  let unsorted = 0n;
  let unsortedCount = 0;
  let sortedHandsFree = 0;
  let sortedKnown = 0;
  for (const item of items) {
    received += item.amount;
    if (!isSorted(item) || item.sortedBy === null) {
      unsorted += item.amount;
      unsortedCount += 1;
      continue;
    }
    const record = byId.get(item.sortedBy.receiptId.toString());
    if (record === undefined) continue;
    sortedKnown += 1;
    if (record.receipt.trigger !== 'OWNER') sortedHandsFree += 1;
  }
  return { received, count: items.length, unsorted, unsortedCount, sortedHandsFree, sortedKnown };
}
