import { formatUsdg, type Rule } from '@sleeve/core';
import type { JSX } from 'react';

import { tickerSymbol } from '@/components/sleeve/text';
import { TokenIcon } from '@/components/token/token-icon';
import { Amount } from '@/components/ui/amount';
import { cx } from '@/components/ui/cx';

import { bpsWords, lotCount, type Allocation, type SessionWords } from '../_lib/holdings';

/**
 * The top of the holdings screen: what the Stock Tokens are worth at the Chainlink reference, how they divide by
 * value, the market session the guard reads, and what the rule adds with every payday. The bar is all equity green,
 * because every part of it is Stock Tokens; the parts alternate two greens and a hairline of surface between them,
 * and each carries its token icon and its part in words, so no part relies on color.
 */

/** Below this many tenths of a percent a part is too narrow to carry its label inside the bar. */
const LABEL_MIN_TENTHS = 150;

const SEGMENT = ['bg-equity', 'bg-accent-strong'] as const;

function SessionChip({ session }: { session: SessionWords }): JSX.Element {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill px-2.5 py-1 text-label font-semibold',
        session.open ? 'bg-equity-soft text-equity' : 'bg-waiting-soft text-waiting',
      )}
    >
      <span aria-hidden="true" className={cx('size-2.5 rounded-pill', session.open ? 'bg-equity' : 'bg-waiting-stripes')} />
      {session.label}
    </span>
  );
}

function ruleLine(rule: Rule): string | null {
  switch (rule.status) {
    case 'ACTIVE':
      return `Your rule adds ${bpsWords(rule.equityBps)} of every payday to ${tickerSymbol(rule.tickerId)}.`;
    case 'PAUSED':
      return 'Your rule is paused, so new paydays stay as USDG until you resume it.';
    case 'NONE':
      return null;
  }
}

export interface AllocationCardProps {
  allocation: Allocation;
  holdingCount: number;
  lots: number;
  session: SessionWords | null;
  rule: Rule | null;
}

export function AllocationCard({ allocation, holdingCount, lots, session, rule }: AllocationCardProps): JSX.Element {
  const line = rule === null ? null : ruleLine(rule);
  return (
    <section aria-labelledby="holdings-total-title" className="min-w-0 rounded-module border border-border bg-surface p-card shadow-card md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h2 id="holdings-total-title" className="text-body-s font-medium text-ink-secondary">
            Stock Tokens, at the Chainlink reference
          </h2>
          <p className="mt-1 text-figure-l text-ink">
            <Amount value={formatUsdg(allocation.total)} unit="USDG" />
          </p>
          <p className="mt-1 text-body-s text-ink-secondary">
            {holdingCount === 1 ? '1 Stock Token' : `${holdingCount} Stock Tokens`} in {lotCount(lots)}
          </p>
        </div>
        {session === null ? null : (
          <div className="flex flex-col items-start gap-1 sm:items-end">
            <SessionChip session={session} />
            {session.detail === null ? null : <p className="text-body-s text-ink-muted">{session.detail}</p>}
          </div>
        )}
      </div>

      {allocation.slices.length === 0 ? null : (
        <>
          <div aria-hidden="true" className="mt-5 flex h-11 w-full gap-0.5 overflow-hidden rounded-row">
            {allocation.slices.map((slice, index) => (
              <span
                key={slice.tickerId}
                data-slice={slice.symbol}
                className={cx(
                  'flex h-full min-w-2 basis-0 items-center gap-2 overflow-hidden px-2.5 text-label font-semibold text-on-accent first:rounded-l-row last:rounded-r-row',
                  SEGMENT[index % SEGMENT.length],
                )}
                style={{ flexGrow: slice.tenths }}
              >
                {slice.tenths >= LABEL_MIN_TENTHS ? (
                  <>
                    {slice.token === null ? null : <TokenIcon token={slice.token} size="xs" cutout="surface" decorative />}
                    <span className="truncate tabular-nums">
                      {slice.symbol} {slice.percent}
                    </span>
                  </>
                ) : null}
              </span>
            ))}
          </div>
          <ul aria-label="By value" className="mt-4 grid gap-x-8 gap-y-2.5 sm:grid-cols-2">
            {allocation.slices.map((slice, index) => (
              <li key={slice.tickerId} className="flex min-w-0 items-center gap-3">
                <span aria-hidden="true" className={cx('size-2.5 shrink-0 rounded-pill', SEGMENT[index % SEGMENT.length])} />
                {slice.token === null ? null : <TokenIcon token={slice.token} size="md" decorative />}
                <a href={`#holding-${slice.symbol}`} className="min-w-0 text-body font-semibold text-ink underline-offset-4 hover:underline">
                  {slice.symbol}
                </a>
                <span className="text-body-s tabular-nums text-ink-secondary">{slice.percent}</span>
                <span className="ml-auto text-body tabular-nums text-ink">
                  <Amount value={formatUsdg(slice.value)} unit="USDG" />
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {line === null ? null : <p className="mt-5 border-t border-border pt-4 text-body-s text-ink-secondary">{line}</p>}
    </section>
  );
}
