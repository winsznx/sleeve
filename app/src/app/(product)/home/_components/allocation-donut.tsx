'use client';

import { formatBps, formatUsdg, type TickerId } from '@sleeve/core';
import Link from 'next/link';
import { useState, type JSX } from 'react';

import { DonutChart } from '@/components/charts/donut-chart';
import { tickerSymbol, usdgText } from '@/components/sleeve/text';
import { TickerIcon } from '@/components/token/ticker-icon';
import { cx } from '@/components/ui/cx';
import { DebtSecurityLine } from '@/components/ui/debt-security-line';
import type { BucketView, Holding } from '@/data/types';

import { allocation } from '../_lib/overview';
import { OverviewCard } from './overview-card';

/**
 * Tones by size, largest first, as Holdings draws its allocation bar: the two greens it alternates, then a lighter
 * green and the equity hairline for a third and fourth ticker. Every Stock Token is the equity side of the split.
 */
const TONES = [
  { stroke: 'stroke-equity', swatch: 'bg-equity' },
  { stroke: 'stroke-accent-strong', swatch: 'bg-accent-strong' },
  { stroke: 'stroke-equity/50', swatch: 'bg-equity/50' },
  { stroke: 'stroke-equity-border', swatch: 'bg-equity-border' },
] as const;

function toneAt(index: number): { stroke: string; swatch: string } {
  return TONES[index % TONES.length] ?? TONES[0];
}

export interface AllocationDonutProps {
  holdings: readonly Holding[];
  buckets: readonly BucketView[];
}

/**
 * The Stock Tokens held, by ticker, as a ring (D-029): each ticker's value at the Chainlink reference and its part of
 * the whole, with its icon in the legend. Pointing at a ticker brings its segment forward and puts its figure in the
 * middle. What still waits to buy is named under it, never drawn as held.
 */
export function AllocationDonut({ holdings, buckets }: AllocationDonutProps): JSX.Element {
  const { total, slices } = allocation(holdings);
  const [active, setActive] = useState<TickerId | null>(null);
  const focus = slices.find((slice) => slice.tickerId === active) ?? null;
  const waiting = buckets.reduce((sum, bucket) => sum + bucket.amount, 0n);

  return (
    <OverviewCard
      title="Stock Tokens"
      aside={
        <Link href="/holdings" className="rounded-control text-body-s font-medium text-link underline underline-offset-4 hover:text-link-hover">
          See holdings
        </Link>
      }
    >
      <div className="flex flex-1 flex-col items-center gap-5 sm:flex-row sm:items-center lg:flex-col lg:items-stretch">
        <DonutChart
          segments={
            slices.length === 0
              ? []
              : slices.map((slice, index) => ({ id: slice.tickerId.toString(), value: Number(slice.value / 10_000n), tone: toneAt(index).stroke }))
          }
          activeId={focus === null ? null : focus.tickerId.toString()}
          className="w-44 shrink-0 self-center sm:w-40 xl:w-44"
          center={
            slices.length === 0 ? (
              <span className="text-body-s text-ink-secondary">None yet</span>
            ) : focus === null ? (
              <>
                <span className="text-figure-s tabular-nums text-ink">{formatUsdg(total)}</span>
                <span className="text-label text-ink-secondary">USDG in total</span>
              </>
            ) : (
              <>
                <TickerIcon tickerId={focus.tickerId} size="md" />
                <span className="mt-1 text-body font-semibold tabular-nums text-ink">{formatUsdg(focus.value)}</span>
                <span className="text-label text-ink-secondary">USDG in {tickerSymbol(focus.tickerId)}</span>
              </>
            )
          }
        />
        <div className="w-full min-w-0 flex-1">
          {slices.length === 0 ? (
            <p className="text-body-s text-ink-secondary">Your equity share buys them as payments arrive. Each lands in your own account.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {slices.map((slice, index) => {
                const tone = toneAt(index);
                return (
                  <li key={slice.tickerId}>
                    <button
                      type="button"
                      onPointerEnter={() => setActive(slice.tickerId)}
                      onPointerLeave={() => setActive(null)}
                      onFocus={() => setActive(slice.tickerId)}
                      onBlur={() => setActive(null)}
                      aria-label={`${tickerSymbol(slice.tickerId)}: ${usdgText(slice.value)}, ${formatBps(slice.bps, { maxFractionDigits: 0 })} of your Stock Tokens`}
                      className={cx(
                        'flex w-full items-center gap-2.5 rounded-row px-2 py-1.5 text-left transition-colors duration-fast ease-standard hover:bg-surface-muted',
                        active === slice.tickerId && 'bg-surface-muted',
                      )}
                    >
                      <span aria-hidden="true" className={cx('h-5 w-1 shrink-0 rounded-pill', tone.swatch)} />
                      <TickerIcon tickerId={slice.tickerId} size="sm" />
                      <span className="min-w-0 flex-1 text-body-s font-medium text-ink">{tickerSymbol(slice.tickerId)}</span>
                      <span className="text-body-s tabular-nums text-ink-secondary">{formatBps(slice.bps, { maxFractionDigits: 0 })}</span>
                      <span className="w-20 text-right text-body-s font-semibold tabular-nums text-ink">{formatUsdg(slice.value)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {slices.length === 0 ? null : <DebtSecurityLine className="mt-2 px-2" />}
          {waiting > 0n ? (
            <p className="mt-2 flex items-start gap-2 px-2 text-body-s text-ink-secondary">
              <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-pill bg-waiting-stripes ring-1 ring-inset ring-waiting" />
              <span>
                Plus <span className="font-medium text-ink">{usdgText(waiting)}</span> waiting to buy, held as USDG.
              </span>
            </p>
          ) : null}
        </div>
      </div>
      <p className="mt-4 text-body-s text-ink-muted">Valued at the Chainlink reference, in USDG.</p>
    </OverviewCard>
  );
}
