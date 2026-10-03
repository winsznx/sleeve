'use client';

import { RULE_DEFAULTS, TOTAL_BPS, formatBps, formatStockToken, formatUsdg, shortAddress } from '@sleeve/core';
import type { JSX, ReactNode } from 'react';

import { TickerIcon } from '@/components/token/ticker-icon';
import { TokenIcon } from '@/components/token/token-icon';
import { ReceiptSummary } from '@/components/sleeve/receipt-summary';
import { SplitRail } from '@/components/sleeve/split-rail';
import { tickerSymbol, usdgText } from '@/components/sleeve/text';
import { Amount } from '@/components/ui/amount';
import { cx } from '@/components/ui/cx';
import { DebtSecurityLine } from '@/components/ui/debt-security-line';
import { Icon } from '@/components/ui/icons';
import { Skeleton, SkeletonGroup, SkeletonText } from '@/components/ui/skeleton';
import { useReceipt } from '@/data/hooks';
import type { ReceiptRecord } from '@/data/types';

import { EXAMPLE_RECEIPT_ID, receiptHref, verifyHref } from './example-receipt';

/**
 * The hero's art, in closeout's composition (docs/DESIGN.md 12.9): a neutral field with the payday as notifications,
 * beside a green stage carrying the receipt that recorded it. Every number comes from the example receipt through
 * the data layer. The split rail grows once when the receipt first appears, the one movement Sleeve makes on its
 * own (DESIGN 10).
 */
export function ExampleSplit({ className }: { className?: string }): JSX.Element {
  const receipt = useReceipt(EXAMPLE_RECEIPT_ID ?? undefined);
  const record = receipt.data ?? null;

  let notes: ReactNode;
  let stage: ReactNode;
  if (EXAMPLE_RECEIPT_ID !== null && receipt.isPending) {
    notes = <NotesLoading />;
    stage = <StageLoading />;
  } else if (record === null || record.receipt.status !== 'FILLED') {
    notes = <GenericNotes />;
    stage = <SuggestedRule />;
  } else {
    notes = <PaydayNotes record={record} />;
    stage = (
      <div className="w-full max-w-md rounded-module shadow-floating">
        <ReceiptSummary
          record={record}
          href={receiptHref(record.receipt.id)}
          verifyHref={verifyHref(record.receipt.id)}
          headingLevel={2}
          animate
        />
      </div>
    );
  }

  return (
    <div className={cx('grid gap-stack lg:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)]', className)}>
      <div className="flex min-h-72 flex-col justify-end overflow-hidden rounded-card bg-art-neutral p-4 sm:p-6 lg:min-h-[32rem]">
        {notes}
      </div>
      <div className="flex items-center justify-center overflow-hidden rounded-card bg-art-green px-4 py-8 sm:px-8 sm:py-12 lg:min-h-[32rem]">
        {stage}
      </div>
    </div>
  );
}

interface NoteCardProps {
  /** An icon tile, or a dot in the color of the part of the split it names. */
  mark: ReactNode;
  title: string;
  amount?: ReactNode;
  children?: ReactNode;
}

/** A white card floating on the art, like a phone notification. */
function NoteCard({ mark, title, amount, children }: NoteCardProps): JSX.Element {
  return (
    <li className="flex items-start gap-3 rounded-module bg-surface px-4 py-3 shadow-floating">
      <span aria-hidden="true" className="grid size-icon-tile shrink-0 place-items-center rounded-row bg-surface-muted text-ink-secondary">
        {mark}
      </span>
      <div className="min-w-0">
        <p className="text-body-s font-semibold text-ink">{title}</p>
        {amount === undefined ? null : <p className="text-body font-semibold">{amount}</p>}
        {children === undefined ? null : <div className="text-body-s text-ink-muted">{children}</div>}
      </div>
    </li>
  );
}

function Dot({ kind }: { kind: 'spend' | 'equity' }): JSX.Element {
  return <span className={cx('size-2.5 rounded-pill', kind === 'spend' ? 'bg-spend' : 'bg-equity')} />;
}

/** One payday as it reached the owner: the payment, then the two parts it became. */
function PaydayNotes({ record }: { record: ReceiptRecord }): JSX.Element {
  const { receipt, derived } = record;
  const symbol = tickerSymbol(receipt.tickerId);
  const payer = derived.inbound[0]?.from;
  const equityBps = derived.rule?.equityBps;
  return (
    <ul aria-label="The payday, as it arrived" className="flex flex-col gap-3">
      <NoteCard mark={<TokenIcon token="USDG" size="md" decorative />} title="Payment arrived" amount={<Amount value={formatUsdg(receipt.usdgIn)} unit="USDG" kind="spend" />}>
        {payer === undefined ? (
          'USDG on Robinhood Chain'
        ) : (
          <>
            From <span className="font-mono text-mono-s">{shortAddress(payer)}</span>
          </>
        )}
      </NoteCard>
      <NoteCard
        mark={<Dot kind="spend" />}
        title="Stays spendable"
        amount={<Amount value={formatUsdg(receipt.usdgToSpend)} unit="USDG" kind="spend" />}
      >
        {equityBps === undefined ? 'Kept as USDG' : `${formatBps(TOTAL_BPS - equityBps)} of the payment, kept as USDG`}
      </NoteCard>
      <NoteCard
        mark={<TickerIcon tickerId={receipt.tickerId} size="md" />}
        title={`Became ${symbol}`}
        amount={<Amount value={formatStockToken(receipt.tokensOut)} unit={symbol} kind="equity" />}
      >
        <span className="block">For {usdgText(receipt.usdgSpent)}</span>
        <DebtSecurityLine />
      </NoteCard>
    </ul>
  );
}

/** Before any example receipt exists: the same story without numbers. */
function GenericNotes(): JSX.Element {
  return (
    <ul aria-label="A payday with Sleeve" className="flex flex-col gap-3">
      <NoteCard mark={<Icon name="receive" />} title="A payment arrives">
        USDG on Robinhood Chain, from anyone who pays you
      </NoteCard>
      <NoteCard mark={<Dot kind="spend" />} title="The spend share stays USDG">
        Ready to use, in your own account
      </NoteCard>
      <NoteCard mark={<Dot kind="equity" />} title="The equity share buys a Stock Token">
        Held in your own account
      </NoteCard>
    </ul>
  );
}

/** The suggested start from onboarding (PRD 7.3), drawn from the product defaults, for when no receipt is shown. */
function SuggestedRule(): JSX.Element {
  const symbol = tickerSymbol(RULE_DEFAULTS.tickerId);
  const spendBps = RULE_DEFAULTS.spendBps;
  return (
    <div className="w-full max-w-md rounded-module border border-border bg-surface p-card shadow-floating">
      <h2 className="text-h3 text-ink">The suggested start</h2>
      <p className="mt-1 text-body text-ink">
        Every payment: {formatBps(spendBps)} stays spendable and {formatBps(RULE_DEFAULTS.equityBps)} buys {symbol}.
      </p>
      <SplitRail
        parts={{ spend: BigInt(spendBps), equity: BigInt(RULE_DEFAULTS.equityBps), waiting: 0n }}
        animate
        className="mt-4"
      />
    </div>
  );
}

function NotesLoading(): JSX.Element {
  return (
    <SkeletonGroup label="Loading an example payday" className="flex flex-col gap-3">
      {[0, 1, 2].map((index) => (
        <Skeleton key={index} className="h-20 w-full rounded-module" />
      ))}
    </SkeletonGroup>
  );
}

function StageLoading(): JSX.Element {
  return (
    <SkeletonGroup label="Loading an example receipt" className="w-full max-w-md rounded-module bg-surface p-card shadow-floating">
      <Skeleton className="h-5 w-48" />
      <SkeletonText lines={2} className="mt-4" />
      <Skeleton className="mt-4 h-3 w-full rounded-pill" />
      <Skeleton className="mt-4 h-10 w-2/3" />
    </SkeletonGroup>
  );
}
