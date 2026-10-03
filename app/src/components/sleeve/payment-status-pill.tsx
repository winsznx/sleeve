import type { JSX } from 'react';

import { cx } from '@/components/ui/cx';

import { PAYMENT_STATUS_LABEL, type PaymentStatus } from './payment-outcome';

/**
 * A payment's status as a pill with a dot, the overview reference's invoice pills in Sleeve's colors: green once it
 * bought, the amber stripe while it waits, apricot once it is sorted to spend, neutral while it is only received.
 * The word always sits beside the dot.
 */

const DOT: Record<PaymentStatus, string> = {
  received: 'bg-ink-muted',
  'waiting-to-sort': 'bg-waiting',
  sorted: 'bg-spend',
  bought: 'bg-equity',
  'waiting-market': 'bg-waiting-stripes ring-1 ring-inset ring-waiting',
  waiting: 'bg-waiting-stripes ring-1 ring-inset ring-waiting',
};

export function PaymentStatusPill({ status, className }: { status: PaymentStatus; className?: string }): JSX.Element {
  return (
    <span
      data-status={status}
      className={cx(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill border border-border bg-surface px-2.5 py-0.5 text-label font-medium text-ink',
        className,
      )}
    >
      <span aria-hidden="true" className={cx('size-2 shrink-0 rounded-pill', DOT[status])} />
      {PAYMENT_STATUS_LABEL[status]}
    </span>
  );
}
