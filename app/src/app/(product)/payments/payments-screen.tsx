'use client';

import { formatUsdg, type Address } from '@sleeve/core';
import { useId, useState, type JSX } from 'react';

import { useOpenReceive } from '@/components/shell/receive';
import { SampleTag } from '@/components/shell/sample-tag';
import { PaymentAddressCard } from '@/components/sleeve/payment-address-card';
import { TokenIcon } from '@/components/token/token-icon';
import { Amount } from '@/components/ui/amount';
import { Button } from '@/components/ui/button';
import { StatStrip } from '@/components/ui/card';
import { FilterPill } from '@/components/ui/choice';
import { CountBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton, SkeletonGroup, SkeletonText } from '@/components/ui/skeleton';
import { useInbox, useMarket, useReceipts, useRule, useSession, useSplitPreview } from '@/data/hooks';

import { LoadError } from '../home/_components/load-error';
import { SignedOutPrompt } from '../home/_components/signed-out-prompt';
import { PaymentList } from './_components/payment-list';
import { SortCard } from './_components/sort-card';
import {
  filterPayments,
  PAYMENT_FILTERS,
  paymentCounts,
  paymentsSummary,
  receiptsById,
  type PaymentFilter,
} from './_lib/payments';

/** Enough receipts to join every recent payment to its split in one read; older ones read themselves. */
const RECEIPTS_READ = 100;

const TITLE = 'Payments';
const DESCRIPTION = 'USDG sent to your payment address, newest first, and what each payment became.';

function ReceiveAction(): JSX.Element | null {
  const openReceive = useOpenReceive();
  if (openReceive === null) return null;
  return (
    <Button variant="secondary" icon="receive" onClick={openReceive}>
      Receive USDG
    </Button>
  );
}

function PaymentsSkeleton(): JSX.Element {
  return (
    <SkeletonGroup label="Loading your payments" className="flex flex-col gap-stack">
      <div className="grid gap-stack sm:grid-cols-3">
        {[0, 1, 2].map((tile) => (
          <div key={tile} className="rounded-module border border-border bg-surface-muted p-4">
            <div className="flex gap-3">
              <Skeleton className="size-icon-tile rounded-row" />
              <div className="flex-1">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="mt-2 h-7 w-32" />
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="overflow-hidden rounded-panel border border-border bg-surface">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="flex gap-3 border-t border-border px-4 py-4 first:border-t-0 md:px-5">
            <Skeleton className="size-avatar rounded-[11px]" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-32" />
              <SkeletonText lines={2} className="mt-2" />
            </div>
          </div>
        ))}
      </div>
    </SkeletonGroup>
  );
}

function AccountPayments({ account }: { account: Address }): JSX.Element {
  const listId = useId();
  const inbox = useInbox(account);
  const receipts = useReceipts({ account, limit: RECEIPTS_READ });
  const preview = useSplitPreview(account);
  const rule = useRule(account);
  const market = useMarket();
  const [filter, setFilter] = useState<PaymentFilter>('all');

  if (inbox.data === undefined || receipts.data === undefined || preview.data === undefined || rule.data === undefined) {
    const failed = [inbox, receipts, preview, rule].filter((query) => query.data === undefined && query.isError);
    return failed.length === 0 ? (
      <PaymentsSkeleton />
    ) : (
      <LoadError
        title="Your payments did not load"
        onRetry={() => failed.forEach((query) => void query.refetch())}
        retrying={failed.some((query) => query.isFetching)}
      >
        Sleeve could not read your payments from Robinhood Chain.
      </LoadError>
    );
  }

  const items = inbox.data;
  if (items.length === 0 && preview.data.unsorted === 0n) {
    return (
      <div className="flex max-w-form flex-col gap-stack">
        <EmptyState title="No payments yet">
          Payments sent to your address on Robinhood Chain show up here with what each one became. Nothing splits until USDG
          arrives from outside, and USDG you move in through Sleeve does not split.
        </EmptyState>
        <PaymentAddressCard address={account} showQr />
      </div>
    );
  }

  const records = receipts.data.pages.flatMap((page) => page.items);
  const exhausted = receipts.data.pages.at(-1)?.nextCursor === null;
  const byId = receiptsById(records);
  const summary = paymentsSummary(items, byId);
  const counts = paymentCounts(items);
  const shown = filterPayments(items, filter);
  const tickerId = preview.data.tickerId;

  return (
    <div className="flex flex-col gap-8">
      <StatStrip
        label="Payments so far"
        items={[
          {
            id: 'received',
            leading: <TokenIcon token="USDG" size="md" decorative />,
            label: (
              <span className="flex flex-wrap items-center gap-2">
                Received <SampleTag />
              </span>
            ),
            value: <Amount value={formatUsdg(summary.received)} unit="USDG" />,
            footer: summary.count === 1 ? 'In 1 payment.' : `In ${summary.count} payments.`,
          },
          {
            id: 'hands-free',
            icon: 'split',
            label: 'Sorted with no action from you',
            value: `${summary.sortedHandsFree} of ${summary.sortedKnown}`,
            footer: "By Sleeve's keeper, or by anyone once the one hour grace period passed.",
          },
          {
            id: 'unsorted',
            icon: 'clock',
            label: 'Not sorted yet',
            value: <Amount value={formatUsdg(summary.unsorted)} unit="USDG" />,
            footer:
              summary.unsortedCount === 0
                ? 'Every payment is sorted.'
                : `${summary.unsortedCount === 1 ? '1 payment' : `${summary.unsortedCount} payments`}, spendable now.`,
          },
        ]}
      />

      {preview.data.unsorted > 0n ? (
        <SortCard
          preview={preview.data}
          rule={rule.data}
          payments={counts.unsorted}
          reopensAt={market.data?.tickers.find((ticker) => ticker.tickerId === tickerId)?.session.nextOpenAt}
        />
      ) : null}

      <section aria-labelledby={listId} className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id={listId} className="text-h2 text-ink">
            Every payment
          </h2>
          <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
            {PAYMENT_FILTERS.map((option) => (
              <FilterPill key={option.id} pressed={filter === option.id} onClick={() => setFilter(option.id)}>
                <span className="flex items-center gap-2">
                  {option.label}
                  <CountBadge count={counts[option.id]} />
                </span>
              </FilterPill>
            ))}
          </div>
        </div>
        <p className="mb-3 mt-1 max-w-reading text-body-s text-ink-secondary">
          Read from Robinhood Chain transfer logs. The sender, the transaction hash and the split that sorted each payment are
          derived from those logs.
        </p>
        {shown.length === 0 ? (
          <EmptyState title={filter === 'sorted' ? 'Nothing sorted yet' : 'Every payment is sorted'} headingLevel={3}>
            {filter === 'sorted'
              ? 'Payments show here once your rule splits them.'
              : 'Payments that arrive show here until your rule splits them.'}
          </EmptyState>
        ) : (
          <PaymentList items={shown} byId={byId} records={records} exhausted={exhausted} />
        )}
      </section>
    </div>
  );
}

/**
 * Payments (D-024): every inbound USDG payment, who sent it, when, whether it is sorted, and what it became, with the
 * way to the details and proof of the split behind it. Unsorted USDG is spendable the whole time, and the owner can
 * sort it now. It renders inside the product shell, which supplies the main landmark, the navigation and the toasts.
 */
export function PaymentsScreen(): JSX.Element {
  const session = useSession();

  let body: JSX.Element;
  if (session.data === undefined) {
    body = session.isError ? (
      <LoadError title="Your session did not load" onRetry={() => void session.refetch()} retrying={session.isFetching}>
        Sleeve could not check whether you are signed in.
      </LoadError>
    ) : (
      <PaymentsSkeleton />
    );
  } else if (session.data === null) {
    body = <SignedOutPrompt />;
  } else {
    body = <AccountPayments key={session.data.account} account={session.data.account} />;
  }

  return (
    <div className="max-w-content">
      <PageHeader title={TITLE} description={DESCRIPTION} actions={<ReceiveAction />} />
      {body}
    </div>
  );
}
