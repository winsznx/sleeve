'use client';

import { formatFeedPrice, formatUsdg } from '@sleeve/core';
import Link from 'next/link';
import { useId, type JSX } from 'react';

import { premiumSentence } from '@/components/sleeve/premium-line';
import { percentWords, tickerSymbol, tokenText, usdgExactText } from '@/components/sleeve/text';
import { StatusTag } from '@/components/ui/badge';
import { cx } from '@/components/ui/cx';
import { DebtSecurityLine } from '@/components/ui/debt-security-line';
import { DISCLOSURE_ANCHOR } from '@/components/ui/disclosure';
import { formatUtc } from '@/components/ui/format-time';
import { DefinitionList, type DefinitionItem } from '@/components/ui/list';
import { Skeleton, SkeletonGroup, SkeletonText } from '@/components/ui/skeleton';
import { useReceipt } from '@/data/hooks';
import type { ReceiptRecord } from '@/data/types';

import { EXAMPLE_RECEIPT_ID, verifyHref } from './example-receipt';

const FRAME = 'min-w-0 rounded-module border border-border bg-surface p-card';
const LINK = 'inline-flex min-h-touch items-center font-medium text-link underline underline-offset-4 hover:text-link-hover';

/**
 * The example receipt as the chain holds it, field by field (docs/DESIGN.md 12.4): the numbers a verifier
 * recomputes, machine values in mono, the transaction hash marked derived because it comes from logs (PRD 10).
 * It reads the receipt only; recomputing it is the verify page's job, which the link opens.
 */
export function ExampleReceiptFields({ className }: { className?: string }): JSX.Element {
  const receipt = useReceipt(EXAMPLE_RECEIPT_ID ?? undefined);
  if (EXAMPLE_RECEIPT_ID !== null && receipt.isPending) {
    return (
      <SkeletonGroup label="Loading the example receipt" className={cx(FRAME, className)}>
        <Skeleton className="h-5 w-56" />
        <SkeletonText lines={8} className="mt-5" />
      </SkeletonGroup>
    );
  }
  const record = receipt.data ?? null;
  return record === null ? <WhatAReceiptHolds className={className} /> : <ReceiptFields record={record} className={className} />;
}

function fieldsOf(record: ReceiptRecord): DefinitionItem[] {
  const { receipt, derived } = record;
  const symbol = tickerSymbol(receipt.tickerId);
  const cap = derived.rule?.premiumCapBps;
  const items: DefinitionItem[] = [];
  if (receipt.usdgIn > 0n) items.push({ id: 'in', term: 'Arrived', value: usdgExactText(receipt.usdgIn) });
  if (receipt.usdgToSpend > 0n) items.push({ id: 'spend', term: 'Stayed spendable', value: usdgExactText(receipt.usdgToSpend) });
  if (receipt.tokensOut > 0n) {
    items.push({
      id: 'bought',
      term: 'Bought',
      value: (
        <>
          <span className="tabular-nums">
            {tokenText(receipt.tokensOut, symbol)} for {usdgExactText(receipt.usdgSpent)}
          </span>
          <DebtSecurityLine className="mt-0.5" />
        </>
      ),
    });
  }
  if (receipt.execPrice > 0n) {
    items.push({
      id: 'price',
      term: 'Price paid, all in',
      value: <span className="tabular-nums">{`${formatUsdg(receipt.execPrice)} USDG per ${symbol}`}</span>,
    });
  }
  if (receipt.answer > 0n) {
    items.push({
      id: 'reference',
      term: 'Market reference',
      value: (
        <>
          <span className="tabular-nums">{`${formatFeedPrice(receipt.answer)} USD per ${symbol}`}</span>
          <span className="block text-ink-muted">Chainlink price from {formatUtc(receipt.updatedAt)}</span>
        </>
      ),
    });
    items.push({ id: 'round', term: 'Chainlink round', value: receipt.roundId.toString(), mono: true });
  }
  if (receipt.execPrice > 0n && receipt.tokensOut > 0n) {
    items.push({
      id: 'premium',
      term: 'Premium',
      value:
        cap === undefined
          ? premiumSentence('buy', receipt.premiumBps)
          : `${premiumSentence('buy', receipt.premiumBps)} The cap was ${percentWords(cap)}.`,
    });
  }
  items.push(
    { id: 'block', term: 'Block', value: receipt.l2Block.toString(), mono: true },
    {
      id: 'disclosure',
      term: 'Disclosure hash',
      mono: true,
      value: (
        <a href={`#${DISCLOSURE_ANCHOR}`} className="text-link underline underline-offset-4 hover:text-link-hover">
          {receipt.disclosureHash}
        </a>
      ),
    },
    { id: 'tx', term: 'Transaction', value: derived.txHash, mono: true, derived: true },
  );
  return items;
}

function ReceiptFields({ record, className }: { record: ReceiptRecord; className?: string }): JSX.Element {
  const titleId = useId();
  const id = record.receipt.id;
  return (
    <section aria-labelledby={titleId} className={cx(FRAME, className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h3 id={titleId} className="text-h3 text-ink">
          Receipt {id.toString()}, as recorded
        </h3>
        <StatusTag status={record.receipt.status} />
      </div>
      <DefinitionList items={fieldsOf(record)} className="mt-2" />
      <div className="mt-1 border-t border-border pt-2 text-body-s">
        <Link href={verifyHref(id)} className={LINK}>
          Recompute receipt {id.toString()}
        </Link>
      </div>
    </section>
  );
}

/** Before a live example exists, what every receipt records, without numbers. */
function WhatAReceiptHolds({ className }: { className?: string }): JSX.Element {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={cx(FRAME, className)}>
      <h3 id={titleId} className="text-h3 text-ink">
        What every receipt records
      </h3>
      <DefinitionList
        className="mt-2"
        items={[
          { id: 'amounts', term: 'The payment', value: 'What arrived, what stayed spendable, and what bought or waited.' },
          { id: 'price', term: 'The price', value: 'The all-in price paid, from what left and entered the account.' },
          { id: 'reference', term: 'The reference', value: 'The Chainlink round and price the buy was checked against.' },
          { id: 'disclosure', term: 'The disclosure', value: 'The hash of the issuer text shown further down this page.' },
        ]}
      />
    </section>
  );
}
