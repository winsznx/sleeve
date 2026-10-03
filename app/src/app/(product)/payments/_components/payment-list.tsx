'use client';

import { shortAddress } from '@sleeve/core';
import { useEffect, useRef, useState, useSyncExternalStore, type JSX } from 'react';

import { paymentStory } from '@/components/sleeve/payment-outcome';
import { PaymentRow } from '@/components/sleeve/payment-row';
import { usdgExactText } from '@/components/sleeve/text';
import { CopyButton } from '@/components/ui/copy-field';
import { formatUtc } from '@/components/ui/format-time';
import { useReceipt } from '@/data/hooks';
import type { Holding, InboxItem, ReceiptRecord } from '@/data/types';

import { groupPaymentsByDay, waitEndOf } from '../_lib/payments';
import { MoneyTrail } from './money-trail';

function subscribeToHash(listener: () => void): () => void {
  window.addEventListener('hashchange', listener);
  return () => window.removeEventListener('hashchange', listener);
}

/** The page's URL fragment, so a link from Home can open one payment's trail. Empty on the server. */
function useLocationHash(): string {
  return useSyncExternalStore(
    subscribeToHash,
    () => window.location.hash,
    () => '',
  );
}

/** What a trail needs beyond its payment: the lots now, and the clock and the reopen time for a wait. */
export interface TrailContext {
  holdings: readonly Holding[] | undefined;
  reopensAt: bigint | null | undefined;
  now: bigint | undefined;
}

export interface PaymentListProps {
  items: readonly InboxItem[];
  /** The account's receipts read so far, by id, and the list itself for wait outcomes. */
  byId: ReadonlyMap<string, ReceiptRecord>;
  records: readonly ReceiptRecord[];
  /** Every older receipt has been read, so a wait that is not closed in the list is still open. */
  exhausted: boolean;
  context: TrailContext;
}

/**
 * The payments register: grouped by UTC day, newest first, each row joined to the split that sorted it. A row opens
 * its money trail in place; a link to /payments#payment-<id> opens that one.
 */
export function PaymentList({ items, byId, records, exhausted, context }: PaymentListProps): JSX.Element {
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
              <PaymentEntry key={item.id} item={item} byId={byId} records={records} exhausted={exhausted} context={context} />
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
  context: TrailContext;
}

/** One payment; reads its split on its own when the list of receipts does not reach back that far. */
export function PaymentEntry({ item, byId, records, exhausted, context }: PaymentEntryProps): JSX.Element {
  const id = item.sortedBy?.receiptId;
  const listed = id === undefined ? undefined : byId.get(id.toString());
  const own = useReceipt(id !== undefined && listed === undefined ? id : undefined);
  const record = id === undefined ? null : (listed ?? (own.isError ? null : own.data));
  const waitEnd = record !== null && record !== undefined && record.receipt.status === 'QUEUED' ? waitEndOf(record, records, exhausted) : null;
  const story = paymentStory(item, record, waitEnd);
  const hash = useLocationHash();
  const linked = hash === `#payment-${item.id}`;
  const [toggled, setToggled] = useState<boolean | null>(null);
  const expanded = toggled ?? linked;
  const row = useRef<HTMLDivElement>(null);
  const trailId = `trail-${item.id}`;

  // A link from Home lands here after the list renders in the browser, too late for the browser's own jump.
  useEffect(() => {
    if (linked) row.current?.closest('li')?.scrollIntoView({ block: 'start' });
  }, [linked]);

  return (
    <PaymentRow
      item={item}
      story={story}
      trail={{
        id: trailId,
        expanded,
        onToggle: () => setToggled(!expanded),
        content: (
          <MoneyTrail
            id={trailId}
            item={item}
            record={record}
            waitEnd={waitEnd}
            holdings={context.holdings}
            reopensAt={context.reopensAt}
            now={context.now}
          />
        ),
      }}
    >
      <div ref={row} className="relative z-[1] mt-1 flex flex-wrap items-center gap-x-1.5 text-body-s text-ink-muted">
        <span>
          Transaction <span className="font-mono text-mono-s text-ink-secondary">{shortAddress(item.txHash)}</span> (derived)
        </span>
        <CopyButton
          value={item.txHash}
          label={`Copy the transaction hash of the ${usdgExactText(item.amount)} payment, ${formatUtc(item.timestamp)}`}
          className="-my-2"
        />
      </div>
    </PaymentRow>
  );
}
