import type { Receipt, Status } from '@sleeve/core';

import type { BucketView, ReceiptRecord } from '@/data/types';

/**
 * How a wait ends, read from the receipts around it (PRD 7.4 and 9). A QUEUED receipt records USDG entering the
 * ticker's bucket; the bucket leaves in one receipt that carries the bucket's first queue time as queuedSince: a
 * buy (SETTLED), a release (RELEASED), or a settle the guard refused (REFUSED_TICKER or REFUSED_ACCOUNT). Matching
 * the two ties a payday that waited to the buy or release that ended the wait, both ways. Nothing here is stored on
 * either receipt, so a screen labels it derived. When the receipts read so far cannot settle the question, the
 * answer is null and the screen says nothing rather than guess.
 */

/** Statuses that empty a bucket. Each carries queuedSince when it does; a split's refusals carry zero. */
const CLOSING = new Set<Status>(['SETTLED', 'RELEASED', 'REFUSED_TICKER', 'REFUSED_ACCOUNT']);

export interface ReceiptWindow {
  /** One account's receipts for one ticker, newest first, as far as they have been read. */
  records: readonly ReceiptRecord[];
  /** Every older receipt has been read too: nothing is missing below the last one. */
  exhausted: boolean;
}

export type WaitOutcome = { kind: 'closed'; record: ReceiptRecord } | { kind: 'waiting'; bucket: BucketView };

/** Whether a receipt emptied a bucket that already held USDG at `at`. */
function closesBucketHeldAt(receipt: Receipt, at: bigint): boolean {
  return CLOSING.has(receipt.status) && receipt.queuedSince > 0n && receipt.queuedSince <= at;
}

/**
 * What became of a QUEUED receipt's USDG: the receipt that took the bucket out (the first one after it that closed a
 * bucket already holding it), or the bucket still waiting today. Null for any other receipt, and whenever the window
 * or the buckets leave it open.
 */
export function waitOutcome(
  queued: Receipt,
  window: ReceiptWindow | null,
  buckets: readonly BucketView[] | undefined,
): WaitOutcome | null {
  if (queued.status !== 'QUEUED' || window === null) return null;
  const closer = window.records
    .filter(({ receipt }) => receipt.id > queued.id && closesBucketHeldAt(receipt, queued.timestamp))
    .sort((a, b) => (a.receipt.id < b.receipt.id ? -1 : 1))[0];
  if (closer !== undefined) return { kind: 'closed', record: closer };
  const reachesBack = window.exhausted || window.records.some(({ receipt }) => receipt.id <= queued.id);
  if (!reachesBack || buckets === undefined) return null;
  const bucket = buckets.find((candidate) => candidate.tickerId === queued.tickerId);
  if (bucket === undefined || bucket.amount === 0n || bucket.since > queued.timestamp) return null;
  return { kind: 'waiting', bucket };
}

/**
 * The paydays whose equity share waited in the bucket a buy, release or refused settle emptied, oldest first: the
 * QUEUED receipts written from the bucket's first queue time up to this one. Null when the receipt emptied no bucket
 * or the window does not reach back to the bucket's start.
 */
export function waitedPaydays(closing: Receipt, window: ReceiptWindow | null): ReceiptRecord[] | null {
  if (window === null || !CLOSING.has(closing.status) || closing.queuedSince === 0n) return null;
  const reachesBack = window.exhausted || window.records.some(({ receipt }) => receipt.timestamp < closing.queuedSince);
  if (!reachesBack) return null;
  const fed = window.records
    .filter(
      ({ receipt }) =>
        receipt.status === 'QUEUED' &&
        receipt.id < closing.id &&
        receipt.tickerId === closing.tickerId &&
        receipt.timestamp >= closing.queuedSince,
    )
    .sort((a, b) => (a.receipt.id < b.receipt.id ? -1 : 1));
  return fed.length === 0 ? null : fed;
}
