'use client';

import type { Address } from '@sleeve/core';
import { useSearchParams } from 'next/navigation';
import { useState, type JSX, type ReactNode } from 'react';

import { LazyCardComposer } from '@/app/(product)/receipts/_components/lazy-card-composer';
import { actionCount } from '@/app/(product)/receipts/_lib/outcome';
import { Button, ButtonLink } from '@/components/ui/button';
import { ErrorBlock } from '@/components/ui/card';
import { CopyField } from '@/components/ui/copy-field';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { isDataLayerError } from '@/data/errors';
import { useReceipts, useSession, useSignIn } from '@/data/hooks';
import { useDataLayer } from '@/data/provider';
import type { ReceiptRecord } from '@/data/types';

import { HistoryRegister, HistoryRegisterSkeleton } from './_components/history-register';
import { HistoryToolbar } from './_components/history-toolbar';
import { fetchAllReceipts, historyCsvFileName, receiptsCsv, saveFile } from './_lib/csv';
import { NO_FILTERS, hasFilters, historyFiltersQuery, noMatchSentence, readHistoryFilters, type HistoryFilters } from './_lib/filters';

/**
 * History (PRD 7.10, D-024): every action Sleeve took on the owner's account, newest first and grouped by day,
 * filtered by ticker and status, a page at a time, with CSV export of everything the filters match. Each row opens
 * the action's details and proof. Filters live in the URL.
 */

const HISTORY_TITLE = 'History';
const HISTORY_DESCRIPTION =
  'Every payday split, buy, wait, release and sale on your account, newest first. Each one is recorded onchain, so anyone can check it.';

const PAGE_SIZE = 20;

export function HistoryScreen(): JSX.Element {
  const session = useSession();

  if (session.isPending) return <HistoryLoading />;
  if (session.isError) {
    return (
      <>
        <PageHeader title={HISTORY_TITLE} description={HISTORY_DESCRIPTION} />
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
  return <History account={session.data.account} />;
}

/** What the page shows before it knows anything: the header and the shape of the register. */
function HistoryLoading(): JSX.Element {
  return (
    <>
      <PageHeader title={HISTORY_TITLE} description={HISTORY_DESCRIPTION} />
      <HistoryRegisterSkeleton />
    </>
  );
}

function SignedOut(): JSX.Element {
  const signIn = useSignIn();
  const noPasskey = isDataLayerError(signIn.error) && signIn.error.code === 'PasskeyCancelled';
  return (
    <>
      <PageHeader title={HISTORY_TITLE} description={HISTORY_DESCRIPTION} />
      <EmptyState
        title="Sign in to see your history"
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
              {noPasskey ? 'Set up Sleeve' : 'Check a split by its number'}
            </ButtonLink>
          </div>
        }
      >
        Your history belongs to your account. Every split is public onchain too, so anyone can check one by its number.
      </EmptyState>
    </>
  );
}

type CsvState = { status: 'idle' } | { status: 'running' } | { status: 'failed' };

function History({ account }: { account: Address }): JSX.Element {
  const searchParams = useSearchParams();
  const filters = readHistoryFilters(searchParams);
  const actions = useReceipts({ account, tickerId: filters.tickerId, status: filters.status, limit: PAGE_SIZE });
  const layer = useDataLayer();
  const [csv, setCsv] = useState<CsvState>({ status: 'idle' });
  const [weekCard, setWeekCard] = useState({ open: false, key: 0 });

  const items = actions.data?.pages.flatMap((page) => page.items) ?? [];

  /** history.replaceState keeps Next's search params in step without a round trip to the server. */
  function applyFilters(next: HistoryFilters) {
    setCsv({ status: 'idle' });
    window.history.replaceState(null, '', `${window.location.pathname}${historyFiltersQuery(next)}`);
  }

  async function exportCsv() {
    setCsv({ status: 'running' });
    try {
      const records = await fetchAllReceipts(layer, { account, tickerId: filters.tickerId, status: filters.status });
      const fileName = historyCsvFileName(filters, { sample: layer.source === 'mock' });
      saveFile(new Blob([receiptsCsv(records)], { type: 'text/csv;charset=utf-8' }), fileName);
      setCsv({ status: 'idle' });
    } catch (error) {
      console.error('History CSV export failed', error);
      setCsv({ status: 'failed' });
    }
  }

  const actionsSlot = (
    <Button variant="secondary" icon="share" onClick={() => setWeekCard((current) => ({ open: true, key: current.key + 1 }))}>
      Make a week card
    </Button>
  );

  const download = (
    <Button variant="secondary" size="sm" icon="receive" onClick={exportCsv} busy={csv.status === 'running'} busyLabel="Preparing CSV">
      Download CSV
    </Button>
  );

  return (
    <>
      <PageHeader title={HISTORY_TITLE} description={HISTORY_DESCRIPTION} actions={actionsSlot} />
      <HistoryToolbar filters={filters} onChange={applyFilters} />
      {csv.status === 'failed' ? (
        <p role="alert" className="mt-4 text-body-s text-danger">
          The CSV did not download. Nothing changed on your account. Try again.
        </p>
      ) : null}
      <div className="mt-5">
        <ActionList
          account={account}
          filters={filters}
          state={actions}
          items={items}
          download={download}
          onClearFilters={() => applyFilters(NO_FILTERS)}
        />
      </div>
      {weekCard.key === 0 ? null : (
        <LazyCardComposer
          key={weekCard.key}
          open={weekCard.open}
          onClose={() => setWeekCard((current) => ({ ...current, open: false }))}
          subject={{ kind: 'week', account }}
        />
      )}
    </>
  );
}

interface ActionListProps {
  account: Address;
  filters: HistoryFilters;
  state: ReturnType<typeof useReceipts>;
  items: readonly ReceiptRecord[];
  /** The CSV button, shown above the register beside the count of what it exports. */
  download: ReactNode;
  onClearFilters: () => void;
}

function ActionList({ account, filters, state, items, download, onClearFilters }: ActionListProps): JSX.Element {
  if (state.isPending) return <HistoryRegisterSkeleton />;
  // A failed refresh keeps the actions already shown; only a first load that failed has nothing to show.
  if (state.isError && state.data === undefined) {
    return (
      <ErrorBlock
        title="Your history did not load"
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
          title="Nothing matches"
          action={
            <Button variant="secondary" onClick={onClearFilters}>
              Clear filters
            </Button>
          }
        >
          {noMatchSentence(filters)}
        </EmptyState>
      );
    }
    return (
      <EmptyState
        title="Nothing has happened yet"
        action={<CopyField label="Your payment address" value={account} copyLabel="Copy payment address" className="w-full text-left" />}
      >
        Nothing splits until USDG arrives from outside. Send USDG on Robinhood Chain to your payment address and the
        first payday shows here.
      </EmptyState>
    );
  }

  const count = actionCount(items.length);
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p aria-live="polite" className="text-body-s tabular-nums text-ink-secondary">
          {state.hasNextPage ? `${count} so far, newest first` : `${count}, newest first`}
        </p>
        {download}
      </div>
      <HistoryRegister records={items} />
      {state.hasNextPage ? (
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" onClick={() => state.fetchNextPage()} busy={state.isFetchingNextPage} busyLabel="Loading">
            Show older actions
          </Button>
        </div>
      ) : null}
      {state.isFetchNextPageError ? (
        <ErrorBlock
          title="Older actions did not load"
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
