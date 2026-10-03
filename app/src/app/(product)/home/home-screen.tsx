'use client';

import { TOTAL_BPS, type Address, type Rule, type TickerId } from '@sleeve/core';
import Link from 'next/link';
import type { JSX, ReactNode } from 'react';

import { PaymentAddressCard } from '@/components/sleeve/payment-address-card';
import { SpendTile, StockTokensTile } from '@/components/sleeve/sleeve-tile';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icons';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useBuckets,
  useHoldings,
  useInbox,
  useLedger,
  useMarket,
  useReceipts,
  useRule,
  useSession,
  useSplitPreview,
} from '@/data/hooks';
import type { BucketView, Holding, InboxItem, LedgerView, MarketSnapshot, ReceiptRecord, SplitPreview } from '@/data/types';

import { receiptsById, waitEndOf } from '../payments/_lib/payments';
import { PaydayPreview } from '../rule/_components/payday-preview';
import { SortCard } from '../payments/_components/sort-card';
import { HoldingsOverview } from './_components/holdings-overview';
import { HomeSkeleton } from './_components/home-skeleton';
import { LoadError } from './_components/load-error';
import { PaydayHero } from './_components/payday-hero';
import { RecentPayments } from './_components/recent-payments';
import { SignedOutPrompt } from './_components/signed-out-prompt';
import { WaitingMoney } from './_components/waiting-money';
import { latestPayday, unsortedPayments } from './_lib/payday';
import { homeHeadline } from './_lib/sentences';

/** Enough of the newest receipts to find this payday and to tell how its wait ended. */
const RECEIPTS_READ = 20;
const RECENT_PAYMENTS = 4;

interface HomeHeaderProps {
  rule?: Rule;
  /** Holds the sentence's place while the rule loads. */
  loading?: boolean;
}

/** The sentence (PRD 15): what the owner's rule does with every payment, and the way to change it. */
function HomeHeader({ rule, loading = false }: HomeHeaderProps): JSX.Element {
  if (rule === undefined) {
    return (
      <PageHeader
        title={loading ? <Skeleton className="h-8 w-96 max-w-full" /> : 'Home'}
        description={loading ? <Skeleton className="mt-1 h-4 w-80 max-w-full" /> : undefined}
      />
    );
  }
  const headline = homeHeadline(rule);
  return (
    <PageHeader
      title={headline.title}
      description={headline.lede}
      actions={
        <ButtonLink href="/rule" variant={rule.status === 'NONE' ? 'primary' : 'secondary'} size="sm" icon="rule">
          {rule.status === 'NONE' ? 'Set your rule' : 'Edit rule'}
        </ButtonLink>
      }
    />
  );
}

/** The way to the full record, quiet at the foot of Home: proof stays one step behind the split (D-024). */
function HistoryLink(): JSX.Element {
  return (
    <Link
      href="/history"
      className="group flex items-center gap-3 rounded-module border border-border bg-surface-muted p-4 transition-colors duration-fast ease-standard hover:border-border-strong"
    >
      <span className="grid size-icon-tile shrink-0 place-items-center rounded-row bg-surface text-ink-secondary">
        <Icon name="receipt" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-body font-semibold text-ink">History</span>
        <span className="block text-body-s text-ink-secondary">
          Every split, buy, wait, release and sale on your account, each one checkable on chain. Export it as CSV.
        </span>
      </span>
      <Icon name="chevronRight" className="size-4 shrink-0 text-ink-secondary" />
    </Link>
  );
}

interface HomeContentProps {
  account: Address;
  ledger: LedgerView;
  rule: Rule;
  holdings: readonly Holding[];
  buckets: readonly BucketView[];
  inbox: readonly InboxItem[];
  /** The newest receipts, newest first, and whether every older one has been read. */
  receipts: readonly ReceiptRecord[];
  exhausted: boolean;
  preview: SplitPreview;
  market: MarketSnapshot | undefined;
}

/**
 * Home with the account read (PRD 15, D-024): this payday's split leads, beside the two sleeves; then what is waiting
 * and the payment address; then the holdings and the latest payments; History last. Before anything has arrived the
 * address leads, because sharing it is the one thing to do.
 */
function HomeContent({ account, ledger, rule, holdings, buckets, inbox, receipts, exhausted, preview, market }: HomeContentProps): JSX.Element {
  const payday = latestPayday(receipts, inbox);
  const unsorted = unsortedPayments(inbox);
  const byId = receiptsById(receipts);

  function reopensAt(tickerId: TickerId): bigint | null | undefined {
    return market?.tickers.find((ticker) => ticker.tickerId === tickerId)?.session.nextOpenAt;
  }

  const sleeves = (
    <div className="grid gap-stack sm:grid-cols-2 xl:grid-cols-1">
      <SpendTile spend={ledger.spend} unsorted={ledger.unsorted} />
      <StockTokensTile holdings={holdings} pending={ledger.pendingTotal} />
    </div>
  );
  const address = (
    <div id="receive" className="min-w-0 scroll-mt-24">
      <PaymentAddressCard address={account} showQr />
    </div>
  );

  const nothingArrived = payday === null && inbox.length === 0 && ledger.unsorted === 0n && ledger.pendingTotal === 0n;
  if (nothingArrived) {
    return (
      <div className="flex flex-col gap-8">
        <div className="grid gap-stack xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] xl:items-start">
          <div className="flex min-w-0 flex-col gap-stack">
            <EmptyState title="Nothing has arrived yet" className="bg-surface">
              Nothing splits until USDG arrives from outside. Top-ups through the app do not split. Share your payment address
              to get paid.
            </EmptyState>
            {address}
          </div>
          <div className="flex min-w-0 flex-col gap-stack">
            {sleeves}
            {rule.status === 'ACTIVE' ? <PaydayPreview input={{ ...rule, spendBps: TOTAL_BPS - rule.equityBps }} /> : null}
          </div>
        </div>
        <HistoryLink />
      </div>
    );
  }

  let hero: ReactNode;
  if (payday !== null) {
    const waitEnd = payday.record.receipt.status === 'QUEUED' ? waitEndOf(payday.record, receipts, exhausted) : null;
    hero = (
      <PaydayHero
        key={payday.record.receipt.id.toString()}
        account={account}
        payday={payday}
        rule={rule}
        buckets={buckets}
        waitEnd={waitEnd}
        newer={unsorted}
      />
    );
  } else {
    hero = (
      <SortCard preview={preview} rule={rule} payments={unsorted.count} reopensAt={reopensAt(preview.tickerId)} className="shadow-card" />
    );
  }

  const recent = inbox.slice(0, RECENT_PAYMENTS);
  const waiting = (
    <WaitingMoney
      preview={payday === null ? { ...preview, unsorted: 0n } : preview}
      unsortedPayments={unsorted.count}
      rule={rule}
      buckets={buckets}
      now={ledger.asOf.timestamp}
      reopensAt={reopensAt}
    />
  );
  const somethingWaits = (payday !== null && preview.unsorted > 0n) || buckets.length > 0;

  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-stack xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] xl:items-start">
        {hero}
        {sleeves}
      </div>
      {somethingWaits ? (
        <div className="grid gap-8 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] xl:items-start">
          {waiting}
          {address}
        </div>
      ) : (
        <div className="max-w-form">{address}</div>
      )}
      <div className="grid gap-8 xl:grid-cols-2 xl:items-start">
        <HoldingsOverview holdings={holdings} />
        <RecentPayments items={recent} byId={byId} records={receipts} exhausted={exhausted} />
      </div>
      <HistoryLink />
    </div>
  );
}

/** Reads the signed-in account. The market snapshot only adds reopen times and countdowns, so Home shows without it. */
function AccountHome({ account }: { account: Address }): JSX.Element {
  const ledger = useLedger(account);
  const rule = useRule(account);
  const holdings = useHoldings(account);
  const buckets = useBuckets(account);
  const inbox = useInbox(account);
  const receipts = useReceipts({ account, limit: RECEIPTS_READ });
  const preview = useSplitPreview(account);
  const market = useMarket();

  const header = <HomeHeader rule={rule.data} loading />;
  const reads = [ledger, rule, holdings, buckets, inbox, receipts, preview];
  if (
    ledger.data === undefined ||
    rule.data === undefined ||
    holdings.data === undefined ||
    buckets.data === undefined ||
    inbox.data === undefined ||
    receipts.data === undefined ||
    preview.data === undefined ||
    market.isPending
  ) {
    const failed = reads.filter((query) => query.data === undefined && query.isError);
    return (
      <>
        {header}
        {failed.length === 0 ? (
          <HomeSkeleton />
        ) : (
          <LoadError
            title="Your account did not load"
            onRetry={() => failed.forEach((query) => void query.refetch())}
            retrying={failed.some((query) => query.isFetching)}
          >
            Sleeve could not read your balances from Robinhood Chain.
          </LoadError>
        )}
      </>
    );
  }

  const pages = receipts.data.pages;
  return (
    <>
      {header}
      <HomeContent
        account={account}
        ledger={ledger.data}
        rule={rule.data}
        holdings={holdings.data}
        buckets={buckets.data}
        inbox={inbox.data}
        receipts={pages.flatMap((page) => page.items)}
        exhausted={pages.at(-1)?.nextCursor === null}
        preview={preview.data}
        market={market.data}
      />
    </>
  );
}

/**
 * The first screen after sign in (PRD 15, D-024). It renders inside the product shell, which supplies the page's main
 * landmark, the navigation and the toasts.
 */
export function HomeScreen(): JSX.Element {
  const session = useSession();

  let body: JSX.Element;
  if (session.data === undefined) {
    body = session.isError ? (
      <>
        <HomeHeader />
        <LoadError title="Your session did not load" onRetry={() => void session.refetch()} retrying={session.isFetching}>
          Sleeve could not check whether you are signed in.
        </LoadError>
      </>
    ) : (
      <>
        <HomeHeader loading />
        <HomeSkeleton />
      </>
    );
  } else if (session.data === null) {
    body = (
      <>
        <HomeHeader />
        <SignedOutPrompt />
      </>
    );
  } else {
    body = <AccountHome key={session.data.account} account={session.data.account} />;
  }

  return <div className="max-w-content">{body}</div>;
}
