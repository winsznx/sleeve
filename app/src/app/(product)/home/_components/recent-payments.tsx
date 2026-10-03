import Link from 'next/link';
import { useId, type JSX } from 'react';

import type { InboxItem, ReceiptRecord } from '@/data/types';

import { PaymentEntry } from '../../payments/_components/payment-list';

const LINK = 'inline-flex min-h-touch items-center text-body-s font-medium text-link underline underline-offset-4 hover:text-link-hover';

export interface RecentPaymentsProps {
  /** The newest payments, newest first. */
  items: readonly InboxItem[];
  byId: ReadonlyMap<string, ReceiptRecord>;
  records: readonly ReceiptRecord[];
  exhausted: boolean;
}

/** The latest payments and what each became (D-024): payments, not receipts. Each opens the details of its split. */
export function RecentPayments({ items, byId, records, exhausted }: RecentPaymentsProps): JSX.Element | null {
  const headingId = useId();
  if (items.length === 0) return null;
  return (
    <section aria-labelledby={headingId} className="min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h2 id={headingId} className="text-h2 text-ink">
          Recent payments
        </h2>
        <Link href="/payments" className={LINK}>
          See all payments
        </Link>
      </div>
      <ul className="mt-3 overflow-hidden rounded-panel border border-border bg-surface">
        {items.map((item) => (
          <PaymentEntry key={item.id} item={item} byId={byId} records={records} exhausted={exhausted} layout="compact" />
        ))}
      </ul>
    </section>
  );
}
