'use client';

import { formatUsdg } from '@sleeve/core';
import Link from 'next/link';
import { useState, type JSX } from 'react';

import { StackedBarChart } from '@/components/charts/stacked-bar-chart';
import { TickerIcon } from '@/components/token/ticker-icon';
import { SegmentedControl } from '@/components/ui/choice';
import { cx } from '@/components/ui/cx';
import { EmptyState } from '@/components/ui/empty-state';

import { becameSentence, chartBars, periodPoints, periodTitle, tickText, type PaydayPoint, type PeriodPoint } from '../_lib/overview';
import { OverviewCard } from './overview-card';

/** The most bars the chart draws; older paydays stay in Payments and History. */
const MAX_BARS = 12;

type Period = 'payday' | 'week';

const PERIODS = [
  { value: 'payday', label: 'Paydays' },
  { value: 'week', label: 'Weeks' },
] as const;

const KEY = [
  { id: 'spend', swatch: 'bg-spend', label: 'Stayed spendable' },
  { id: 'equity', swatch: 'bg-equity', label: 'Bought Stock Tokens' },
  { id: 'waiting', swatch: 'bg-waiting-stripes ring-1 ring-inset ring-waiting', label: 'Waiting to buy' },
] as const;

function ChosenDetail({ period, by }: { period: PeriodPoint; by: Period }): JSX.Element {
  const latest = period.paydays.at(-1);
  const tickers = [...new Set(period.paydays.map((payday) => payday.tickerId))];
  return (
    <div aria-live="polite" className="mt-4 flex flex-col gap-2 rounded-row bg-surface-muted p-3.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 flex shrink-0 -space-x-1.5">
          {tickers.map((tickerId) => (
            <TickerIcon key={tickerId} tickerId={tickerId} size="md" />
          ))}
        </span>
        <p className="min-w-0 text-body-s text-ink">
          <span className="font-semibold">{periodTitle(period, by)}</span>
          {by === 'week' ? <span className="text-ink-secondary">, {period.paydays.length === 1 ? '1 payday' : `${period.paydays.length} paydays`}</span> : null}
          <span className="block text-ink-secondary">
            <span className="tabular-nums">{formatUsdg(period.total)} USDG</span> arrived. {becameSentence(period)}
          </span>
        </p>
      </div>
      {by === 'payday' && latest !== undefined ? (
        <Link
          href={`/receipts/${latest.id}`}
          className="shrink-0 self-start rounded-control text-body-s font-medium text-link underline underline-offset-4 hover:text-link-hover sm:self-center"
        >
          Details of #{latest.id}
        </Link>
      ) : null}
    </div>
  );
}

/**
 * Paydays over time (D-029): one hatched bar per payday or per week, spend at the bottom and the equity share above
 * it, bought or still waiting. The latest bar starts chosen, solid, with its amount in a pill; choosing another bar
 * says what that payday became.
 */
export function PaydaysCard({ points, className }: { points: readonly PaydayPoint[]; className?: string }): JSX.Element {
  const [by, setBy] = useState<Period>('payday');
  const [chosen, setChosen] = useState<string | null>(null);
  const periods = periodPoints(points, by).slice(-MAX_BARS);
  const bars = chartBars(periods, by);
  const selected = periods.find((period) => period.id === chosen) ?? periods.at(-1);
  const received = periods.reduce((sum, period) => sum + period.total, 0n);
  const count = periods.reduce((sum, period) => sum + period.paydays.length, 0);

  return (
    <OverviewCard
      title="Paydays"
      className={className}
      aside={
        points.length === 0 ? undefined : (
          <SegmentedControl
            legend="Show by"
            legendHidden
            options={PERIODS}
            value={by}
            onChange={(next) => {
              setBy(next);
              setChosen(null);
            }}
          />
        )
      }
    >
      {points.length === 0 ? (
        <EmptyState title="No paydays yet" headingLevel={3} className="flex-1 justify-center">
          Each payment your rule splits shows here as a bar: what stayed spendable and what bought Stock Tokens.
        </EmptyState>
      ) : (
        <>
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-figure-l tabular-nums text-ink">
              {formatUsdg(received)} <span className="text-h3 font-medium text-ink-secondary">USDG</span>
            </span>
            <span className="text-body-s text-ink-secondary">
              arrived in {count === 1 ? '1 payday' : `${count} paydays`}
              {by === 'week' ? `, ${periods.length === 1 ? '1 week' : `${periods.length} weeks`}` : ''}
            </span>
          </p>
          <StackedBarChart
            bars={bars}
            selectedId={selected?.id ?? null}
            onSelect={setChosen}
            formatTick={tickText}
            label={by === 'week' ? 'USDG that arrived each week' : 'USDG that arrived each payday'}
            className="mt-4"
          />
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-body-s text-ink-secondary">
            {KEY.map((item) => (
              <li key={item.id} className="flex items-center gap-1.5">
                <span aria-hidden="true" className={cx('size-2.5 rounded-xs', item.swatch)} />
                {item.label}
              </li>
            ))}
          </ul>
          {selected === undefined ? null : <ChosenDetail period={selected} by={by} />}
        </>
      )}
    </OverviewCard>
  );
}
