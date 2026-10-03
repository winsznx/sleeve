'use client';

import type { Address, TickerId } from '@sleeve/core';
import type { JSX } from 'react';

import { Button, ButtonLink } from '@/components/ui/button';
import { ErrorBlock, Note } from '@/components/ui/card';
import { CopyField } from '@/components/ui/copy-field';
import { ExitLine } from '@/components/ui/debt-security-line';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton, SkeletonGroup, SkeletonText } from '@/components/ui/skeleton';
import { isDataLayerError } from '@/data/errors';
import { useBuckets, useHoldings, useMarket, useRule, useSession, useSignIn } from '@/data/hooks';
import type { BucketView } from '@/data/types';

import { AllocationCard } from './_components/allocation-card';
import { HoldingCard } from './_components/holding-card';
import { WaitingStrip } from './_components/waiting-strip';
import { allocationOf, byValue, sessionWords } from './_lib/holdings';

/**
 * Holdings (D-024): the Stock Tokens the owner's paydays bought, each with its icon, balance, value at the Chainlink
 * reference with that price's time, the pool price on its own line, its lots and the way to sell it back to USDG.
 * An allocation bar shows how they divide by value, and USDG waiting to buy sits under the holding it will add to,
 * with its release on Home. Every read goes through the data layer.
 */

const TITLE = 'Holdings';
const DESCRIPTION = 'The Stock Tokens your paydays bought, valued at the Chainlink reference. Sell any of them back to USDG.';
const STILL_HERE = 'Nothing moved. Your Stock Tokens are still in your account.';

export function HoldingsScreen(): JSX.Element {
  const session = useSession();

  if (session.isPending) return <HoldingsLoading />;
  if (session.isError) {
    return (
      <>
        <PageHeader title={TITLE} description={DESCRIPTION} />
        <ErrorBlock
          title="Your account did not load"
          action={
            <Button variant="secondary" onClick={() => session.refetch()}>
              Try again
            </Button>
          }
        >
          {STILL_HERE}
        </ErrorBlock>
      </>
    );
  }
  if (session.data === null) return <SignedOut />;
  return <Holdings account={session.data.account} />;
}

function HoldingsSkeleton(): JSX.Element {
  return (
    <SkeletonGroup label="Loading your holdings" className="flex flex-col gap-stack">
      <div className="rounded-module border border-border bg-surface p-card md:p-6">
        <Skeleton className="h-4 w-56" />
        <Skeleton className="mt-3 h-9 w-48" />
        <Skeleton className="mt-5 h-11 w-full rounded-row" />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
        </div>
      </div>
      <div className="grid gap-stack xl:grid-cols-2">
        {[0, 1].map((card) => (
          <div key={card} className="rounded-module border border-border bg-surface p-card md:p-6">
            <div className="flex items-center gap-3">
              <Skeleton className="size-icon-tile rounded-row" />
              <Skeleton className="h-5 w-24" />
            </div>
            <SkeletonText lines={3} className="mt-5" />
            <Skeleton className="mt-5 h-24 w-full rounded-row" />
          </div>
        ))}
      </div>
    </SkeletonGroup>
  );
}

function HoldingsLoading(): JSX.Element {
  return (
    <>
      <PageHeader title={TITLE} description={DESCRIPTION} />
      <HoldingsSkeleton />
    </>
  );
}

function SignedOut(): JSX.Element {
  const signIn = useSignIn();
  const noPasskey = isDataLayerError(signIn.error) && signIn.error.code === 'PasskeyCancelled';
  return (
    <>
      <PageHeader title={TITLE} description={DESCRIPTION} />
      <EmptyState
        title="Sign in to see your holdings"
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
            {noPasskey ? (
              <ButtonLink href="/onboard" variant="ghost" size="sm">
                Set up Sleeve
              </ButtonLink>
            ) : null}
          </div>
        }
      >
        Your Stock Tokens sit in your own account. Sign in to see them and sell any of them back to USDG.
      </EmptyState>
    </>
  );
}

function Holdings({ account }: { account: Address }): JSX.Element {
  const holdings = useHoldings(account);
  const market = useMarket();
  const rule = useRule(account);
  const buckets = useBuckets(account);

  if (holdings.isPending) return <HoldingsLoading />;
  if (holdings.isError) {
    return (
      <>
        <PageHeader title={TITLE} description={DESCRIPTION} />
        <ErrorBlock
          title="Your holdings did not load"
          action={
            <Button variant="secondary" onClick={() => holdings.refetch()}>
              Try again
            </Button>
          }
        >
          {STILL_HERE}
        </ErrorBlock>
      </>
    );
  }

  const held = byValue(holdings.data.filter((holding) => holding.balance > 0n));
  const tickers = market.data?.tickers ?? [];
  const waiting = (buckets.data ?? []).filter((bucket) => bucket.amount > 0n);

  /** A wait on the market session ends at the reopen; any other wait has no time to give. */
  function reopensAt(tickerId: TickerId): bigint | null {
    const session = tickers.find((ticker) => ticker.tickerId === tickerId)?.session;
    return session === undefined || session.open ? null : session.nextOpenAt;
  }

  function strip(bucket: BucketView, holdsTicker: boolean, className?: string): JSX.Element {
    return (
      <WaitingStrip
        key={bucket.tickerId}
        bucket={bucket}
        reopensAt={reopensAt(bucket.tickerId)}
        rule={rule.data ?? null}
        holdsTicker={holdsTicker}
        className={className}
      />
    );
  }

  if (held.length === 0) {
    return (
      <>
        <PageHeader title={TITLE} description={DESCRIPTION} />
        {waiting.length === 0 ? (
          <EmptyState
            title="No Stock Tokens yet"
            action={<CopyField label="Your payment address" value={account} copyLabel="Copy payment address" className="w-full text-left" />}
          >
            Nothing splits until USDG arrives from outside. When a payday arrives at your payment address, your rule buys its
            Stock Token with the equity share and it shows here.
          </EmptyState>
        ) : (
          <EmptyState title="Nothing bought yet" action={<div className="flex w-full flex-col gap-2.5 text-left">{waiting.map((bucket) => strip(bucket, false))}</div>}>
            Your equity share waits as USDG in your account until the guard clears. Once it buys, the Stock Token shows here.
          </EmptyState>
        )}
      </>
    );
  }

  const first = held[0];
  const firstMarket = first === undefined ? undefined : tickers.find((ticker) => ticker.tickerId === first.tickerId);
  const lots = held.reduce((count, holding) => count + holding.lots.length, 0);
  const waitingElsewhere = waiting.filter((bucket) => !held.some((holding) => holding.tickerId === bucket.tickerId));

  return (
    <>
      <PageHeader title={TITLE} description={DESCRIPTION} />
      <div className="flex flex-col gap-stack">
        <AllocationCard
          allocation={allocationOf(held)}
          holdingCount={held.length}
          lots={lots}
          session={firstMarket === undefined ? null : sessionWords(firstMarket.session)}
          rule={rule.data ?? null}
        />
        {market.isError ? (
          <Note title="Live market data did not load">
            Values use the Chainlink price each holding carries. Pool prices and the market session show once the market
            loads.
          </Note>
        ) : null}
        <div className="grid gap-stack xl:grid-cols-2 xl:items-start">
          {held.map((holding) => {
            const bucket = waiting.find((candidate) => candidate.tickerId === holding.tickerId);
            return (
              <HoldingCard
                key={holding.tickerId}
                holding={holding}
                market={tickers.find((ticker) => ticker.tickerId === holding.tickerId)}
                waiting={bucket === undefined ? undefined : strip(bucket, true)}
              />
            );
          })}
        </div>
        {waitingElsewhere.length === 0 ? null : (
          <section aria-labelledby="waiting-elsewhere-title" className="min-w-0">
            <h2 id="waiting-elsewhere-title" className="text-h3 text-ink">
              Waiting to buy
            </h2>
            <div className="mt-3 grid gap-2.5 xl:grid-cols-2">{waitingElsewhere.map((bucket) => strip(bucket, false))}</div>
          </section>
        )}
        <section aria-labelledby="selling-title" className="rounded-module border border-border bg-surface-muted p-card md:p-6">
          <h2 id="selling-title" className="text-h3 text-ink">
            How selling works
          </h2>
          <p className="mt-1 max-w-reading text-body-s text-ink-secondary">
            Sleeve sells from the lots its rule bought, oldest first, through an allowlisted pool, and only within your cap
            below the Chainlink reference. The USDG goes to spend and is never split.
          </p>
          <ExitLine className="mt-2 max-w-reading" />
        </section>
      </div>
    </>
  );
}
