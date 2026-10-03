'use client';

import type { JSX } from 'react';

import { cx } from '@/components/ui/cx';

import styles from './charts.module.css';

/**
 * A stacked bar chart drawn with plain elements: one bar per payday or week, spend at the bottom, then what bought
 * Stock Tokens, then what waits. Resting bars wear a fine hatch in their parts' tints and the chosen bar is solid,
 * with its amount in a pill over it. Waiting money is always the amber stripe. Axis labels are text, so they keep
 * their size at every width; every bar is a toggle button that names its payday in words.
 */

export type BarPart = 'spend' | 'equity' | 'waiting';

export interface ChartBar {
  id: string;
  /** Under the bar: "22", or "14 Sep" for a week. */
  label: string;
  /** Parts from the bottom up. Values only set proportions, so whole USDG as a number is enough. */
  parts: readonly { kind: BarPart; value: number }[];
  /** Over the chosen bar: "1,200 USDG". */
  pill: string;
  /** The bar's accessible name: the date, the amount and what it became. */
  description: string;
}

export interface StackedBarChartProps {
  bars: readonly ChartBar[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** An axis tick in the chart's unit, without the unit: "1,500". */
  formatTick: (value: number) => string;
  /** Names the group of bars for assistive technology. */
  label: string;
  className?: string;
}

const REST: Record<BarPart, string> = {
  spend: styles.restSpend ?? '',
  equity: styles.restEquity ?? '',
  waiting: styles.waiting ?? '',
};

const CHOSEN: Record<BarPart, string> = {
  spend: 'bg-spend',
  equity: 'bg-equity',
  waiting: styles.waiting ?? '',
};

/** The pill sits centered over its bar, except at the ends, where it lines up with the chart's edge instead of leaving it. */
type Anchor = 'start' | 'center' | 'end';

const PILL_ANCHOR: Record<Anchor, string> = {
  start: 'left-0',
  center: 'left-1/2 -translate-x-1/2',
  end: 'right-0',
};

function anchorOf(index: number, count: number): Anchor {
  if (count > 2 && index === count - 1) return 'end';
  if (count > 2 && index === 0) return 'start';
  return 'center';
}

/** The smallest of 1, 2, 2.5 and 5 times a power of ten at or above the value. */
function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return nice * power;
}

/** Ticks from zero to a round top at or above the largest bar, about four steps apart. */
export function axisTicks(max: number, steps = 4): number[] {
  const step = niceStep(max / steps);
  const top = Math.max(step, Math.ceil(max / step) * step);
  const ticks: number[] = [];
  for (let value = 0; value <= top + step / 1000; value += step) ticks.push(value);
  return ticks;
}

export function StackedBarChart({ bars, selectedId, onSelect, formatTick, label, className }: StackedBarChartProps): JSX.Element {
  const totals = bars.map((bar) => bar.parts.reduce((sum, part) => sum + part.value, 0));
  const ticks = axisTicks(Math.max(0, ...totals));
  const top = ticks[ticks.length - 1] ?? 1;
  const crowded = bars.length > 8;

  return (
    <div className={cx('flex gap-2 sm:gap-3', className)}>
      <div aria-hidden="true" className="w-9 shrink-0 sm:w-11">
        <div className="relative h-56 sm:h-60">
          <div className="absolute inset-x-0 bottom-0 top-9">
            {ticks.map((tick) => (
              <span
                key={tick}
                className="absolute right-0 translate-y-1/2 text-label tabular-nums text-ink-muted"
                style={{ bottom: `${(tick / top) * 100}%` }}
              >
                {formatTick(tick)}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <div className="relative h-56 sm:h-60">
          <div aria-hidden="true" className="absolute inset-x-0 bottom-0 top-9">
            {ticks.map((tick) => (
              <span
                key={tick}
                className={cx('absolute inset-x-0 border-t border-chart-grid', tick === 0 ? 'border-solid' : 'border-dashed')}
                style={{ bottom: `${(tick / top) * 100}%` }}
              />
            ))}
          </div>
          <div role="group" aria-label={label} className="absolute inset-x-0 bottom-0 top-9 flex items-end gap-1.5 sm:gap-2.5">
            {bars.map((bar, index) => {
              const total = totals[index] ?? 0;
              const chosen = bar.id === selectedId;
              const height = top === 0 ? 0 : (total / top) * 100;
              return (
                <div key={bar.id} className="flex h-full min-w-0 flex-1 justify-center">
                  <button
                    type="button"
                    aria-pressed={chosen}
                    aria-label={bar.description}
                    onClick={() => onSelect(bar.id)}
                    className="group relative flex h-full w-full max-w-[3.25rem] flex-col justify-end rounded-row focus-visible:outline-offset-4"
                  >
                    {chosen ? (
                      <span
                        aria-hidden="true"
                        className={cx(
                          'absolute z-[1] whitespace-nowrap rounded-pill bg-ink px-2.5 py-1 text-label font-semibold tabular-nums text-ink-inverse shadow-raised',
                          PILL_ANCHOR[anchorOf(index, bars.length)],
                        )}
                        style={{ bottom: `calc(${height}% + 0.5rem)` }}
                      >
                        {bar.pill}
                      </span>
                    ) : null}
                    <span
                      aria-hidden="true"
                      className={cx(
                        'flex w-full flex-col-reverse gap-0.5 overflow-hidden rounded-t-[0.625rem] rounded-b-[0.25rem] transition-[filter] duration-fast ease-standard',
                        !chosen && 'group-hover:brightness-95',
                      )}
                      style={{ height: `${height}%` }}
                    >
                      {bar.parts
                        .filter((part) => part.value > 0)
                        .map((part) => (
                          <span
                            key={part.kind}
                            data-part={part.kind}
                            className={cx('block min-h-[3px] w-full', chosen ? CHOSEN[part.kind] : REST[part.kind])}
                            style={{ flexGrow: part.value, flexBasis: 0 }}
                          />
                        ))}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
        <div aria-hidden="true" className="mt-2 flex h-5 gap-1.5 sm:gap-2.5">
          {bars.map((bar, index) => (
            <span
              key={bar.id}
              className={cx(
                'min-w-0 flex-1 truncate text-center text-label tabular-nums',
                bar.id === selectedId ? 'font-semibold text-ink' : 'text-ink-muted',
                crowded && index % 2 === 1 && bar.id !== selectedId && 'invisible sm:visible',
              )}
            >
              {bar.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
