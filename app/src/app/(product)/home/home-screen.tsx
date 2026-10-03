'use client';

import type { Address, Rule, TickerId } from '@sleeve/core';
import type { JSX } from 'react';

import { PaymentAddressCard } from '@/components/sleeve/payment-address-card';
import { ButtonLink } from '@/components/ui/button';
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

import { paymentsSummary, receiptsById } from '../payments/_lib/payments';
import { AllocationDonut } from './_components/allocation-donut';
import { CalendarCard } from './_components/calendar-card';
import { HelpCard } from './_components/help-card';
import { HomeSkeleton } from './_components/home-skeleton';
import { LoadError } from './_components/load-error';
import { MoneyCard } from './_components/money-card';
import { PaydaysCard } from './_components/paydays-card';
import { PaymentsCard } from './_components/payments-card';
import { SignedOutPrompt } from './_components/signed-out-prompt';
import { WaitingMoney } from './_components/waiting-money';
import { monthOfDay, newYorkDay, paydayPoints } from './_lib/overview';
import { unsortedPayments } from './_lib/payday';
import { homeHeadline } from './_lib/sentences';

/** Enough of the newest receipts for a dozen paydays and the receipts that ended their waits. */
const RECEIPTS_READ = 60;
const RECENT_PAYMENTS = 3;

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
        title={
          loading ? (
            <span aria-hidden="true" className="flex flex-col gap-2 md:gap-1.5">
              <Skeleton className="h-[1.15em] w-[36rem] max-w-full" />
              <Skeleton className="h-[1.15em] w-60 max-w-[70%] md:hidden" />
            </span>
          ) : (
            'Home'
          )
        }
        description={loading ? <Skeleton className="mt-1 h-10 w-[32rem] max-w-full md:h-5" /> : undefined}
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
 * Home as an overview (PRD 15, D-024, D-029). The money at a glance and the payment address come first at every
 * width, then what waits and the ways to act on it, then paydays over time beside the calendar, and the recent
 * payments, the Stock Tokens held and the common questions in one row. One column on a phone, two from 1024 px and
 * three from 1280 px; every card fills its cell, so rows end level.
 */
function HomeContent({ account, ledger, rule, holdings, buckets, inbox, receipts, exhausted, preview, market }: HomeContentProps): JSX.Element {
  const points = paydayPoints(receipts, exhausted);
  const unsorted = unsortedPayments(inbox);
  const byId = receiptsById(receipts);
  const summary = paymentsSummary(inbox, byId);
  const now = ledger.asOf.timestamp;
  const thisMonth = monthOfDay(newYorkDay(now));
  const paydaysThisMonth = points.filter((point) => {
    const month = monthOfDay(newYorkDay(point.at));
    return month.year === thisMonth.year && month.month === thisMonth.month;
  }).length;

  function reopensAt(tickerId: TickerId): bigint | null | undefined {
    return market?.tickers.find((ticker) => ticker.tickerId === tickerId)?.session.nextOpenAt;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3 xl:gap-5">
      <MoneyCard
        account={account}
        ledger={ledger}
        holdings={holdings}
        buckets={buckets}
        rule={rule}
        preview={preview}
        reopensAt={reopensAt}
        className="lg:col-span-2"
      />
      <div id="receive" className="flex min-w-0 scroll-mt-24 flex-col lg:col-span-2 xl:col-span-1">
        <PaymentAddressCard address={account} showQr layout="adaptive" className="flex-1 rounded-card sm:p-5 xl:p-6" />
      </div>
      <div className="min-w-0 empty:hidden lg:col-span-2 xl:col-span-3">
        <WaitingMoney
          preview={preview}
          unsortedPayments={unsorted.count}
          rule={rule}
          buckets={buckets}
          now={now}
          reopensAt={reopensAt}
        />
      </div>
      <PaydaysCard points={points} className="lg:col-span-2" />
      <CalendarCard points={points} tickerId={rule.tickerId} now={now} />
      <PaymentsCard items={inbox.slice(0, RECENT_PAYMENTS)} byId={byId} records={receipts} exhausted={exhausted} total={inbox.length} />
      <AllocationDonut holdings={holdings} buckets={buckets} />
      <HelpCard paydaysThisMonth={paydaysThisMonth} handsFree={{ sorted: summary.sortedHandsFree, of: summary.sortedKnown }} />
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
