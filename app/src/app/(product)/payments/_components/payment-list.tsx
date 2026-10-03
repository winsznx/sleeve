'use client';

import { shortAddress } from '@sleeve/core';
import type { JSX } from 'react';

import { paymentStory } from '@/components/sleeve/payment-outcome';
import { PaymentRow } from '@/components/sleeve/payment-row';
import { usdgExactText } from '@/components/sleeve/text';
import { CopyButton } from '@/components/ui/copy-field';
import { formatUtc } from '@/components/ui/format-time';
import { useReceipt } from '@/data/hooks';
import type { InboxItem, ReceiptRecord } from '@/data/types';

import { groupPaymentsByDay, waitEndOf } from '../_lib/payments';

export interface PaymentListProps {
  items: readonly InboxItem[];
  /** The account's receipts read so far, by id, and the list itself for wait outcomes. */
  byId: ReadonlyMap<string, ReceiptRecord>;
  records: readonly ReceiptRecord[];
  /** Every older receipt has been read, so a wait that is not closed in the list is still open. */
  exhausted: boolean;
}

/** The payments register: grouped by UTC day, newest first, each row joined to the split that sorted it. */
export function PaymentList({ items, byId, records, exhausted }: PaymentListProps): JSX.Element {
  const days = groupPaymentsByDay(items);
  return (
    <div className="overflow-hidden rounded-panel border border-border bg-surface">
      <div
        aria-hidden="true"
        className="hidden border-b border-border px-5 py-2 text-label font-medium text-ink-muted md:grid md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] md:gap-6"
      >
        <span className="pl-[calc(var(--size-avatar)_+_0.75rem)]">Payment</span>
        <span>What it became</span>
      </div>
      {days.map((day) => (
        <section key={day.key} aria-label={day.label}>
          <h3 className="flex items-center justify-between gap-3 border-b border-t border-border bg-surface-muted px-4 py-2 text-body-s first:border-t-0 md:px-5">
            <time dateTime={day.key} className="font-semibold text-ink">
              {day.label}
            </time>
            <span className="text-ink-muted">{day.items.length === 1 ? '1 payment' : `${day.items.length} payments`}</span>
          </h3>
          <ul>
            {day.items.map((item) => (
              <PaymentEntry key={item.id} item={item} byId={byId} records={records} exhausted={exhausted} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export interface PaymentEntryProps {
  item: InboxItem;
  byId: ReadonlyMap<string, ReceiptRecord>;
  records: readonly ReceiptRecord[];
  exhausted: boolean;
  /** compact for Home's recent payments: what it became sits under the payment, without the transaction line. */
  layout?: 'compact' | 'register';
}

/** One payment; reads its split on its own when the list of receipts does not reach back that far. */
export function PaymentEntry({ item, byId, records, exhausted, layout = 'register' }: PaymentEntryProps): JSX.Element {
  const id = item.sortedBy?.receiptId;
  const listed = id === undefined ? undefined : byId.get(id.toString());
  const own = useReceipt(id !== undefined && listed === undefined ? id : undefined);
  const record = id === undefined ? null : (listed ?? (own.isError ? null : own.data));
  const waitEnd = record !== null && record !== undefined && record.receipt.status === 'QUEUED' ? waitEndOf(record, records, exhausted) : null;
  const story = paymentStory(item, record, waitEnd);
  return (
    <PaymentRow item={item} story={story} href={id === undefined ? undefined : `/receipts/${id}`} layout={layout}>
      {layout === 'compact' ? null : (
        <p className="relative z-[1] mt-1 flex flex-wrap items-center gap-x-1.5 text-body-s text-ink-muted">
          <span>
            Transaction <span className="font-mono text-mono-s text-ink-secondary">{shortAddress(item.txHash)}</span> (derived)
          </span>
          <CopyButton
            value={item.txHash}
            label={`Copy the transaction hash of the ${usdgExactText(item.amount)} payment, ${formatUtc(item.timestamp)}`}
            className="-my-2"
          />
        </p>
      )}
    </PaymentRow>
  );
}
