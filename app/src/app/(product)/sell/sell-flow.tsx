'use client';

import { RULE_LIMITS, formatFeedPrice, formatStockToken, formatUsdg } from '@sleeve/core';
import Link from 'next/link';
import { useId, useRef, useState, type FormEvent, type JSX, type ReactNode } from 'react';

import { percentWords, tickerSymbol, tokenText } from '@/components/sleeve/text';
import { Amount } from '@/components/ui/amount';
import { ReasonTag } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Banner, ErrorBlock } from '@/components/ui/card';
import { SegmentedControl } from '@/components/ui/choice';
import { DebtSecurityLine, ExitLine } from '@/components/ui/debt-security-line';
import { EmptyState } from '@/components/ui/empty-state';
import { AmountInput } from '@/components/ui/field';
import { formatUtc } from '@/components/ui/format-time';
import { Icon } from '@/components/ui/icons';
import { DefinitionList } from '@/components/ui/list';
import { Skeleton, SkeletonGroup, SkeletonText } from '@/components/ui/skeleton';
import { useSellQuote } from '@/data/hooks';
import type { Holding, LotView, SellBlock, SellQuote, SellRequest } from '@/data/types';

import { ChoiceCard } from './choice-card';
import { useFocusOnArrival } from './focus';
import { OverrideDialog } from './override-dialog';
import {
  amountFieldText,
  checkSellAmount,
  discountWords,
  holdingLimitSentence,
  lotLimitSentence,
  lotSellableTokens,
  readErrorSentence,
  sameSellRequest,
  sellErrorSentence,
  sellGuardSentence,
  sellableTokens,
  stillHereSentence,
  waitNextStep,
  waitSentence,
  waitTitle,
  type AmountCheck,
  type SellWait,
} from './sell-text';

type SellMode = 'amount' | 'lot';

const MODES = [
  { value: 'amount', label: 'An amount' },
  { value: 'lot', label: 'One lot' },
] as const satisfies readonly { value: SellMode; label: string }[];

/** The owner chose not to wait for this sell. capBps 0 keeps the rule's cap. */
interface Override {
  capBps: number;
}

export interface SellFlowProps {
  holding: Holding;
  /** The rule's premium cap, which a sell also meets unless the override widens it. Undefined while it loads. */
  ruleCapBps: number | undefined;
  selling: boolean;
  /** The last sell that failed, shown with its quote until the draft changes. */
  sellError: Error | null;
  onSell: (request: SellRequest) => void;
  onClearSellError: () => void;
}

/**
 * How much to sell, the quote, and the sell itself, for one holding. The screen mounts it with the ticker as its key,
 * so choosing another holding starts a fresh draft, override included: the override belongs to one sell (PRD 7.5).
 */
export function SellFlow({ holding, ruleCapBps, selling, sellError, onSell, onClearSellError }: SellFlowProps): JSX.Element {
  const symbol = tickerSymbol(holding.tickerId);
  const [mode, setMode] = useState<SellMode>('amount');
  const [amountText, setAmountText] = useState('');
  const [lotId, setLotId] = useState<bigint | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [override, setOverride] = useState<Override | null>(null);
  const [quoted, setQuoted] = useState<SellRequest | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideKey, setOverrideKey] = useState(0);
  const quote = useSellQuote(quoted);
  const panelFocus = useFocusOnArrival();
  const amountRef = useRef<HTMLInputElement>(null);
  const lotGroupRef = useRef<HTMLDivElement>(null);
  const ids = { how: useId(), lots: useId(), lotError: useId(), lotName: useId() };

  const lot = mode === 'lot' ? holding.lots.find((candidate) => candidate.id === lotId) : undefined;
  const max = lot === undefined ? sellableTokens(holding) : lotSellableTokens(lot, holding);
  const lotProblem = mode === 'lot' && lot === undefined ? 'Choose a lot to sell from.' : null;
  const amountCheck: AmountCheck | null =
    lotProblem === null
      ? checkSellAmount(
          amountText,
          max,
          symbol,
          lot === undefined ? holdingLimitSentence(max, symbol) : lotLimitSentence(lot.id, max, symbol),
        )
      : null;
  const amountError = attempted && amountCheck !== null && !amountCheck.ok ? amountCheck.problem : undefined;
  const lotError = attempted ? lotProblem : null;

  /** Any edit makes the shown quote and a failed sell stale. Handlers call this rather than an Effect watching state. */
  function draftChanged() {
    setQuoted(null);
    onClearSellError();
  }

  function chooseMode(next: SellMode) {
    setMode(next);
    setAmountText('');
    setLotId(null);
    setAttempted(false);
    draftChanged();
  }

  function chooseLot(next: LotView) {
    setLotId(next.id);
    setAmountText(amountFieldText(lotSellableTokens(next, holding)));
    draftChanged();
  }

  function changeAmount(text: string) {
    setAmountText(text);
    draftChanged();
  }

  function fillMax() {
    setAmountText(amountFieldText(max));
    draftChanged();
  }

  function getQuote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAttempted(true);
    if (lotProblem !== null) {
      lotGroupRef.current?.querySelector('input')?.focus();
      return;
    }
    if (amountCheck === null || !amountCheck.ok) {
      amountRef.current?.focus();
      return;
    }
    const next: SellRequest = {
      tickerId: holding.tickerId,
      amount: amountCheck.amount,
      lotId: lot?.id ?? 0n,
      overrideClosed: override !== null,
      overrideCapBps: override?.capBps ?? 0,
    };
    onClearSellError();
    if (sameSellRequest(next, quoted)) {
      void quote.refetch();
      return;
    }
    panelFocus.request();
    setQuoted(next);
  }

  function openOverride() {
    setOverrideKey((key) => key + 1);
    setOverrideOpen(true);
  }

  function continueWithoutWaiting(capBps: number) {
    setOverride({ capBps });
    setOverrideOpen(false);
    onClearSellError();
    if (quoted === null) return;
    panelFocus.request();
    setQuoted({ ...quoted, overrideClosed: true, overrideCapBps: capBps });
  }

  function waitInstead() {
    setOverride(null);
    onClearSellError();
    if (quoted === null) return;
    panelFocus.request();
    setQuoted({ ...quoted, overrideClosed: false, overrideCapBps: 0 });
  }

  const data = quote.data;
  const effectiveRuleCap = ruleCapBps ?? (data !== undefined && !data.request.overrideClosed ? data.capBps : undefined);

  let panel: ReactNode;
  if (quoted === null) {
    panel = <QuoteIdle />;
  } else if (quote.isPending) {
    panel = <QuoteLoading />;
  } else if (quote.isError) {
    panel = (
      <ErrorBlock
        title="The quote did not load"
        action={
          <Button variant="secondary" onClick={() => void quote.refetch()}>
            Try again
          </Button>
        }
      >
        {readErrorSentence(quote.error)} {stillHereSentence(symbol)}
      </ErrorBlock>
    );
  } else if (data !== undefined && data.blocked !== null && !(data.blocked.code === 'DiscountAboveCap' && data.waits !== null)) {
    panel = (
      <QuoteBlocked
        block={data.blocked}
        symbol={symbol}
        headingRef={panelFocus.target}
        canWiden={override !== null && effectiveRuleCap !== undefined && data.capBps < RULE_LIMITS.sellOverrideCapBpsMax}
        onWiden={openOverride}
      />
    );
  } else if (data !== undefined && data.waits !== null) {
    panel = (
      <QuoteWaiting
        quote={data}
        wait={data.waits}
        symbol={symbol}
        headingRef={panelFocus.target}
        onSkipWait={openOverride}
      />
    );
  } else if (data !== undefined) {
    panel = (
      <QuoteReady
        quote={data}
        symbol={symbol}
        headingRef={panelFocus.target}
        selling={selling}
        sellError={sellError}
        onSell={() => onSell(data.request)}
        onRequote={() => {
          onClearSellError();
          void quote.refetch();
        }}
      />
    );
  }

  const waitingQuote = data !== undefined && data.waits !== null ? data : undefined;
  const dialogWait: SellWait = waitingQuote?.waits ?? { reason: 'SESSION', reopensAt: null };

  return (
    <>
      <section aria-labelledby={ids.how} className="flex flex-col gap-4">
        <h2 id={ids.how} className="text-h2 text-ink">
          How much
        </h2>
        <form onSubmit={getQuote} noValidate className="flex flex-col gap-5">
          <SegmentedControl
            legend="Sell by"
            options={MODES}
            value={mode}
            onChange={chooseMode}
            disabled={selling}
            hint={mode === 'amount' ? 'An amount takes your oldest lot first.' : 'Pick one lot, then how much of it to sell.'}
          />

          {mode === 'lot' ? (
            <div>
              <p id={ids.lots} className="mb-2 text-body-s font-semibold text-ink">
                Lot to sell from
              </p>
              <div
                ref={lotGroupRef}
                role="radiogroup"
                aria-labelledby={ids.lots}
                aria-describedby={lotError === null ? undefined : ids.lotError}
                className="flex flex-col gap-2.5"
              >
                {holding.lots.map((candidate) => (
                  <ChoiceCard
                    key={candidate.id.toString()}
                    name={ids.lotName}
                    value={candidate.id.toString()}
                    checked={candidate.id === lotId}
                    onSelect={() => chooseLot(candidate)}
                    disabled={selling}
                    title={<Amount value={formatStockToken(candidate.tokensRemaining)} unit={symbol} kind="equity" className="text-body font-semibold" />}
                    aside={`Lot ${candidate.id.toString()}`}
                  >
                    <DebtSecurityLine />
                    <p className="mt-1 text-body-s text-ink-muted">{lotLine(candidate, symbol)}</p>
                  </ChoiceCard>
                ))}
              </div>
              {lotError === null ? null : (
                <p id={ids.lotError} className="mt-2 flex items-start gap-1.5 text-body-s text-danger">
                  <Icon name="alert" className="mt-0.5 size-4" />
                  {lotError}
                </p>
              )}
            </div>
          ) : null}

          {mode === 'amount' || lot !== undefined ? (
            <div>
              <AmountInput
                ref={amountRef}
                label={lot === undefined ? 'Amount to sell' : `Amount to sell from lot ${lot.id.toString()}`}
                unit={symbol}
                decimals={18}
                value={amountText}
                onValueChange={changeAmount}
                placeholder="0.00"
                disabled={selling}
                error={amountError}
                hint={
                  lot === undefined
                    ? `${holdingLimitSentence(max, symbol)} The USDG goes to spend.`
                    : `${lotLimitSentence(lot.id, max, symbol)} The USDG goes to spend.`
                }
              />
              <Button variant="ghost" size="sm" onClick={fillMax} disabled={selling || max === 0n} className="-ml-4 mt-1">
                Use all {tokenText(max, symbol)}
              </Button>
            </div>
          ) : null}

          <Button
            type="submit"
            variant={quoted === null ? 'primary' : 'secondary'}
            fullWidth
            className="md:w-auto md:self-start"
            busy={quote.isFetching}
            busyLabel="Getting a quote"
            disabled={selling}
          >
            {quoted === null ? 'Get a quote' : 'Get a new quote'}
          </Button>
        </form>
      </section>

      <section aria-label="Quote" className="flex flex-col gap-4">
        {override === null ? null : (
          <Banner title="Not waiting for the market">
            <p>
              This sell can run while the market is closed or the reference price is out of date, with a cap of{' '}
              {override.capBps === 0
                ? effectiveRuleCap === undefined
                  ? 'your rule'
                  : percentWords(effectiveRuleCap)
                : percentWords(override.capBps)}{' '}
              below the last reference price. It covers this sell only.
            </p>
            <Button variant="ghost" size="sm" onClick={waitInstead} disabled={selling} className="-ml-4 mt-1">
              Wait instead
            </Button>
          </Banner>
        )}
        {panel}
        <ExitLine />
      </section>

      {waitingQuote === undefined && override === null ? null : (
        <OverrideDialog
          key={overrideKey}
          open={overrideOpen}
          onClose={() => setOverrideOpen(false)}
          onContinue={continueWithoutWaiting}
          symbol={symbol}
          wait={dialogWait}
          referenceAt={data?.feed.updatedAt ?? holding.feed.updatedAt}
          ruleCapBps={effectiveRuleCap ?? 0}
          discountBps={data?.discountBps ?? 0n}
          initialCapBps={override?.capBps === 0 ? undefined : override?.capBps}
        />
      )}
    </>
  );
}

function lotLine(lot: LotView, symbol: string): string {
  const bought = `Bought ${formatUtc(lot.boughtAt)} at ${formatUsdg(lot.execPrice)} USDG per ${symbol}.`;
  const sold = lot.tokensBought - lot.tokensRemaining;
  return sold > 0n ? `${bought} ${tokenText(sold, symbol)} of it is already sold.` : bought;
}

function QuoteIdle(): JSX.Element {
  return (
    <EmptyState title="No quote yet" headingLevel={2}>
      Choose what to sell and get a quote. Nothing moves until you press Sell.
    </EmptyState>
  );
}

function QuoteLoading(): JSX.Element {
  return (
    <SkeletonGroup label="Getting a quote" className="rounded-module border border-border bg-surface p-card">
      <Skeleton className="h-6 w-40" />
      <Skeleton className="mt-4 h-8 w-48" />
      <SkeletonText lines={4} className="mt-5" />
    </SkeletonGroup>
  );
}

interface PanelHeadingProps {
  headingRef: (node: HTMLElement | null) => void;
  children: ReactNode;
  className?: string;
}

/** Each quote state names itself with an h2 that takes focus when it replaces what the owner just used. */
function PanelHeading({ headingRef, children, className }: PanelHeadingProps): JSX.Element {
  return (
    <h2 ref={headingRef} tabIndex={-1} className={className === undefined ? 'text-h2 text-ink' : `text-h2 text-ink ${className}`}>
      {children}
    </h2>
  );
}

interface QuoteWaitingProps {
  quote: SellQuote;
  wait: SellWait;
  symbol: string;
  headingRef: (node: HTMLElement | null) => void;
  onSkipWait: () => void;
}

/** Waiting is the default answer while the reference is not live (B2-13): amber, striped, and not an error. */
function QuoteWaiting({ quote, wait, symbol, headingRef, onSkipWait }: QuoteWaitingProps): JSX.Element {
  const aboveCap = quote.blocked !== null && quote.blocked.code === 'DiscountAboveCap';
  return (
    <div className="rounded-module border border-border bg-surface p-card">
      <div aria-hidden="true" className="h-1.5 w-full rounded-pill bg-waiting-stripes" />
      <div className="mt-4">
        <ReasonTag reason={wait.reason} />
      </div>
      <PanelHeading headingRef={headingRef} className="mt-2">
        {waitTitle(wait)}
      </PanelHeading>
      <p className="mt-2 text-body text-ink">{waitSentence(wait, symbol)}</p>
      {aboveCap ? (
        <p className="mt-2 text-body-s text-ink-secondary">
          At the last price, this sell is {discountWords(quote.discountBps)}, more than your cap of {percentWords(quote.capBps)}.
        </p>
      ) : null}
      <p className="mt-2 text-body-s text-ink-secondary">{waitNextStep(wait, symbol)}</p>
      <Button variant="secondary" onClick={onSkipWait} className="mt-4">
        Sell without waiting
      </Button>
    </div>
  );
}

interface QuoteBlockedProps {
  block: SellBlock;
  symbol: string;
  headingRef: (node: HTMLElement | null) => void;
  /** The override is on and its cap can still go wider. */
  canWiden: boolean;
  onWiden: () => void;
}

interface BlockedCopy {
  title: string;
  body: ReactNode;
  action?: ReactNode;
}

function blockedCopy(block: SellBlock, symbol: string, canWiden: boolean, onWiden: () => void): BlockedCopy {
  switch (block.code) {
    case 'DiscountAboveCap':
      return {
        title: 'The price is too far below the reference',
        body: `This sell would be ${discountWords(block.discountBps)}, more than your cap of ${percentWords(block.capBps)}. Try a smaller amount.`,
        action: canWiden ? (
          <Button variant="secondary" onClick={onWiden}>
            Choose a wider cap
          </Button>
        ) : (
          <p className="text-body-s text-ink-secondary">
            Your rule&apos;s cap applies to sells too.{' '}
            <Link href="/rule" className="font-medium text-link underline underline-offset-4 hover:text-link-hover">
              Edit your rule
            </Link>
          </p>
        ),
      };
    case 'AccountBlocked':
      return {
        title: 'Sleeve cannot sell from this account',
        body: `The issuer's blocklist includes this account, so ${symbol} cannot move through Sleeve.`,
      };
    case 'GuardNotClear':
      return {
        title: 'This sell cannot run right now',
        body: (
          <>
            <ReasonTag reason={block.reason} className="mb-2" />
            <span className="block">{sellGuardSentence(block.reason, symbol)}</span>
          </>
        ),
      };
    case 'ExceedsLots':
      return { title: 'Not enough in your lots', body: holdingLimitSentence(block.available, symbol) };
    case 'OverrideCapOutOfRange':
      return { title: 'That cap is too wide', body: `The cap for one sell can be at most ${percentWords(block.maxBps)}.` };
  }
}

/** A sell that cannot run as asked. The override never changes these, except a discount cap it can widen. */
function QuoteBlocked({ block, symbol, headingRef, canWiden, onWiden }: QuoteBlockedProps): JSX.Element {
  const { title, body, action } = blockedCopy(block, symbol, canWiden, onWiden);
  return (
    <div className="rounded-module border border-border bg-surface p-card">
      <PanelHeading headingRef={headingRef}>{title}</PanelHeading>
      <div className="mt-2 text-body text-ink">{body}</div>
      <p className="mt-2 text-body-s text-ink-secondary">{stillHereSentence(symbol)}</p>
      {action === undefined ? null : <div className="mt-4">{action}</div>}
    </div>
  );
}

interface QuoteReadyProps {
  quote: SellQuote;
  symbol: string;
  headingRef: (node: HTMLElement | null) => void;
  selling: boolean;
  sellError: Error | null;
  onSell: () => void;
  onRequote: () => void;
}

/**
 * The quote a sell would run on: what the owner gets, the pool price and the Chainlink reference as separate lines
 * with the reference's time (PRD 7.11), the discount against the cap, and where the USDG goes. The sell itself
 * re-checks everything on chain, so a quote refreshing in the background never needs to block the button.
 */
function QuoteReady({ quote, symbol, headingRef, selling, sellError, onSell, onRequote }: QuoteReadyProps): JSX.Element {
  const { request } = quote;
  const widened = request.overrideCapBps > 0;
  return (
    <div className="rounded-module border border-border bg-surface p-card">
      <PanelHeading headingRef={headingRef}>Your quote</PanelHeading>
      <p className="mt-1 text-body text-ink-secondary">
        This sell is {discountWords(quote.discountBps)}, inside your cap of {percentWords(quote.capBps)}.
      </p>

      <div className="mt-4">
        <p className="text-body-s text-ink-secondary">You get about</p>
        <p className="mt-0.5 text-figure-m">
          <Amount value={formatUsdg(quote.expectedUsdgOut)} unit="USDG" kind="spend" />
        </p>
        <p className="mt-1 text-body-s text-ink-secondary">
          At least <Amount value={formatUsdg(quote.minOut)} unit="USDG" />. If the pool would pay less, the sell stops
          and nothing moves.
        </p>
      </div>

      <DefinitionList
        className="mt-4 border-t border-border"
        items={[
          {
            id: 'sell',
            term: 'You sell',
            value: (
              <>
                <Amount value={formatStockToken(request.amount)} unit={symbol} kind="equity" className="font-semibold" />
                <DebtSecurityLine className="mt-0.5" />
              </>
            ),
          },
          {
            id: 'lots',
            term: request.lotId === 0n ? 'Taken from, oldest lot first' : 'Taken from',
            value: (
              <ul>
                {quote.lots.map((part) => (
                  <li key={part.lotId.toString()}>
                    Lot {part.lotId.toString()}: <Amount value={formatStockToken(part.tokens)} unit={symbol} />
                  </li>
                ))}
              </ul>
            ),
          },
          {
            id: 'pool',
            term: 'Pool price',
            value: (
              <span className="tabular-nums">
                <span className="whitespace-nowrap">{formatUsdg(quote.quote)}</span> USDG per {symbol}
              </span>
            ),
          },
          {
            id: 'reference',
            term: 'Market reference',
            value: (
              <>
                <span className="tabular-nums">
                  <span className="whitespace-nowrap">{formatFeedPrice(quote.feed.answer)}</span> USD per {symbol}
                </span>
                <span className="block text-ink-muted">Chainlink price from {formatUtc(quote.feed.updatedAt)}</span>
              </>
            ),
          },
          {
            id: 'cap',
            term: 'Cap for this sell',
            value: `${percentWords(quote.capBps)} below the reference, ${widened ? 'widened for this sell only' : "your rule's cap"}`,
          },
          { id: 'spend', term: 'The USDG goes to', value: 'Spend. Sleeve never splits it.' },
        ]}
      />

      {sellError === null ? null : (
        <ErrorBlock
          title="The sell did not go through"
          className="mt-4"
          action={
            <Button variant="secondary" size="sm" onClick={onRequote}>
              Get a new quote
            </Button>
          }
        >
          {sellErrorSentence(sellError, symbol)} {stillHereSentence(symbol)}
        </ErrorBlock>
      )}

      <Button fullWidth className="mt-5 md:w-auto" busy={selling} busyLabel="Selling" onClick={onSell}>
        Sell {tokenText(request.amount, symbol)}
      </Button>
    </div>
  );
}
