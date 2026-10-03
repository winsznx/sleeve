'use client';

import { formatStockToken, shortAddress, type Receipt } from '@sleeve/core';
import Link from 'next/link';
import { useState, type JSX, type ReactNode } from 'react';

import { TickerIcon } from '@/components/token/ticker-icon';
import { PremiumLine, premiumLinePropsOf } from '@/components/sleeve/premium-line';
import { SplitLegend, SplitRail, splitPartsOf, type SplitLegendItem } from '@/components/sleeve/split-rail';
import { receiptSentence, receiptTitle, tickerSymbol, usdgExact, usdgExactText } from '@/components/sleeve/text';
import { Amount } from '@/components/ui/amount';
import { REASON_LABEL, ReasonTag, StatusTag } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, ErrorBlock, Note } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-field';
import { DebtSecurityLine } from '@/components/ui/debt-security-line';
import { EmptyState } from '@/components/ui/empty-state';
import { formatUtc } from '@/components/ui/format-time';
import { Icon } from '@/components/ui/icons';
import { DefinitionList } from '@/components/ui/list';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton, SkeletonGroup, SkeletonText } from '@/components/ui/skeleton';
import { useReceipt, useSession } from '@/data/hooks';
import type { ReceiptRecord } from '@/data/types';

import { CardComposer } from '../card-composer';
import { rawReceiptFields, receiptSections, type FieldValue, type ReceiptField, type ReceiptSection } from './receipt-sections';

/**
 * One receipt, the trust surface (PRD 10, docs/DESIGN.md 12.4): what happened in one sentence from the receipt's own
 * numbers, the split, the fill against the market reference, then every field, the fields as stored, and the issuer
 * disclosure the receipt's hash points at. Receipts are public, so the page reads without a session; the owner of a
 * buy can also make a card of it here.
 */

const LINK = 'font-medium text-link underline underline-offset-4 hover:text-link-hover';

function isoTime(seconds: bigint): string {
  return new Date(Number(seconds) * 1_000).toISOString();
}

function TimeText({ seconds, className }: { seconds: bigint; className?: string }): JSX.Element {
  return (
    <time dateTime={isoTime(seconds)} className={className}>
      {formatUtc(seconds)}
    </time>
  );
}

/** The words under the rail: what stayed spendable, what became the token, what waits and why. */
function legendOf(receipt: Receipt, symbol: string): SplitLegendItem[] {
  const parts = splitPartsOf(receipt);
  if (parts === null) return [];
  const items: SplitLegendItem[] = [];
  if (parts.spend > 0n) {
    items.push({ kind: 'spend', amount: parts.spend, label: receipt.status === 'RELEASED' ? 'moved to spend' : 'spendable' });
  }
  if (parts.equity > 0n) items.push({ kind: 'equity', amount: parts.equity, label: `became ${symbol}` });
  if (parts.waiting > 0n) {
    const why = receipt.reason === 'NONE' ? 'guard not clear' : REASON_LABEL[receipt.reason].toLowerCase();
    items.push({ kind: 'waiting', amount: parts.waiting, label: `waiting: ${why}` });
  }
  return items;
}

function ReceiptHero({ record }: { record: ReceiptRecord }): JSX.Element {
  const receipt = record.receipt;
  const symbol = tickerSymbol(receipt.tickerId);
  const parts = splitPartsOf(receipt);
  const premium = premiumLinePropsOf(receipt);
  const bought = receipt.status === 'FILLED' || receipt.status === 'SETTLED';
  const sold = receipt.status === 'PART_SOLD' || receipt.status === 'SOLD';

  return (
    <Card aria-labelledby="receipt-summary-title">
      <h2 id="receipt-summary-title" className="sr-only">
        Summary
      </h2>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <StatusTag status={receipt.status} />
        {receipt.status === 'QUEUED' ? <ReasonTag reason={receipt.reason} /> : null}
        <TimeText seconds={receipt.timestamp} className="text-body-s text-ink-muted" />
      </div>
      <p className="mt-3 max-w-reading text-body text-ink">{receiptSentence(record)}</p>
      {parts === null ? null : (
        <div className="mt-5">
          <SplitRail parts={parts} />
          <SplitLegend items={legendOf(receipt, symbol)} className="mt-3" />
        </div>
      )}
      {bought || sold ? (
        <div className="mt-5 border-t border-border pt-4">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <Amount
              value={formatStockToken(bought ? receipt.tokensOut : receipt.tokensIn)}
              unit={symbol}
              kind={bought ? 'equity' : 'plain'}
              className="text-figure-m"
            />
            <span className="text-body-s text-ink-secondary">
              {bought ? `for ${usdgExactText(receipt.usdgSpent)}` : `sold for ${usdgExactText(receipt.usdgOut)}`}
            </span>
          </p>
          <DebtSecurityLine className="mt-0.5" />
        </div>
      ) : null}
      {premium === null ? null : <PremiumLine {...premium} className="mt-4" />}
      <div className="mt-4 border-t border-border pt-1">
        <Link href={`/verify/${receipt.id}`} className={`inline-flex min-h-touch items-center text-body-s ${LINK}`}>
          Recompute this receipt
        </Link>
      </div>
    </Card>
  );
}

function FieldValueView({ value }: { value: FieldValue }): JSX.Element {
  switch (value.kind) {
    case 'text':
      return <div>{value.text}</div>;
    case 'amount':
      return (
        <div>
          <Amount value={value.value} unit={value.unit} kind={value.tone} className="font-medium" />
          {value.debtLine ? <DebtSecurityLine className="mt-0.5" /> : null}
        </div>
      );
    case 'machine':
      return (
        <div className="flex items-start gap-1">
          <span className="min-w-0 flex-1 break-all py-px font-mono text-mono-s">{value.value}</span>
          {value.copyLabel === undefined ? null : <CopyButton value={value.value} label={value.copyLabel} className="-my-3 -mr-2.5" />}
        </div>
      );
    case 'time':
      return (
        <div>
          <TimeText seconds={value.seconds} />
          <span className="block font-mono text-mono-s text-ink-muted">{value.seconds.toString()}</span>
        </div>
      );
    case 'link':
      return (
        <div>
          <Link href={value.href} className={LINK}>
            {value.text}
          </Link>
        </div>
      );
    case 'transfers':
      if (value.transfers.length === 0) return <div>None. This receipt sorted no incoming payment.</div>;
      return (
        <ul className="flex flex-col gap-2.5">
          {value.transfers.map((transfer) => (
            <li key={`${transfer.txHash}:${transfer.logIndex}`}>
              <Amount value={usdgExact(transfer.amount)} unit="USDG" className="font-medium" /> from{' '}
              <span className="font-mono text-mono-s">{shortAddress(transfer.from)}</span>
              <span className="block break-all font-mono text-mono-s text-ink-muted">
                {transfer.txHash}:{transfer.logIndex}
              </span>
            </li>
          ))}
        </ul>
      );
  }
}

function FieldView({ field }: { field: ReceiptField }): JSX.Element {
  return (
    <>
      <FieldValueView value={field.value} />
      {field.note === undefined ? null : <p className="mt-1 text-body-s text-ink-muted">{field.note}</p>}
    </>
  );
}

function SectionView({ section }: { section: ReceiptSection }): JSX.Element {
  const titleId = `receipt-section-${section.id}`;
  return (
    <section aria-labelledby={titleId} className="min-w-0 rounded-module border border-border bg-surface px-card pb-1 pt-card">
      <h2 id={titleId} className="text-h3 text-ink">
        {section.title}
      </h2>
      {section.intro === undefined ? null : <p className="mt-1 max-w-reading text-body-s text-ink-secondary">{section.intro}</p>}
      <DefinitionList
        className="mt-2"
        items={section.fields.map((field) => ({
          id: field.id,
          term: field.term,
          derived: field.derived,
          value: <FieldView field={field} />,
        }))}
      />
    </section>
  );
}

function RawFields({ receipt }: { receipt: Receipt }): JSX.Element {
  const fields = rawReceiptFields(receipt);
  return (
    <details className="group min-w-0 rounded-module border border-border bg-surface">
      <summary className="flex min-h-touch cursor-pointer list-none items-center justify-between gap-3 rounded-module px-card py-3 [&::-webkit-details-marker]:hidden">
        <h2 className="text-h3 text-ink">All {fields.length} fields as stored</h2>
        <Icon name="chevronDown" className="text-ink-secondary transition-transform duration-fast ease-standard group-open:rotate-180" />
      </summary>
      <div className="border-t border-border px-card pb-1 pt-3">
        <p className="max-w-reading text-body-s text-ink-secondary">
          The module stores keccak256 of these values, encoded in this order, as the receipt hash. Each enum shows its
          uint8 in parentheses.
        </p>
        <DefinitionList
          className="mt-2"
          items={fields.map((field) => ({
            id: field.name,
            term: (
              <>
                <span className="font-mono text-mono-s text-ink">{field.name}</span>{' '}
                <span className="font-mono text-mono-s text-ink-muted">{field.type}</span>
              </>
            ),
            value: field.value,
            mono: true,
          }))}
        />
      </div>
    </details>
  );
}

function DetailSkeleton(): JSX.Element {
  return (
    <SkeletonGroup label="Loading the receipt" className="flex flex-col gap-stack">
      <div className="rounded-module border border-border bg-surface p-card">
        <Skeleton className="h-5 w-20 rounded-control" />
        <SkeletonText lines={2} className="mt-4 max-w-reading" />
        <Skeleton className="mt-6 h-3 w-full rounded-pill" />
        <div className="mt-3 flex gap-8">
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-6 w-24" />
        </div>
      </div>
      <div className="rounded-module border border-border bg-surface p-card">
        <Skeleton className="h-4 w-36" />
        <SkeletonText lines={4} className="mt-5" />
      </div>
    </SkeletonGroup>
  );
}

export interface ReceiptDetailProps {
  /** The receipt id as the URL gave it, already checked by parseReceiptId. */
  id: string;
  /** The issuer disclosure block, rendered on the server from the served file. */
  disclosure: ReactNode;
}

export function ReceiptDetail({ id, disclosure }: ReceiptDetailProps): JSX.Element {
  const receiptId = BigInt(id);
  const receipt = useReceipt(receiptId);
  const session = useSession();
  const [composer, setComposer] = useState({ open: false, key: 0 });

  const record = receipt.data ?? null;
  const viewer = session.data?.account ?? null;
  const isOwner = record !== null && viewer !== null && viewer.toLowerCase() === record.receipt.account.toLowerCase();
  const canMakeCard = record !== null && isOwner && (record.receipt.status === 'FILLED' || record.receipt.status === 'SETTLED');

  let body: ReactNode;
  if (receipt.isPending) {
    body = <DetailSkeleton />;
  } else if (receipt.isError && record === null) {
    body = (
      <ErrorBlock
        title={`Receipt ${id} did not load`}
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
        title={`No receipt ${id} yet`}
        action={
          <ButtonLink href="/receipts" variant="secondary">
            See your receipts
          </ButtonLink>
        }
      >
        Receipt numbers count up from 1 across every Sleeve account. This one has not been written yet.
      </EmptyState>
    );
  } else {
    body = (
      <div className="flex flex-col gap-stack">
        <ReceiptHero record={record} />
        {viewer !== null && !isOwner ? (
          <Note title="Another account's receipt">
            This receipt belongs to {shortAddress(record.receipt.account)}. Receipts are public, so anyone can read and
            recompute it.
          </Note>
        ) : null}
        {receiptSections(record).map((section) => (
          <SectionView key={section.id} section={section} />
        ))}
        <RawFields receipt={record.receipt} />
        {disclosure}
      </div>
    );
  }

  return (
    <>
      <PageHeader
        back={{ href: '/receipts', label: 'Receipts' }}
        title={
          <span className="flex items-center gap-3">
            {record === null || record.receipt.status === 'RECONCILED' ? null : (
              <TickerIcon tickerId={record.receipt.tickerId} size="xl" />
            )}
            <span>{`Receipt ${id}`}</span>
          </span>
        }
        description={record === null ? undefined : receiptTitle(record)}
        actions={
          canMakeCard ? (
            <Button variant="secondary" onClick={() => setComposer((current) => ({ open: true, key: current.key + 1 }))}>
              Make a card
            </Button>
          ) : undefined
        }
      />
      {body}
      {canMakeCard ? (
        <CardComposer
          key={composer.key}
          open={composer.open}
          onClose={() => setComposer((current) => ({ ...current, open: false }))}
          subject={{ kind: 'receipt', receiptId }}
        />
      ) : null}
    </>
  );
}
