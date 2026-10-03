import type { JSX } from 'react';

import { cx } from './cx';

/**
 * Amounts are colored by what they are, never by direction (docs/DESIGN.md 1.3 and 12.2): spend in ink, equity in
 * green, waiting in amber. Nothing turns red for going down or green for going up.
 */
export type AmountKind = 'spend' | 'equity' | 'waiting' | 'plain';

const KIND: Record<AmountKind, string | undefined> = {
  spend: 'text-ink',
  equity: 'text-equity',
  waiting: 'text-waiting',
  plain: undefined,
};

export interface AmountProps {
  /** Already formatted, with thousands separators: formatUsdg(amount), formatStockToken(tokens). */
  value: string;
  /** "USDG", or the ticker symbol for Stock Tokens. */
  unit: string;
  kind?: AmountKind;
  className?: string;
}

/**
 * Number, then unit, in tabular figures. The number never breaks inside itself; the unit may wrap to the next
 * line on a narrow screen. Size comes from the caller (text-figure-m, text-body).
 */
export function Amount({ value, unit, kind = 'plain', className }: AmountProps): JSX.Element {
  return (
    <span className={cx('tabular-nums', KIND[kind], className)}>
      <span className="whitespace-nowrap">{value}</span> {unit}
    </span>
  );
}
