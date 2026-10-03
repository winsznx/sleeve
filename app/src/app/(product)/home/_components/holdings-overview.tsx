import { formatStockToken, formatUsdg } from '@sleeve/core';
import Link from 'next/link';
import { useId, type JSX } from 'react';

import { allocationOf } from '@/app/(product)/holdings/_lib/holdings';
import { utcSpan } from '@/components/shell/time-words';
import { SampleTag } from '@/components/shell/sample-tag';
import { tickerSymbol } from '@/components/sleeve/text';
import { TickerIcon } from '@/components/token/ticker-icon';
import { Amount } from '@/components/ui/amount';
import { cx } from '@/components/ui/cx';
import { DebtSecurityLine } from '@/components/ui/debt-security-line';
import { formatUtc } from '@/components/ui/format-time';
import type { Holding } from '@/data/types';

const LINK = 'inline-flex min-h-touch items-center text-body-s font-medium text-link underline underline-offset-4 hover:text-link-hover';
/** Two greens alternate so neighbouring parts stay apart; each part also carries its icon and words. */
const SEGMENT = ['bg-equity', 'bg-accent-strong'] as const;

/** When the prices behind the values were published: one time when they read alike to the minute, else the span. */
function pricedAt(times: readonly bigint[]): string | null {
  const shown = new Set(times.map(formatUtc));
  const [only] = shown;
  return shown.size === 1 && only !== undefined ? only : utcSpan(times);
}

/**
 * Home's holdings overview (PRD 7.11): the Stock Tokens the paydays bought, how they divide by value, each balance
 * with the debt security line under it, and the value from balance times the Chainlink price, with that price's time.
 * The pool price stays on Holdings, apart from the reference, as everywhere.
 */
export function HoldingsOverview({ holdings }: { holdings: readonly Holding[] }): JSX.Element {
  const headingId = useId();
  const held = holdings.filter((holding) => holding.balance > 0n);
  const allocation = allocationOf(held);
  const priced = pricedAt(held.map((holding) => holding.feed.updatedAt));
  const byTicker = new Map(held.map((holding) => [holding.tickerId, holding]));

  return (
    <section aria-labelledby={headingId} className="min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h2 id={headingId} className="text-h2 text-ink">
          Holdings
        </h2>
        <Link href="/holdings" className={LINK}>
          See holdings
        </Link>
      </div>
      <div className="mt-3 rounded-module border border-border bg-surface p-card">
        {held.length === 0 ? (
          <p className="text-body-s text-ink-secondary">
            No Stock Tokens yet. Your equity share buys them as payments arrive, and they show here.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-body-s text-ink-secondary">At the Chainlink reference</p>
              <SampleTag />
            </div>
            <p className="mt-1 text-figure-m tabular-nums text-ink">
              <Amount value={formatUsdg(allocation.total)} unit="USDG" />
            </p>
            <div aria-hidden="true" className="mt-4 flex h-3 w-full gap-0.5">
              {allocation.slices.map((slice, index) => (
                <span
                  key={slice.tickerId}
                  className={cx('h-full min-w-1.5 basis-0 rounded-pill', SEGMENT[index % SEGMENT.length])}
                  style={{ flexGrow: slice.tenths }}
                />
              ))}
            </div>
            <ul aria-label="By value" className="mt-4 divide-y divide-border">
              {allocation.slices.map((slice, index) => {
                const holding = byTicker.get(slice.tickerId);
                const symbol = tickerSymbol(slice.tickerId);
                return (
                  <li key={slice.tickerId} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                    <TickerIcon tickerId={slice.tickerId} size="lg" />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-x-2 text-body font-semibold text-ink">
                        <span aria-hidden="true" className={cx('size-2.5 shrink-0 rounded-pill', SEGMENT[index % SEGMENT.length])} />
                        {holding === undefined ? symbol : <Amount value={formatStockToken(holding.balance)} unit={symbol} kind="equity" />}
                      </p>
                      <DebtSecurityLine />
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-body font-semibold tabular-nums text-ink">
                        <Amount value={formatUsdg(slice.value)} unit="USDG" />
                      </p>
                      <p className="text-body-s tabular-nums text-ink-muted">{slice.percent}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
            {priced === null ? null : (
              <p className="mt-4 border-t border-border pt-3 text-body-s text-ink-muted">
                Value is balance times the Chainlink price from {priced}.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
