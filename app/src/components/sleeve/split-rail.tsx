import { formatUsdg, type Receipt } from '@sleeve/core';
import type { JSX } from 'react';

import { Amount } from '@/components/ui/amount';
import { cx } from '@/components/ui/cx';
import styles from '@/components/ui/motion.module.css';

/**
 * The split rail, Sleeve's signature (docs/DESIGN.md 12.1): one payment, one bar, spend on the left and the equity
 * share on the right, bought in green or waiting in amber stripes. It is decoration for sighted readers; the
 * legend carries the words and numbers. Refused or released equity is spendable money, so it shows as spend.
 */

export interface SplitParts {
  /** USDG that stayed spendable. */
  spend: bigint;
  /** USDG that bought Stock Tokens. */
  equity: bigint;
  /** USDG waiting as USDG for the guard to clear. */
  waiting: bigint;
}

/** The parts a receipt split into, or null for receipts that split nothing (sells, reconciles). */
export function splitPartsOf(receipt: Receipt): SplitParts | null {
  switch (receipt.status) {
    case 'FILLED':
    case 'QUEUED':
    case 'REFUSED_TICKER':
    case 'REFUSED_ACCOUNT':
      return { spend: receipt.usdgToSpend, equity: receipt.usdgSpent, waiting: receipt.usdgQueued };
    case 'SETTLED':
      return { spend: 0n, equity: receipt.usdgSpent, waiting: 0n };
    case 'RELEASED':
      return { spend: receipt.usdgIn, equity: 0n, waiting: 0n };
    case 'PART_SOLD':
    case 'SOLD':
    case 'RECONCILED':
      return null;
  }
}

/** A part's flex weight in basis points of the whole, at least 1 so a sliver still gets its 6 px. */
function weight(part: bigint, total: bigint): number {
  return Math.max(1, Number((part * 10_000n) / total));
}

export interface SplitRailProps {
  parts: SplitParts;
  /** card: 12 px with a legend nearby. row: 4 px in list rows, no legend. */
  size?: 'card' | 'row';
  /**
   * Grow the equity segment from zero once, over 360 ms, when a new payment's split first appears. This is the
   * only movement Sleeve makes on its own; it is skipped under reduced motion.
   */
  animate?: boolean;
  className?: string;
}

export function SplitRail({ parts, size = 'card', animate = false, className }: SplitRailProps): JSX.Element | null {
  const total = parts.spend + parts.equity + parts.waiting;
  if (total <= 0n) return null;
  const segments = [
    { id: 'spend', amount: parts.spend, look: 'bg-spend', grows: false },
    { id: 'equity', amount: parts.equity, look: 'min-w-1.5 bg-equity', grows: animate },
    { id: 'waiting', amount: parts.waiting, look: 'min-w-1.5 bg-waiting-stripes', grows: animate },
  ].filter((segment) => segment.amount > 0n);

  return (
    <div aria-hidden="true" className={cx('flex w-full gap-0.5', size === 'card' ? 'h-3' : 'h-1', className)}>
      {segments.map((segment) => (
        <span
          key={segment.id}
          data-part={segment.id}
          className={cx('h-full basis-0 rounded-pill', segment.look, segment.grows && styles.grow)}
          style={{ flexGrow: weight(segment.amount, total) }}
        />
      ))}
    </div>
  );
}

export interface SplitLegendItem {
  kind: 'spend' | 'equity' | 'waiting';
  amount: bigint;
  /** Plain label under the amount: "spendable", "became SPY", "waiting: market closed". */
  label: string;
}

/** Solid dots: the stripes only read at the size of a rail segment. */
const SWATCH: Record<SplitLegendItem['kind'], string> = {
  spend: 'bg-spend',
  equity: 'bg-equity',
  waiting: 'bg-waiting',
};

/**
 * The rail's words: each part's exact USDG amount in text-figure-s over a plain label, with a dot in its segment's
 * color. Parts sit side by side and stack when they do not fit.
 */
export function SplitLegend({ items, className }: { items: readonly SplitLegendItem[]; className?: string }): JSX.Element {
  return (
    <ul className={cx('flex flex-wrap gap-x-8 gap-y-3', className)}>
      {items.map((item) => (
        <li key={item.kind} className="min-w-0">
          <Amount value={formatUsdg(item.amount, { maxFractionDigits: 6 })} unit="USDG" kind={item.kind} className="block text-figure-s" />
          <span className="mt-0.5 flex items-center gap-1.5 text-body-s text-ink-secondary">
            <span aria-hidden="true" className={cx('size-2 shrink-0 rounded-pill', SWATCH[item.kind])} />
            {item.label}
          </span>
        </li>
      ))}
    </ul>
  );
}
