'use client';

import type { Address, Rule } from '@sleeve/core';
import Link from 'next/link';
import { useId, type JSX, type ReactNode } from 'react';

import { PaymentAddressCard } from '@/components/sleeve/payment-address-card';
import { ReceiptRow } from '@/components/sleeve/receipt-summary';
import { SleeveCard } from '@/components/sleeve/sleeve-card';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { List } from '@/components/ui/list';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { useBuckets, useHoldings, useInbox, useLedger, useMarket, useReceipts, useRule, useSession } from '@/data/hooks';
import type { BucketView, Holding, InboxItem, LedgerView, MarketSnapshot, ReceiptRecord } from '@/data/types';

import { HomeSkeleton } from './_components/home-skeleton';
import { LatestPayment } from './_components/latest-payment';
import { LoadError } from './_components/load-error';
import { SignedOutPrompt } from './_components/signed-out-prompt';
import { WaitingSection } from './_components/waiting-section';
import { latestPaymentSplit } from './_lib/latest-payment';
import { ruleSentence } from './_lib/sentences';

/** Enough of the newest receipts to find the latest payment split and show a few around it. */
const RECEIPTS_READ = 20;
const RECENT_SHOWN = 3;

const LINK =
  'inline-flex min-h-touch items-center text-body-s font-medium text-link underline underline-offset-4 hover:text-link-hover';

interface HomeHeaderProps {
  rule?: Rule;
  /** Holds the sentence's place while the rule loads. */
  loading?: boolean;
}

/** The page title and the sentence (PRD 15): what the owner's rule does with every payment. */
function HomeHeader({ rule, loading = false }: HomeHeaderProps): JSX.Element {
  let description: ReactNode;
  if (rule !== undefined) description = ruleSentence(rule);
  else if (loading) description = <Skeleton className="mt-1 h-4 w-80 max-w-full" />;

  return (
    <PageHeader
      title="Home"
      description={description}
      actions={
        rule === undefined ? undefined : (
          <ButtonLink href="/rule" variant={rule.status === 'NONE' ? 'primary' : 'secondary'} size="sm" icon="rule">
            {rule.status === 'NONE' ? 'Set your rule' : 'Edit rule'}
          </ButtonLink>
        )
      }
    />
  );
}

/** The receipts before the latest payment, newest first, each opening its receipt page. */
function RecentReceipts({ records }: { records: readonly ReceiptRecord[] }): JSX.Element {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h2 id={headingId} className="text-h2 text-ink">
          Recent receipts
        </h2>
        <Link href="/receipts" className={LINK}>
          See all receipts
        </Link>
      </div>
      <List className="mt-1">
        {records.map((record) => (
          <ReceiptRow key={record.receipt.id.toString()} record={record} href={`/receipts/${record.receipt.id}`} />
        ))}
      </List>
    </section>
  );
}

interface HomeContentProps {
  account: Address;
  ledger: LedgerView;
  rule: Rule;
  holdings: readonly Holding[];
  buckets: readonly BucketView[];
  inbox: readonly InboxItem[];
  /** The newest receipts, newest first. */
  receipts: readonly ReceiptRecord[];
  market: MarketSnapshot | undefined;
}

/**
 * Home with the account read (PRD 15, docs/DESIGN.md 12.1): the latest payment split, the two sleeves, what is
 * waiting, the payment address, then the receipts before it. Before anything has arrived, the address comes
 * first, because sharing it is the one thing to do.
 */
function HomeContent({ account, ledger, rule, holdings, buckets, inbox, receipts, market }: HomeContentProps): JSX.Element {
  const latest = latestPaymentSplit(receipts);
  const sleeves = (
    <div className="grid gap-stack sm:grid-cols-2 xl:grid-cols-1">
      <SleeveCard kind="spend" spend={ledger.spend} unsorted={ledger.unsorted} />
      <SleeveCard kind="equity" holdings={holdings} pending={ledger.pendingTotal} />
    </div>
  );
  const address = (
    <div id="receive" className="scroll-mt-6">
      <PaymentAddressCard address={account} showQr />
    </div>
  );

  const nothingArrived =
    latest === undefined && inbox.length === 0 && ledger.unsorted === 0n && ledger.pendingTotal === 0n;
  if (nothingArrived) {
    return (
      <div className="flex max-w-form flex-col gap-8">
        <EmptyState title="Nothing has arrived yet">
          Nothing splits until USDG arrives from outside. Top-ups through the app do not split. Share your payment
          address to get paid.
        </EmptyState>
        {address}
        {sleeves}
      </div>
    );
  }

  const recent = receipts.filter((record) => record !== latest).slice(0, RECENT_SHOWN);
  const unsortedPayments = inbox.filter((item) => item.state !== 'SORTED').length;
  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-8 xl:grid-cols-2 xl:items-start">
        <div className="flex min-w-0 flex-col gap-8">
          {latest === undefined ? null : (
            <LatestPayment key={latest.receipt.id.toString()} account={account} record={latest} />
          )}
          {sleeves}
        </div>
        <div className="flex min-w-0 flex-col gap-8">
          <WaitingSection
            unsorted={ledger.unsorted}
            unsortedPayments={unsortedPayments}
            rule={rule}
            buckets={buckets}
            now={ledger.asOf.timestamp}
            market={market}
          />
          {address}
        </div>
      </div>
      {recent.length === 0 ? null : <RecentReceipts records={recent} />}
    </div>
  );
}

/** Reads the signed-in account. The market snapshot only adds reopen times, so home shows without it. */
function AccountHome({ account }: { account: Address }): JSX.Element {
  const ledger = useLedger(account);
  const rule = useRule(account);
  const holdings = useHoldings(account);
  const buckets = useBuckets(account);
  const inbox = useInbox(account);
  const receipts = useReceipts({ account, limit: RECEIPTS_READ });
  const market = useMarket();

  const header = <HomeHeader rule={rule.data} loading />;
  if (
    ledger.data === undefined ||
    rule.data === undefined ||
    holdings.data === undefined ||
    buckets.data === undefined ||
    inbox.data === undefined ||
    receipts.data === undefined ||
    market.isPending
  ) {
    const failed = [ledger, rule, holdings, buckets, inbox, receipts].filter(
      (query) => query.data === undefined && query.isError,
    );
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
        receipts={receipts.data.pages[0]?.items ?? []}
        market={market.data}
      />
    </>
  );
}

/**
 * The first screen after sign in (PRD 15). It renders inside the product shell, which supplies the page's main
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
