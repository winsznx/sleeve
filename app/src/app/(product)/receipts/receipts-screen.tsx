'use client';

import { STATUSES, type Address, type Status, type TickerId } from '@sleeve/core';
import { useSearchParams } from 'next/navigation';
import { useId, useState, type JSX } from 'react';

import { ReceiptRow } from '@/components/sleeve/receipt-summary';
import { tickerSymbol } from '@/components/sleeve/text';
import { Button, ButtonLink } from '@/components/ui/button';
import { ErrorBlock } from '@/components/ui/card';
import { FilterPill } from '@/components/ui/choice';
import { CopyField } from '@/components/ui/copy-field';
import { EmptyState } from '@/components/ui/empty-state';
import { Select } from '@/components/ui/field';
import { List } from '@/components/ui/list';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton, SkeletonGroup } from '@/components/ui/skeleton';
import { isDataLayerError } from '@/data/errors';
import { useReceipts, useSession, useSignIn } from '@/data/hooks';
import { useDataLayer } from '@/data/provider';
import type { ReceiptRecord } from '@/data/types';

import { CardComposer } from './card-composer';
import {
  FILTER_TICKERS,
  NO_FILTERS,
  STATUS_OPTION_LABEL,
  hasFilters,
  readReceiptFilters,
  receiptFiltersQuery,
  type ReceiptFilters,
} from './receipt-filters';
import { fetchAllReceipts, receiptsCsv, receiptsCsvFileName, saveFile } from './receipts-csv';

/**
 * The receipt history (PRD 7.10): every receipt the owner's account wrote, newest first, filtered by ticker and
 * status, a page at a time, with CSV export of everything the filters match. Filters live in the URL.
 */

const RECEIPTS_TITLE = 'Receipts';
const RECEIPTS_DESCRIPTION =
  'Sleeve writes a receipt onchain for every split, buy, release and sale on your account. Anyone can recompute one.';

const PAGE_SIZE = 20;

export function ReceiptsScreen(): JSX.Element {
  const session = useSession();

  if (session.isPending) return <ReceiptsLoading />;
  if (session.isError) {
    return (
      <>
        <PageHeader title={RECEIPTS_TITLE} description={RECEIPTS_DESCRIPTION} />
        <ErrorBlock
          title="Your account did not load"
          fundsStillHere
          action={
            <Button variant="secondary" onClick={() => session.refetch()}>
              Try again
            </Button>
          }
        />
      </>
    );
  }
  if (session.data === null) return <SignedOut />;
  return <ReceiptHistory account={session.data.account} />;
}

/** What the page shows before it knows anything: the header and the shape of the list. */
function ReceiptsLoading(): JSX.Element {
  return (
    <>
      <PageHeader title={RECEIPTS_TITLE} description={RECEIPTS_DESCRIPTION} />
      <ReceiptListSkeleton />
    </>
  );
}

function ReceiptListSkeleton(): JSX.Element {
  return (
    <SkeletonGroup label="Loading receipts" className="overflow-hidden rounded-panel border border-border bg-surface">
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="flex items-start gap-3 border-t border-border px-4 py-3.5 first:border-t-0 md:px-5 md:py-4">
          <div className="min-w-0 flex-1">
            <Skeleton className="h-4 w-40 max-w-full" />
            <Skeleton className="mt-2.5 h-5 w-48 max-w-full rounded-control" />
            <Skeleton className="mt-2 h-3.5 w-32" />
          </div>
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </SkeletonGroup>
  );
}

function SignedOut(): JSX.Element {
  const signIn = useSignIn();
  const noPasskey = isDataLayerError(signIn.error) && signIn.error.code === 'PasskeyCancelled';
  return (
    <>
      <PageHeader title={RECEIPTS_TITLE} description={RECEIPTS_DESCRIPTION} />
      <EmptyState
        title="Sign in to see your receipts"
        action={
          <div className="flex flex-col items-center gap-3">
            <Button onClick={() => signIn.mutate()} busy={signIn.isPending} busyLabel="Signing in">
              Sign in with your passkey
            </Button>
            {signIn.isError ? (
              <p role="alert" className="text-body-s text-danger">
                {noPasskey ? 'There is no Sleeve passkey on this device yet.' : 'Sign in did not finish. Try again.'}
              </p>
            ) : null}
            <ButtonLink href={noPasskey ? '/onboard' : '/verify'} variant="ghost" size="sm">
              {noPasskey ? 'Set up Sleeve' : 'Recompute a receipt by number'}
            </ButtonLink>
          </div>
        }
      >
        Your receipts belong to your account. Receipts are public too, so anyone can recompute one by its number.
      </EmptyState>
    </>
  );
}

type CsvState = { status: 'idle' } | { status: 'running' } | { status: 'failed' };

function ReceiptHistory({ account }: { account: Address }): JSX.Element {
  const searchParams = useSearchParams();
  const filters = readReceiptFilters(searchParams);
  const receipts = useReceipts({ account, tickerId: filters.tickerId, status: filters.status, limit: PAGE_SIZE });
  const layer = useDataLayer();
  const [csv, setCsv] = useState<CsvState>({ status: 'idle' });
  const [weekCard, setWeekCard] = useState({ open: false, key: 0 });

  const items = receipts.data?.pages.flatMap((page) => page.items) ?? [];

  /** history.replaceState keeps Next's search params in step without a round trip to the server. */
  function applyFilters(next: ReceiptFilters) {
    setCsv({ status: 'idle' });
    window.history.replaceState(null, '', `${window.location.pathname}${receiptFiltersQuery(next)}`);
  }

  async function exportCsv() {
    setCsv({ status: 'running' });
    try {
      const records = await fetchAllReceipts(layer, { account, tickerId: filters.tickerId, status: filters.status });
      saveFile(new Blob([receiptsCsv(records)], { type: 'text/csv;charset=utf-8' }), receiptsCsvFileName(filters));
      setCsv({ status: 'idle' });
    } catch (error) {
      console.error('Receipt CSV export failed', error);
      setCsv({ status: 'failed' });
    }
  }

  const actions = (
    <>
      <Button variant="secondary" onClick={() => setWeekCard((current) => ({ open: true, key: current.key + 1 }))}>
        Make a week card
      </Button>
      {items.length > 0 ? (
        <Button variant="secondary" onClick={exportCsv} busy={csv.status === 'running'} busyLabel="Preparing CSV">
          Download CSV
        </Button>
      ) : null}
    </>
  );

  return (
    <>
      <PageHeader title={RECEIPTS_TITLE} description={RECEIPTS_DESCRIPTION} actions={actions} />
      {csv.status === 'failed' ? (
        <p role="alert" className="-mt-2 mb-5 text-body-s text-danger">
          The CSV did not download. Nothing changed on your account. Try again.
        </p>
      ) : null}
      <Filters filters={filters} onChange={applyFilters} />
      <div className="mt-5">
        <ReceiptList account={account} filters={filters} state={receipts} items={items} onClearFilters={() => applyFilters(NO_FILTERS)} />
      </div>
      <CardComposer
        key={weekCard.key}
        open={weekCard.open}
        onClose={() => setWeekCard((current) => ({ ...current, open: false }))}
        subject={{ kind: 'week', account }}
      />
    </>
  );
}

function Filters({ filters, onChange }: { filters: ReceiptFilters; onChange: (next: ReceiptFilters) => void }): JSX.Element {
  const tickerLabelId = useId();
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between md:gap-6">
      <div className="min-w-0">
        <div id={tickerLabelId} className="mb-2 text-body-s font-semibold text-ink">
          Ticker
        </div>
        <div role="group" aria-labelledby={tickerLabelId} className="flex flex-wrap gap-2">
          <FilterPill pressed={filters.tickerId === undefined} onClick={() => onChange({ ...filters, tickerId: undefined })}>
            All tickers
          </FilterPill>
          {FILTER_TICKERS.map((ticker) => (
            <FilterPill
              key={ticker.id}
              pressed={filters.tickerId === ticker.id}
              onClick={() => onChange({ ...filters, tickerId: ticker.id })}
            >
              {ticker.symbol}
            </FilterPill>
          ))}
        </div>
      </div>
      <Select
        label="Status"
        className="md:w-60 md:shrink-0"
        value={filters.status ?? ''}
        onChange={(event) => onChange({ ...filters, status: STATUSES.find((status) => status === event.target.value) })}
      >
        <option value="">All statuses</option>
        {STATUSES.map((status) => (
          <option key={status} value={status}>
            {STATUS_OPTION_LABEL[status]}
          </option>
        ))}
      </Select>
    </div>
  );
}

/** "SPY receipts that are filled", in words, for the empty state of a filtered list. */
function filterWords(tickerId: TickerId | undefined, status: Status | undefined): string {
  const subject = tickerId === undefined ? 'receipts' : `${tickerSymbol(tickerId)} receipts`;
  if (status === undefined) return `There are no ${subject} on your account yet.`;
  return `There are no ${subject} with the status ${STATUS_OPTION_LABEL[status].toLowerCase()} on your account yet.`;
}

interface ReceiptListProps {
  account: Address;
  filters: ReceiptFilters;
  state: ReturnType<typeof useReceipts>;
  items: readonly ReceiptRecord[];
  onClearFilters: () => void;
}

function ReceiptList({ account, filters, state, items, onClearFilters }: ReceiptListProps): JSX.Element {
  if (state.isPending) return <ReceiptListSkeleton />;
  // A failed refresh keeps the receipts already shown; only a first load that failed has nothing to show.
  if (state.isError && state.data === undefined) {
    return (
      <ErrorBlock
        title="Your receipts did not load"
        fundsStillHere
        action={
          <Button variant="secondary" onClick={() => state.refetch()}>
            Try again
          </Button>
        }
      />
    );
  }
  if (items.length === 0) {
    if (hasFilters(filters)) {
      return (
        <EmptyState
          title="No receipts match"
          action={
            <Button variant="secondary" onClick={onClearFilters}>
              Clear filters
            </Button>
          }
        >
          {filterWords(filters.tickerId, filters.status)}
        </EmptyState>
      );
    }
    return (
      <EmptyState
        title="No receipts yet"
        action={<CopyField label="Your payment address" value={account} copyLabel="Copy payment address" className="w-full text-left" />}
      >
        Nothing splits until USDG arrives from outside. Send USDG on Robinhood Chain to your payment address and the first
        receipt appears here.
      </EmptyState>
    );
  }

  const count = items.length === 1 ? '1 receipt' : `${items.length} receipts`;
  return (
    <>
      <List label="Receipts">
        {items.map((record) => (
          <ReceiptRow key={record.receipt.id.toString()} record={record} href={`/receipts/${record.receipt.id}`} />
        ))}
      </List>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p aria-live="polite" className="text-body-s text-ink-muted tabular-nums">
          {state.hasNextPage ? `${count} so far, newest first` : `${count}, newest first`}
        </p>
        {state.hasNextPage ? (
          <Button variant="secondary" size="sm" onClick={() => state.fetchNextPage()} busy={state.isFetchingNextPage} busyLabel="Loading">
            Show older receipts
          </Button>
        ) : null}
      </div>
      {state.isFetchNextPageError ? (
        <ErrorBlock
          title="Older receipts did not load"
          className="mt-4"
          action={
            <Button variant="secondary" size="sm" onClick={() => state.fetchNextPage()}>
              Try again
            </Button>
          }
        />
      ) : null}
    </>
  );
}
