'use client';

import type { Address } from '@sleeve/core';
import { useEffect, useId, useState, type JSX } from 'react';

import { ReceiptSummary } from '@/components/sleeve/receipt-summary';
import type { ReceiptRecord } from '@/data/types';

import { isFirstShowing, rememberShown } from '../_lib/seen-split';

export interface LatestPaymentProps {
  account: Address;
  /** The newest payment split. Key the component by its receipt id, so a new split starts fresh. */
  record: ReceiptRecord;
}

/**
 * The payday split home leads with (PRD 15, docs/DESIGN.md 12.1): the receipt's sentence, the split rail and its
 * legend, the token line and the premium, then the way to the full receipt and the verifier. The equity segment
 * grows once, the first time this browser shows the split, and never again.
 */
export function LatestPayment({ account, record }: LatestPaymentProps): JSX.Element {
  const headingId = useId();
  const id = record.receipt.id;
  const [animate] = useState(() => isFirstShowing(account, id));

  // Browser storage is outside React: note that this split has been shown, so a later visit leaves it still.
  useEffect(() => {
    rememberShown(account, id);
  }, [account, id]);

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="text-h2 text-ink">
        Latest payment
      </h2>
      <ReceiptSummary
        record={record}
        href={`/receipts/${id}`}
        verifyHref={`/verify/${id}`}
        animate={animate}
        headingLevel={3}
        className="mt-3"
      />
    </section>
  );
}
