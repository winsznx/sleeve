import { formatStockToken, type Receipt } from '@sleeve/core';
import Link from 'next/link';
import type { JSX } from 'react';

import { TickerIcon } from '@/components/token/ticker-icon';
import { TokenIcon } from '@/components/token/token-icon';
import { Amount } from '@/components/ui/amount';
import { REASON_LABEL, StatusTag } from '@/components/ui/badge';
import { cx } from '@/components/ui/cx';
import { DebtSecurityLine } from '@/components/ui/debt-security-line';
import { formatUtc } from '@/components/ui/format-time';
import { ListRow } from '@/components/ui/list';
import type { ReceiptRecord } from '@/data/types';

import { PremiumLine, premiumLinePropsOf } from './premium-line';
import { SplitLegend, SplitRail, splitPartsOf, type SplitLegendItem, type SplitParts } from './split-rail';
import { receiptHeadline, receiptMeta, receiptSentence, receiptTitle, tickerSymbol, usdgExact, usdgExactText } from './text';

/** The legend under a split receipt's rail: what stayed spendable, what became the token, what waits. */
function legendOf(receipt: Receipt, symbol: string): SplitLegendItem[] {
  const parts = splitPartsOf(receipt);
  if (parts === null) return [];
  const items: SplitLegendItem[] = [];
  if (parts.spend > 0n) items.push({ kind: 'spend', amount: parts.spend, label: receipt.status === 'RELEASED' ? 'moved to spend' : 'spendable' });
  if (parts.equity > 0n) items.push({ kind: 'equity', amount: parts.equity, label: `became ${symbol}` });
  if (parts.waiting > 0n) {
    const why = receipt.reason === 'NONE' ? 'guard not clear' : REASON_LABEL[receipt.reason].toLowerCase();
    items.push({ kind: 'waiting', amount: parts.waiting, label: `waiting: ${why}` });
  }
  return items;
}

/** The token side of a fill or a sell, with the debt security line directly under it (docs/DESIGN.md 12.5). */
function TokenLine({ receipt, symbol }: { receipt: Receipt; symbol: string }): JSX.Element | null {
  const bought = receipt.status === 'FILLED' || receipt.status === 'SETTLED';
  const sold = receipt.status === 'PART_SOLD' || receipt.status === 'SOLD';
  if (!bought && !sold) return null;
  return (
    <div>
      <p className="text-body text-ink">
        <Amount
          value={formatStockToken(bought ? receipt.tokensOut : receipt.tokensIn)}
          unit={symbol}
          kind={bought ? 'equity' : 'plain'}
          className="font-semibold"
        />{' '}
        <span className="text-ink-secondary">
          {bought ? `for ${usdgExactText(receipt.usdgSpent)}` : `sold for ${usdgExactText(receipt.usdgOut)}`}
        </span>
      </p>
      <DebtSecurityLine className="mt-0.5" />
    </div>
  );
}

export interface ReceiptSummaryProps {
  record: ReceiptRecord;
  /** The receipt page. Adds an "Open receipt" link. */
  href?: string;
  /** The verifier page for this receipt. Adds a "Recompute this receipt" link. */
  verifyHref?: string;
  /** Grow the equity segment once: pass true only the first time a new payment's split appears. */
  animate?: boolean;
  /** h2 on its own, h3 inside a section that already has one. */
  headingLevel?: 2 | 3;
  className?: string;
}

/**
 * One receipt as a card (docs/DESIGN.md 12.4): status tag, one plain sentence from its own numbers, the split rail
 * and legend for a payment, the token amount with the debt security line under it, the premium sentence, then the
 * way to the full receipt and the verifier. The home screen leads with this card for the latest payment.
 */
export function ReceiptSummary({ record, href, verifyHref, animate = false, headingLevel = 2, className }: ReceiptSummaryProps): JSX.Element {
  const receipt = record.receipt;
  const symbol = tickerSymbol(receipt.tickerId);
  const parts = splitPartsOf(receipt);
  const legend = legendOf(receipt, symbol);
  const premium = premiumLinePropsOf(receipt);
  const Heading = headingLevel === 2 ? 'h2' : 'h3';

  return (
    <article className={cx('min-w-0 rounded-module border border-border bg-surface p-card', className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <StatusTag status={receipt.status} />
        <Heading className="text-body-s text-ink-muted">{receiptMeta(record)}</Heading>
      </div>
      <p className="mt-3 text-body text-ink">{receiptSentence(record)}</p>
      {parts === null ? null : (
        <div className="mt-4">
          <SplitRail parts={parts} animate={animate} />
          <SplitLegend items={legend} className="mt-3" />
        </div>
      )}
      <div className="mt-4 flex flex-col gap-2 empty:hidden">
        <TokenLine receipt={receipt} symbol={symbol} />
        {premium === null ? null : <PremiumLine {...premium} compact />}
      </div>
      {href === undefined && verifyHref === undefined ? null : (
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 border-t border-border pt-3 text-body-s">
          {href === undefined ? null : (
            <Link href={href} className="inline-flex min-h-touch items-center font-medium text-link underline underline-offset-4 hover:text-link-hover">
              Open receipt {receipt.id.toString()}
            </Link>
          )}
          {verifyHref === undefined ? null : (
            <Link href={verifyHref} className="inline-flex min-h-touch items-center font-medium text-link underline underline-offset-4 hover:text-link-hover">
              Recompute this receipt
            </Link>
          )}
        </div>
      )}
    </article>
  );
}

export interface ReceiptRowProps {
  record: ReceiptRecord;
  /** The receipt page. */
  href?: string;
}

/** A rail says something in a row only when the payment split into more than one part. */
function splitsInRow(parts: SplitParts | null): parts is SplitParts {
  return parts !== null && [parts.spend, parts.equity, parts.waiting].filter((part) => part > 0n).length > 1;
}

/** One receipt in a ruled List: title, status, number and time, the headline amount, and a 4 px rail for splits. */
export function ReceiptRow({ record, href }: ReceiptRowProps): JSX.Element {
  const receipt = record.receipt;
  const parts = splitPartsOf(receipt);
  return (
    <ListRow
      href={href}
      leading={
        receipt.status === 'RECONCILED' ? (
          <TokenIcon token="USDG" size="lg" decorative />
        ) : (
          <TickerIcon tickerId={receipt.tickerId} size="lg" />
        )
      }
      title={receiptTitle(record)}
      meta={
        <>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <StatusTag status={receipt.status} />
            <span>Receipt {receipt.id.toString()}</span>
          </span>
          <span className="mt-0.5 block">{formatUtc(receipt.timestamp)}</span>
        </>
      }
      trailing={<Amount value={usdgExact(receiptHeadline(record))} unit="USDG" />}
    >
      {splitsInRow(parts) ? <SplitRail parts={parts} size="row" className="mt-3" /> : null}
    </ListRow>
  );
}
