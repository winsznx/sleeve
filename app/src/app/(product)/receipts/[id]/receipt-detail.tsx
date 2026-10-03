'use client';

import { EXPLORER_URL, shortAddress, tickerById, type Receipt } from '@sleeve/core';
import Link from 'next/link';
import { useState, type JSX, type ReactNode } from 'react';

import { tickerSymbol } from '@/components/sleeve/text';
import { Button, ButtonLink } from '@/components/ui/button';
import { ErrorBlock, Note } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { formatUtc } from '@/components/ui/format-time';
import { Icon } from '@/components/ui/icons';
import { Skeleton, SkeletonGroup, SkeletonText } from '@/components/ui/skeleton';
import { useBuckets, useHoldings, useMarket, useReceipt, useReceipts, useSession } from '@/data/hooks';
import { useDataLayer } from '@/data/provider';
import type { Holding, ReceiptRecord } from '@/data/types';

import { LazyCardComposer } from '../_components/lazy-card-composer';
import { StatusChip, WaitReasonChip } from '../_components/status-chip';
import { actionNumber, actionTitle } from '../_lib/outcome';
import { isoTime } from '../_lib/register';
import { ActionHero, type LotNow } from './_components/action-hero';
import { FactSection, RawFields } from './_components/fact-sections';
import { GuardReads } from './_components/guard-reads';
import { PricePanel } from './_components/price-panel';
import { RoutePanel } from './_components/route-panel';
import { SessionPanel } from './_components/session-panel';
import { VerifyCard } from './_components/verify-card';
import { actionNoun, isBuy, priceModel, routeModel, sessionModel } from './receipt-panels';
import { receiptSections } from './receipt-sections';
import { waitedPaydays, waitOutcome, type ReceiptWindow, type WaitOutcome } from './wait-links';

/**
 * One action's details and proof (D-024, PRD 10, docs/design/closeout-product-blueprint.md 15.6). The title says
 * what happened in the action's own numbers ("1,200 USDG payday: 1,080 stayed spendable, 120 became SPY"), then the
 * money moves: the split with its legs, or the buy, release or sale as a move. The all-in price against the
 * Chainlink reference and the route through the pool follow. The receipt the action wrote onchain comes last, in
 * the proof section: its id and hash, the rounds the guard read, the calendar, how it ran, what the logs add, every
 * field as stored, the issuer disclosure and the way to recompute it. Receipts are public, so the page reads without
 * a session; the owner of a buy also sees their lot today and can sell from it or make a payday card.
 */

const BACK = 'History';

interface ActionHeaderProps {
  id: string;
  record: ReceiptRecord | null;
  /** The action is still being read: the status line and two lines of title keep their place, so nothing jumps. */
  pending?: boolean;
  actions?: ReactNode;
}

function ActionHeader({ id, record, pending = false, actions }: ActionHeaderProps): JSX.Element {
  const receipt = record?.receipt;
  return (
    <header className="mb-6 md:mb-7">
      <Link
        href="/history"
        className="-ml-1 mb-1 inline-flex min-h-touch items-center gap-1 rounded-control pr-2 text-body-s text-ink-secondary transition-colors duration-fast ease-standard hover:text-ink"
      >
        <Icon name="chevronLeft" className="size-4" />
        {BACK}
      </Link>
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-6">
        <div className="min-w-0">
          {receipt === undefined ? (
            pending ? (
              <p aria-hidden="true" className="mb-2 flex h-[1.375rem] items-center gap-2.5">
                <Skeleton className="h-full w-20 rounded-control" />
                <Skeleton className="h-3.5 w-36" />
              </p>
            ) : null
          ) : (
            <p className="mb-2 flex min-h-[1.375rem] flex-wrap items-center gap-x-2.5 gap-y-1.5">
              <StatusChip status={receipt.status} />
              {receipt.status === 'QUEUED' ? <WaitReasonChip reason={receipt.reason} /> : null}
              <time dateTime={isoTime(receipt.timestamp)} className="text-body-s tabular-nums text-ink-muted">
                {formatUtc(receipt.timestamp)}
              </time>
            </p>
          )}
          <h1 className="max-w-reading break-words text-h1 text-ink">
            {record === null ? (
              pending ? (
                <>
                  <span aria-hidden="true" className="flex h-[1lh] items-center">
                    <span className="block h-[0.7lh] w-[34rem] max-w-full rounded-xs bg-skeleton" />
                  </span>
                  <span aria-hidden="true" className="inline-block h-[0.7lh] w-[16rem] max-w-[60%] rounded-xs bg-skeleton align-middle" />{' '}
                </>
              ) : null
            ) : (
              <>{actionTitle(record)} </>
            )}
            <span className="whitespace-nowrap font-mono text-h2 font-normal text-ink-muted">{actionNumber(BigInt(id))}</span>
          </h1>
        </div>
        {actions === undefined ? null : <div className="flex shrink-0 flex-wrap items-center gap-2.5">{actions}</div>}
      </div>
    </header>
  );
}

function DetailSkeleton(): JSX.Element {
  return (
    <SkeletonGroup label="Loading the details" className="flex flex-col gap-stack">
      <div className="rounded-module border border-border bg-surface p-card md:p-6">
        <Skeleton className="h-4 w-24" />
        <div className="mt-4 flex items-center gap-3.5">
          <Skeleton className="size-icon-tile rounded-pill" />
          <div className="flex-1">
            <Skeleton className="h-7 w-48 max-w-full" />
            <Skeleton className="mt-2 h-4 w-36" />
          </div>
        </div>
        <Skeleton className="mt-5 h-3 w-full rounded-pill" />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-32 w-full rounded-row" />
          <Skeleton className="h-32 w-full rounded-row" />
        </div>
      </div>
      <div className="rounded-module border border-border bg-surface p-card md:p-6">
        <Skeleton className="h-4 w-28" />
        <SkeletonText lines={3} className="mt-4 max-w-reading" />
      </div>
    </SkeletonGroup>
  );
}

/** The owner's lot today for a buy: open with what is left, or closed once a sale took the rest. */
function lotNowOf(holdings: readonly Holding[] | undefined, receipt: Receipt): LotNow | null {
  if (holdings === undefined || receipt.lotId === 0n) return null;
  const lot = holdings.find((holding) => holding.tickerId === receipt.tickerId)?.lots.find((candidate) => candidate.id === receipt.lotId);
  if (lot === undefined) return { kind: 'closed' };
  return { kind: 'open', bought: lot.tokensBought, remaining: lot.tokensRemaining };
}

function sellHrefOf(receipt: Receipt, lot: LotNow | null): string | null {
  const symbol = tickerById(receipt.tickerId)?.symbol;
  if (lot === null || lot.kind !== 'open' || symbol === undefined) return null;
  return `/sell?ticker=${symbol}&lot=${receipt.lotId.toString()}`;
}

interface ProofSectionProps {
  record: ReceiptRecord;
  explorerBase: string | null;
  disclosure: ReactNode;
}

/** The receipt behind the action (PRD 10): kept after the money, never the headline (D-024). */
function ProofSection({ record, explorerBase, disclosure }: ProofSectionProps): JSX.Element {
  const { receipt } = record;
  const id = receipt.id.toString();
  const noun = actionNoun(receipt);
  const price = priceModel(record);
  const sections = receiptSections(record);
  const section = (sectionId: string) => {
    const found = sections.find((candidate) => candidate.id === sectionId);
    return found === undefined ? null : <FactSection section={found} explorerBase={explorerBase} />;
  };
  return (
    <section aria-labelledby="proof-title" className="mt-10 border-t border-border pt-8 md:mt-12">
      <h2 id="proof-title" className="text-h2 text-ink">
        Proof
      </h2>
      <p className="mt-1 max-w-reading text-body text-ink-secondary">
        Sleeve wrote receipt {id} onchain in the same transaction as this {noun}. Anyone can read it and recompute every
        number from public chain data.
      </p>
      <div className="mt-5 flex flex-col gap-stack">
        <VerifyCard receiptId={receipt.id} noun={noun} />
        <div className="grid gap-stack xl:grid-cols-2 xl:items-start">
          <div className="flex min-w-0 flex-col gap-stack">
            {section('record')}
            {section('logs')}
          </div>
          <div className="flex min-w-0 flex-col gap-stack">
            {price === null ? null : <GuardReads model={price} />}
            <SessionPanel model={sessionModel(receipt)} />
            {section('context')}
          </div>
        </div>
        <RawFields receipt={receipt} />
        {disclosure}
      </div>
    </section>
  );
}

export interface ReceiptDetailProps {
  /** The action's number as the URL gave it, already checked by parseReceiptId. */
  id: string;
  /** The issuer disclosure block, rendered on the server from the served file. */
  disclosure: ReactNode;
}

/** Receipts of the same account and ticker read to tie a wait to the buy or release that ended it. */
const WAIT_SCAN_LIMIT = 50;

/**
 * The receipts and buckets that say how a wait went (wait-links.ts): for a payday whose equity share waited, the
 * account's later receipts for the ticker and its buckets today; for a receipt that emptied a bucket, the paydays
 * that filled it. Reads nothing for any other receipt.
 */
function useWaitLinks(receipt: Receipt | undefined): {
  outcome: WaitOutcome | null;
  paydays: ReceiptRecord[] | null;
  reopensAt: bigint | null;
} {
  const queued = receipt?.status === 'QUEUED';
  const tracks = receipt !== undefined && (queued || receipt.queuedSince > 0n);
  const nearby = useReceipts({ account: tracks ? receipt.account : undefined, tickerId: receipt?.tickerId, limit: WAIT_SCAN_LIMIT });
  const buckets = useBuckets(queued ? receipt.account : undefined);
  const market = useMarket();
  const read: ReceiptWindow | null =
    nearby.data === undefined ? null : { records: nearby.data.pages.flatMap((page) => page.items), exhausted: !nearby.hasNextPage };
  if (receipt === undefined || !tracks) return { outcome: null, paydays: null, reopensAt: null };
  const session = market.data?.tickers.find((ticker) => ticker.tickerId === receipt.tickerId)?.session;
  return {
    outcome: waitOutcome(receipt, read, buckets.data),
    paydays: waitedPaydays(receipt, read),
    reopensAt: session === undefined || session.open ? null : session.nextOpenAt,
  };
}

export function ReceiptDetail({ id, disclosure }: ReceiptDetailProps): JSX.Element {
  const receiptId = BigInt(id);
  const layer = useDataLayer();
  const receipt = useReceipt(receiptId);
  const session = useSession();
  const [composer, setComposer] = useState({ open: false, key: 0 });

  const record = receipt.data ?? null;
  const viewer = session.data?.account ?? null;
  const isOwner = record !== null && viewer !== null && viewer.toLowerCase() === record.receipt.account.toLowerCase();
  const ownBuy = record !== null && isOwner && isBuy(record.receipt);
  const holdings = useHoldings(ownBuy ? (viewer ?? undefined) : undefined);
  const wait = useWaitLinks(record?.receipt);
  const explorerBase = layer.source === 'chain' ? EXPLORER_URL : null;

  let body: ReactNode;
  if (receipt.isPending) {
    body = <DetailSkeleton />;
  } else if (receipt.isError && record === null) {
    body = (
      <ErrorBlock
        title={`The details of ${actionNumber(receiptId)} did not load`}
        fundsStillHere
        action={
          <Button variant="secondary" onClick={() => receipt.refetch()}>
            Try again
          </Button>
        }
      />
    );
  } else if (record === null) {
    body = (
      <EmptyState
        title={`No action with number ${id} yet`}
        action={
          <ButtonLink href="/history" variant="secondary">
            See your history
          </ButtonLink>
        }
      >
        Numbers count up from 1 across every Sleeve account. This one has not been used yet.
      </EmptyState>
    );
  } else {
    const lot = ownBuy ? lotNowOf(holdings.data, record.receipt) : null;
    const price = priceModel(record);
    const route = routeModel(record);
    body = (
      <>
        <div className="flex flex-col gap-stack">
          <ActionHero
            record={record}
            lot={lot}
            sellHref={sellHrefOf(record.receipt, lot)}
            waitOutcome={wait.outcome}
            reopensAt={wait.reopensAt}
            waitedPaydays={wait.paydays}
          />
          {viewer !== null && !isOwner ? (
            <Note title={`Another account's ${actionNoun(record.receipt)}`}>
              This belongs to {shortAddress(record.receipt.account)}. Every action is public onchain, so anyone can read and
              recompute it.
            </Note>
          ) : null}
          {price === null ? null : <PricePanel model={price} />}
          {route === null ? null : <RoutePanel model={route} symbol={tickerSymbol(record.receipt.tickerId)} explorerBase={explorerBase} />}
        </div>
        <ProofSection record={record} explorerBase={explorerBase} disclosure={disclosure} />
      </>
    );
  }

  return (
    <>
      <ActionHeader
        id={id}
        record={record}
        pending={receipt.isPending}
        actions={
          ownBuy ? (
            <Button variant="secondary" icon="share" onClick={() => setComposer((current) => ({ open: true, key: current.key + 1 }))}>
              Make a payday card
            </Button>
          ) : undefined
        }
      />
      {body}
      {ownBuy && composer.key > 0 ? (
        <LazyCardComposer
          key={composer.key}
          open={composer.open}
          onClose={() => setComposer((current) => ({ ...current, open: false }))}
          subject={{ kind: 'receipt', receiptId }}
        />
      ) : null}
    </>
  );
}
