'use client';

import { formatStockToken, formatUsdg, tickerById, type TickerId } from '@sleeve/core';
import { useId, useState, type JSX } from 'react';

import { TickerIcon } from '@/components/token/ticker-icon';
import { ReceiptSummary } from '@/components/sleeve/receipt-summary';
import { tickerSymbol, tokenText, usdgExactText } from '@/components/sleeve/text';
import { Amount } from '@/components/ui/amount';
import { Button, ButtonLink } from '@/components/ui/button';
import { ErrorBlock, Note } from '@/components/ui/card';
import { DebtSecurityLine, ExitLine } from '@/components/ui/debt-security-line';
import { EmptyState } from '@/components/ui/empty-state';
import { formatNewYork, formatUtc } from '@/components/ui/format-time';
import { GatedCard } from '@/components/ui/gated-card';
import { Icon } from '@/components/ui/icons';
import { Skeleton, SkeletonGroup } from '@/components/ui/skeleton';
import { useHoldings, useMarket, useRule, useSell, useSession } from '@/data/hooks';
import type { Holding, ReceiptRecord, SellRequest } from '@/data/types';

import { ChoiceCard } from './choice-card';
import { useFocusOnArrival } from './focus';
import { SellFlow } from './sell-flow';
import { readErrorSentence, sellableTokens, tokensOutsideLots } from './sell-text';

/**
 * Sell-back (PRD 7.5, SPEC 12): pick a holding, choose an amount or a lot, get a quote, sell. Proceeds land in spend
 * and are never split. Every read and the sell go through the data layer, so the chain implementation replaces the
 * mock without touching this screen.
 */
export function SellScreen(): JSX.Element {
  const session = useSession();
  const account = session.data?.account;
  const holdings = useHoldings(account);
  const market = useMarket();
  const rule = useRule(account);
  const sell = useSell();
  const [chosen, setChosen] = useState<TickerId | null>(null);
  const resultFocus = useFocusOnArrival();
  const groupName = useId();
  const headingId = useId();

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
  const outsideOnly = holdings.data.filter((holding) => sellableTokens(holding) === 0n && holding.balance > 0n);
  const active = sellable.find((holding) => holding.tickerId === chosen) ?? sellable[0];
  if (active === undefined) return <NothingToSell outsideOnly={outsideOnly} />;

  const marketSession = market.data?.tickers.find((ticker) => ticker.tickerId === active.tickerId)?.session;
  const selling = sell.isPending;

  function choose(tickerId: TickerId) {
    setChosen(tickerId);
    if (sell.isError) sell.reset();
  }

  function handleSell(request: SellRequest) {
    resultFocus.request();
    sell.mutate(request);
  }

  return (
    <div className="flex max-w-reading flex-col gap-8">
      {marketSession === undefined || marketSession.open ? null : (
        <Note title="The market is closed">
          {marketSession.nextOpenAt === null
            ? 'Sells wait until it reopens.'
            : `Sells wait until it reopens, ${formatNewYork(marketSession.nextOpenAt)}.`}
        </Note>
      )}

      <section aria-labelledby={headingId} className="flex flex-col gap-4">
        <h2 id={headingId} className="text-h2 text-ink">
          What to sell
        </h2>
        <div role="radiogroup" aria-labelledby={headingId} className="flex flex-col gap-2.5">
          {sellable.map((holding) => (
            <HoldingChoice
              key={holding.tickerId}
              holding={holding}
              name={groupName}
              checked={holding.tickerId === active.tickerId}
              onSelect={() => choose(holding.tickerId)}
              disabled={selling}
            />
          ))}
        </div>
        {outsideOnly.map((holding) => (
          <p key={holding.tickerId} className="text-body-s text-ink-muted">
            {tokenText(holding.balance, tickerSymbol(holding.tickerId))} arrived outside Sleeve and cannot be sold here.
          </p>
        ))}
      </section>

      <SellFlow
        key={active.tickerId}
        holding={active}
        ruleCapBps={rule.data?.premiumCapBps}
        selling={selling}
        sellError={sell.isError ? sell.error : null}
        onSell={handleSell}
        onClearSellError={() => {
          if (sell.isError) sell.reset();
        }}
      />

      <GatedCard>Borrowing USDG against your Stock Tokens is not available yet.</GatedCard>
    </div>
  );
}

interface HoldingChoiceProps {
  holding: Holding;
  name: string;
  checked: boolean;
  onSelect: () => void;
  disabled: boolean;
}

function holdingLine(holding: Holding): string {
  const name = tickerById(holding.tickerId)?.name;
  const lots = holding.lots.length;
  const inLots = `in ${lots} ${lots === 1 ? 'lot' : 'lots'}`;
  const opening = name === undefined ? `In ${lots} ${lots === 1 ? 'lot' : 'lots'}` : `${name}, ${inLots}`;
  return `${opening}. Valued at the Chainlink price from ${formatUtc(holding.feed.updatedAt)}.`;
}

/** One holding as a choice: the token amount with the debt security line directly under it (docs/DESIGN.md 12.5). */
function HoldingChoice({ holding, name, checked, onSelect, disabled }: HoldingChoiceProps): JSX.Element {
  const symbol = tickerSymbol(holding.tickerId);
  const outside = tokensOutsideLots(holding);
  return (
    <ChoiceCard
      name={name}
      value={String(holding.tickerId)}
      checked={checked}
      onSelect={onSelect}
      disabled={disabled}
      title={
        <span className="flex items-center gap-2.5">
          <TickerIcon tickerId={holding.tickerId} size="lg" className="shrink-0" />
          <Amount value={formatStockToken(holding.balance)} unit={symbol} kind="equity" className="text-figure-s" />
        </span>
      }
      aside={<Amount value={formatUsdg(holding.value)} unit="USDG" />}
    >
      <DebtSecurityLine />
      <p className="mt-1 text-body-s text-ink-muted">{holdingLine(holding)}</p>
      {outside > 0n ? (
        <p className="mt-1 text-body-s text-ink-muted">
          {tokenText(outside, symbol)} arrived outside Sleeve and cannot be sold here.
        </p>
      ) : null}
    </ChoiceCard>
  );
}

function SellLoading(): JSX.Element {
  return (
    <SkeletonGroup label="Loading your Stock Tokens" className="flex max-w-reading flex-col gap-3">
      <Skeleton className="h-6 w-36" />
      <Skeleton className="h-28 w-full rounded-row" />
      <Skeleton className="h-28 w-full rounded-row" />
      <Skeleton className="mt-5 h-6 w-28" />
      <Skeleton className="h-12 w-full rounded-control" />
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

function NothingToSell({ outsideOnly }: { outsideOnly: readonly Holding[] }): JSX.Element {
  return (
    <EmptyState
      title="Nothing to sell yet"
      className="max-w-reading"
      action={
        <ButtonLink href="/home" variant="secondary">
          Back to home
        </ButtonLink>
      }
    >
      {outsideOnly.length > 0
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

/** A finished sell: what was sold, that the USDG went to spend unsplit, and one receipt per lot it drew from. */
function SaleResult({ records, headingRef, onSellMore }: SaleResultProps): JSX.Element {
  const first = records[0];
  const symbol = first === undefined ? '' : tickerSymbol(first.receipt.tickerId);
  const tokens = records.reduce((sum, record) => sum + record.receipt.tokensIn, 0n);
  const proceeds = records.reduce((sum, record) => sum + record.receipt.usdgOut, 0n);
  return (
    <div className="flex max-w-reading flex-col gap-4">
      <section className="rounded-module border border-border bg-surface p-card">
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-pill bg-success-soft text-success">
            <Icon name="check" />
          </span>
          <div className="min-w-0">
            <h2 ref={headingRef} tabIndex={-1} className="text-h2 text-ink">
              Sold {tokenText(tokens, symbol)}
            </h2>
            <p className="mt-1 text-body text-ink">
              <span className="tabular-nums">{usdgExactText(proceeds)}</span> went to spend. Sleeve does not split it.
            </p>
            <p className="mt-1 text-body-s text-ink-secondary">
              {records.length === 1
                ? 'Its receipt is below.'
                : `One receipt for each of the ${records.length} lots it drew from, oldest first.`}
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button variant="secondary" onClick={onSellMore}>
            Sell more
          </Button>
          <ButtonLink href="/receipts" variant="ghost">
            See all receipts
          </ButtonLink>
        </div>
      </section>
      {records.map((record) => (
        <ReceiptSummary
          key={record.receipt.id.toString()}
          record={record}
          href={`/receipts/${record.receipt.id.toString()}`}
          verifyHref={`/verify/${record.receipt.id.toString()}`}
          headingLevel={3}
        />
      ))}
      <ExitLine />
    </div>
  );
}
