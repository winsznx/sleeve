import type { Reason, Status } from '@sleeve/core';
import type { JSX, ReactNode } from 'react';

import { NOT_AVAILABLE_YET } from '@/lib/copy';

import { cx } from './cx';

/**
 * Tags and chips (docs/DESIGN.md 11.6 and 12.3). Color never works alone: every tag carries its word. Status tags
 * show the onchain status name in capitals, the one place Sleeve uses capitals; every other tag is sentence case.
 */

export type BadgeTone = 'equity' | 'waiting' | 'danger' | 'neutral' | 'success' | 'info';

const TONE: Record<BadgeTone, string> = {
  equity: 'bg-equity-soft text-equity',
  waiting: 'bg-waiting-soft text-waiting',
  danger: 'bg-danger-soft text-danger',
  neutral: 'bg-surface-strong text-ink-secondary',
  success: 'bg-success-soft text-success',
  info: 'bg-info-soft text-info',
};

const BADGE = 'inline-flex items-center gap-1 whitespace-nowrap rounded-control border border-border px-2 py-0.5 text-label font-medium';

export interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}

/** A sentence-case tag in one of the status tones. */
export function Badge({ tone = 'neutral', children, className }: BadgeProps): JSX.Element {
  return <span className={cx(BADGE, TONE[tone], className)}>{children}</span>;
}

/** 12.3: what each onchain status looks like. */
export const STATUS_TONE: Record<Status, BadgeTone> = {
  FILLED: 'equity',
  SETTLED: 'equity',
  QUEUED: 'waiting',
  RECONCILED: 'waiting',
  REFUSED_TICKER: 'danger',
  REFUSED_ACCOUNT: 'danger',
  RELEASED: 'neutral',
  PART_SOLD: 'neutral',
  SOLD: 'neutral',
};

/** The onchain name with spaces for underscores: REFUSED TICKER, PART SOLD. */
export function statusLabel(status: Status): string {
  return status.replace(/_/g, ' ');
}

export function StatusTag({ status, className }: { status: Status; className?: string }): JSX.Element {
  return <span className={cx(BADGE, 'uppercase tracking-caps', TONE[STATUS_TONE[status]], className)}>{statusLabel(status)}</span>;
}

/** Why an equity share waits, as a tag. NONE never waits, so it has no label. */
export const REASON_LABEL: Record<Exclude<Reason, 'NONE'>, string> = {
  PAUSED: 'Token paused',
  ORACLE_PAUSED: 'Price updates paused',
  SESSION: 'Market closed',
  MULTIPLIER: 'Multiplier change due',
  STALE: 'Reference price out of date',
  DEPEG: 'USDG not at 1 dollar',
  CLIP: 'Below your minimum buy',
  PREMIUM: 'Price above your cap',
};

/** A waiting-toned tag naming the reason in plain words. Renders nothing for NONE. */
export function ReasonTag({ reason, className }: { reason: Reason; className?: string }): JSX.Element | null {
  if (reason === 'NONE') return null;
  return <span className={cx(BADGE, TONE.waiting, className)}>{REASON_LABEL[reason]}</span>;
}

/** 12.8: the only label a gated feature carries. Dashed, so it reads as deliberately unavailable. */
export function GatedTag({ className }: { className?: string }): JSX.Element {
  return (
    <span
      className={cx(
        'inline-flex items-center whitespace-nowrap rounded-control border border-dashed border-border-strong bg-surface-muted px-2 py-0.5 text-label font-medium text-ink-secondary',
        className,
      )}
    >
      {NOT_AVAILABLE_YET}
    </span>
  );
}

/** The ticker symbol only. No company, fund or issuer logos. */
export function TickerChip({ symbol, className }: { symbol: string; className?: string }): JSX.Element {
  return (
    <span
      className={cx(
        'inline-flex items-center whitespace-nowrap rounded-pill border border-border bg-surface px-2.5 py-0.5 text-label font-semibold text-ink',
        className,
      )}
    >
      {symbol}
    </span>
  );
}

export function CountBadge({ count, className }: { count: number; className?: string }): JSX.Element {
  return (
    <span
      className={cx(
        'inline-flex min-w-5 items-center justify-center rounded-pill bg-surface-strong px-2 text-label font-semibold tabular-nums text-ink-secondary',
        className,
      )}
    >
      {count}
    </span>
  );
}
