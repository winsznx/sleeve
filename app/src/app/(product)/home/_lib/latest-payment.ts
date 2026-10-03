import type { Status } from '@sleeve/core';

import type { ReceiptRecord } from '@/data/types';

/** Receipts that record a payment being split, the moment home leads with (docs/DESIGN.md 12.1). */
const PAYMENT_SPLITS: ReadonlySet<Status> = new Set<Status>(['FILLED', 'QUEUED', 'REFUSED_TICKER', 'REFUSED_ACCOUNT']);

/** The newest payment split in a list of receipts ordered newest first, as listReceipts returns them. */
export function latestPaymentSplit(newestFirst: readonly ReceiptRecord[]): ReceiptRecord | undefined {
  return newestFirst.find((record) => PAYMENT_SPLITS.has(record.receipt.status));
}
