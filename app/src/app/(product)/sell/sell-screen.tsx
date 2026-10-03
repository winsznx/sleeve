'use client';

import { type TickerId } from '@sleeve/core';
import Link from 'next/link';
import { useState, type JSX } from 'react';

import { StatusChip } from '@/app/(product)/receipts/_components/status-chip';
import { tickerSymbol, tokenText, usdgExactText } from '@/components/sleeve/text';
import { tickerTokenKey } from '@/components/token/ticker-icon';
import { TokenPair } from '@/components/token/token-stack';
import { Button, ButtonLink } from '@/components/ui/button';
import { ErrorBlock } from '@/components/ui/card';
import { DebtSecurityLine, ExitLine } from '@/components/ui/debt-security-line';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icons';
import { Skeleton, SkeletonGroup } from '@/components/ui/skeleton';
import { useHoldings, useMarket, useRule, useSell, useSession } from '@/data/hooks';
import type { ReceiptRecord, SellRequest } from '@/data/types';

import { useFocusOnArrival } from './focus';
import { SellFlow } from './sell-flow';
import { readErrorSentence, sellableTokens } from './sell-text';

export interface SellScreenProps {
  /** The Stock Token to start on, from the holding the owner came from (/sell?ticker=SPY). */
  initialTicker?: TickerId;
  /** The lot to start on, from a buy's details (/sell?ticker=SPY&lot=455). */
  initialLot?: bigint;
}

/**
 * Sell-back (PRD 7.5, SPEC 12): a swap card from a Stock Token to USDG, quoted as the owner types, with the holding,
 * its market and its lots beside it. Proceeds land in spend and are never split. Every read and the sell go through
 * the data layer, so the chain implementation replaces the mock without touching this screen.
 */
export function SellScreen({ initialTicker, initialLot }: SellScreenProps = {}): JSX.Element {
  const session = useSession();
  const account = session.data?.account;
  const holdings = useHoldings(account);
  const market = useMarket();
  const rule = useRule(account);
  const sell = useSell();
  const [chosen, setChosen] = useState<TickerId | null>(initialTicker ?? null);
  const resultFocus = useFocusOnArrival();

  if (session.isPending) return <SellLoading />;
  if (session.isError) {
    return (
      <ErrorBlock
        title="Your session did not load"
        className="max-w-reading"
        action={
          <Button variant="secondary" onClick={() => void session.refetch()}>
            Try again
          </Button>
        }
      >
        {readErrorSentence(session.error)}
      </ErrorBlock>
    );
  }
  if (session.data === null) return <SignedOut />;
  if (holdings.isPending) return <SellLoading />;
  if (holdings.isError) {
    return (
      <ErrorBlock
        title="Your Stock Tokens did not load"
        className="max-w-reading"
        action={
          <Button variant="secondary" onClick={() => void holdings.refetch()}>
            Try again
          </Button>
        }
      >
        {readErrorSentence(holdings.error)} Nothing moved. They are still in your account.
      </ErrorBlock>
    );
  }

  if (sell.isSuccess) {
    return <SaleResult records={sell.data} headingRef={resultFocus.target} onSellMore={() => sell.reset()} />;
  }

  const sellable = holdings.data.filter((holding) => sellableTokens(holding) > 0n);
  const active = sellable.find((holding) => holding.tickerId === chosen) ?? sellable[0];
  if (active === undefined) {
    const outsideOnly = holdings.data.some((holding) => holding.balance > 0n);
    return <NothingToSell outsideOnly={outsideOnly} />;
  }

  function choose(tickerId: TickerId) {
    setChosen(tickerId);
    if (sell.isError) sell.reset();
  }

  function handleSell(request: SellRequest) {
    resultFocus.request();
    sell.mutate(request);
  }

  const startLot = initialLot !== undefined && active.tickerId === initialTicker ? initialLot : undefined;

  return (
    <SellFlow
      key={active.tickerId}
      holding={active}
      initialLotId={startLot}
      holdings={holdings.data}
      market={market.data?.tickers.find((ticker) => ticker.tickerId === active.tickerId)}
      ruleCapBps={rule.data?.premiumCapBps}
      selling={sell.isPending}
      sellError={sell.isError ? sell.error : null}
      onSell={handleSell}
      onClearSellError={() => {
        if (sell.isError) sell.reset();
      }}
      onChooseTicker={choose}
    />
  );
}

function SellLoading(): JSX.Element {
  return (
    <SkeletonGroup label="Loading your Stock Tokens" className="grid gap-6 lg:grid-cols-[minmax(0,29rem)_minmax(0,1fr)]">
      <div className="rounded-card border border-border bg-surface p-4">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-4 h-32 w-full rounded-large" />
        <Skeleton className="mt-2 h-28 w-full rounded-large" />
        <Skeleton className="mt-4 h-12 w-full rounded-pill" />
      </div>
      <div className="rounded-module border border-border bg-surface p-card">
        <Skeleton className="size-icon-tile rounded-row" />
        <Skeleton className="mt-4 h-5 w-48" />
        <Skeleton className="mt-3 h-16 w-full rounded-row" />
      </div>
    </SkeletonGroup>
  );
}

function SignedOut(): JSX.Element {
  return (
    <EmptyState title="Sign in to sell" className="max-w-reading" action={<ButtonLink href="/onboard">Sign in</ButtonLink>}>
      Selling needs your passkey. Your Stock Tokens stay in your account until you sell them.
    </EmptyState>
  );
}

function NothingToSell({ outsideOnly }: { outsideOnly: boolean }): JSX.Element {
  return (
    <EmptyState
      title="Nothing to sell yet"
      className="max-w-reading"
      action={
        <ButtonLink href="/holdings" variant="secondary">
          See your holdings
        </ButtonLink>
      }
    >
      {outsideOnly
        ? 'The Stock Tokens in your account arrived outside Sleeve, so they cannot be sold here. Tokens your rule buys can be.'
        : 'Your equity share buys Stock Tokens as payments arrive. Once a buy fills, you can sell it back to USDG here.'}
    </EmptyState>
  );
}

interface SaleResultProps {
  records: readonly ReceiptRecord[];
  headingRef: (node: HTMLElement | null) => void;
  onSellMore: () => void;
}

/** A finished sell: what was sold, that the USDG went to spend unsplit, and each lot it drew from, oldest first. */
function SaleResult({ records, headingRef, onSellMore }: SaleResultProps): JSX.Element {
  const first = records[0];
  const tickerId = first?.receipt.tickerId;
  const symbol = tickerId === undefined ? '' : tickerSymbol(tickerId);
  const token = tickerId === undefined ? null : tickerTokenKey(tickerId);
  const tokens = records.reduce((sum, record) => sum + record.receipt.tokensIn, 0n);
  const proceeds = records.reduce((sum, record) => sum + record.receipt.usdgOut, 0n);
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,29rem)_minmax(0,1fr)] lg:items-start xl:gap-8">
      <section aria-labelledby="sale-result-title" className="min-w-0 overflow-hidden rounded-card border border-border bg-surface shadow-card">
        <div aria-hidden="true" className="h-2 bg-spend" />
        <div className="p-card md:p-6">
          <div className="flex items-center gap-4">
            {token === null ? null : <TokenPair from={token} to="USDG" size="xl" decorative />}
            <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-pill bg-success text-on-accent">
              <Icon name="check" />
            </span>
          </div>
          <h2 id="sale-result-title" ref={headingRef} tabIndex={-1} className="mt-4 text-figure-m text-ink">
            Sold {tokenText(tokens, symbol)}
          </h2>
          <DebtSecurityLine className="mt-0.5" />
          <p className="mt-3 text-body text-ink">
            <span className="tabular-nums">{usdgExactText(proceeds)}</span> went to spend. Sleeve does not split it.
          </p>
          <p className="mt-1 text-body-s text-ink-secondary">
            {records.length === 1 ? 'It drew from one lot.' : `It drew from ${records.length} lots, oldest first.`} Each sale is
            recorded onchain.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Button onClick={onSellMore}>Sell more</Button>
            <ButtonLink href="/holdings" variant="secondary">
              Back to holdings
            </ButtonLink>
            <ButtonLink href="/history" variant="ghost">
              See history
            </ButtonLink>
          </div>
        </div>
      </section>
      <section aria-labelledby="sale-lots-title" className="flex min-w-0 flex-col gap-4">
        <div className="overflow-hidden rounded-module border border-border bg-surface">
          <h3 id="sale-lots-title" className="border-b border-border px-4 py-3 text-h3 text-ink md:px-5">
            From your lots
          </h3>
          <ul>
            {records.map((record) => (
              <SoldLotRow key={record.receipt.id.toString()} record={record} symbol={symbol} />
            ))}
          </ul>
        </div>
        <ExitLine />
      </section>
    </div>
  );
}

/** One lot a sale drew from: what left it, what came back to spend, and the details of that sale. */
function SoldLotRow({ record, symbol }: { record: ReceiptRecord; symbol: string }): JSX.Element {
  const { receipt } = record;
  const token = tickerTokenKey(receipt.tickerId);
  const id = receipt.id.toString();
  return (
    <li className="relative flex items-start gap-3 border-t border-border px-4 py-3.5 transition-colors duration-fast ease-standard first:border-t-0 hover:bg-surface-muted md:px-5">
      {token === null ? null : <TokenPair from={token} to="USDG" size="md" decorative className="mt-0.5" />}
      <div className="min-w-0 flex-1">
        <p className="text-body font-medium text-ink">
          <Link
            href={`/receipts/${id}`}
            className="after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-focus"
          >
            Lot {receipt.lotId.toString()}
            <span className="sr-only">, sale number {id}</span>
          </Link>
        </p>
        <p className="mt-0.5 text-body-s text-ink-muted">
          {tokenText(receipt.tokensIn, symbol)} for {usdgExactText(receipt.usdgOut)}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <StatusChip status={receipt.status} />
        <span className="font-mono text-mono-s text-ink-muted">#{id}</span>
      </div>
    </li>
  );
}
