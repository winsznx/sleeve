'use client';

import { formatUsdg, shortAddress } from '@sleeve/core';
import Link from 'next/link';
import type { JSX } from 'react';

import { paymentStatus, paymentStory, type PaymentStory } from '@/components/sleeve/payment-outcome';
import { PaymentStatusPill } from '@/components/sleeve/payment-status-pill';
import { SenderMark } from '@/components/sleeve/payment-row';
import { SplitRail } from '@/components/sleeve/split-rail';
import { tickerSymbol } from '@/components/sleeve/text';
import { DebtSecurityLine } from '@/components/ui/debt-security-line';
import { EmptyState } from '@/components/ui/empty-state';
import { formatUtcClock } from '@/app/(product)/receipts/_lib/register';
import { useReceipt } from '@/data/hooks';
import type { InboxItem, ReceiptRecord } from '@/data/types';

import { waitEndOf } from '../../payments/_lib/payments';
import { OverviewCard } from './overview-card';

/** "26 Sep, 17:59 UTC": the day and the clock, without the year the card's context already gives. */
function shortDayTime(timestamp: bigint): string {
  const date = new Date(Number(timestamp) * 1_000);
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][date.getUTCMonth()] ?? '';
  return `${date.getUTCDate()} ${month}, ${formatUtcClock(timestamp)}`;
}

/** Where a payment went, in one short line built from its split. */
export function wentLine(story: PaymentStory): string {
  const symbol = story.tickerId === null ? '' : tickerSymbol(story.tickerId);
  const parts = story.parts;
  switch (story.tone) {
    case 'unsorted':
      return 'Spendable until your rule splits it';
    case 'loading':
      return 'Reading its split';
    case 'covered':
      return 'Matched your balance after USDG left outside Sleeve';
    case 'bought':
    case 'waited-bought':
      return parts === null ? `Bought ${symbol}` : `${formatUsdg(parts.spend)} USDG spendable, ${formatUsdg(parts.equity)} USDG bought ${symbol}`;
    case 'waiting':
      return parts === null ? `Waiting to buy ${symbol}` : `${formatUsdg(parts.spend)} USDG spendable, ${formatUsdg(parts.waiting)} USDG waiting for ${symbol}`;
    case 'refused':
    case 'waited-released':
      return parts === null ? 'All of it spendable' : `All ${formatUsdg(parts.spend + parts.equity + parts.waiting)} USDG spendable`;
  }
}

function PaymentLine({ item, byId, records, exhausted }: { item: InboxItem; byId: ReadonlyMap<string, ReceiptRecord>; records: readonly ReceiptRecord[]; exhausted: boolean }): JSX.Element {
  const id = item.sortedBy?.receiptId;
  const listed = id === undefined ? undefined : byId.get(id.toString());
  const own = useReceipt(id !== undefined && listed === undefined ? id : undefined);
  const record = id === undefined ? null : (listed ?? (own.isError ? null : own.data));
  const waitEnd = record !== null && record !== undefined && record.receipt.status === 'QUEUED' ? waitEndOf(record, records, exhausted) : null;
  const story = paymentStory(item, record, waitEnd);
  const status = paymentStatus(item, story);
  return (
    <li className="relative flex gap-3 border-t border-border py-3 first:border-t-0 first:pt-0 last:pb-0">
      <SenderMark from={item.from} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className="text-body font-semibold tabular-nums text-ink">
            <Link
              href={`/payments#payment-${item.id}`}
              className="after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-focus"
            >
              <span className="whitespace-nowrap">{formatUsdg(item.amount)}</span> USDG
              <span className="sr-only">, see its money trail</span>
            </Link>
          </p>
          <PaymentStatusPill status={status} />
        </div>
        <p className="mt-0.5 text-body-s text-ink-muted">
          From <span className="font-mono text-mono-s text-ink-secondary">{shortAddress(item.from)}</span>,{' '}
          <span className="whitespace-nowrap">{shortDayTime(item.timestamp)}</span>
        </p>
        {story.parts === null ? null : <SplitRail parts={story.parts} size="row" className="mt-2" />}
        <p className="mt-1.5 text-body-s text-ink-secondary">{wentLine(story)}</p>
        {story.bought ? <DebtSecurityLine className="mt-0.5" /> : null}
      </div>
    </li>
  );
}

export interface PaymentsCardProps {
  /** The newest payments, newest first. */
  items: readonly InboxItem[];
  byId: ReadonlyMap<string, ReceiptRecord>;
  records: readonly ReceiptRecord[];
  exhausted: boolean;
  /** Every payment received so far, for the count. */
  total: number;
}

/** Recent payments with where each one stands and where it went (D-029). Each opens its money trail on Payments. */
export function PaymentsCard({ items, byId, records, exhausted, total }: PaymentsCardProps): JSX.Element {
  return (
    <OverviewCard
      title="Recent payments"
      aside={<span className="text-body-s text-ink-muted">{total === 1 ? '1 so far' : `${total} so far`}</span>}
    >
      {items.length === 0 ? (
        <EmptyState title="No payments yet" headingLevel={3} className="flex-1 justify-center">
          Payments sent to your address show here with where each one went.
        </EmptyState>
      ) : (
        <ul>
          {items.map((item) => (
            <PaymentLine key={item.id} item={item} byId={byId} records={records} exhausted={exhausted} />
          ))}
        </ul>
      )}
      <div className="mt-auto pt-4">
        <Link
          href="/payments"
          className="inline-flex min-h-touch items-center gap-1 text-body-s font-medium text-link underline underline-offset-4 hover:text-link-hover"
        >
          See every payment
        </Link>
      </div>
    </OverviewCard>
  );
}
