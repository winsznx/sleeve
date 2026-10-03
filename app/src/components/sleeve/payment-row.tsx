import { formatUsdg, shortAddress } from '@sleeve/core';
import Link from 'next/link';
import type { JSX, ReactNode } from 'react';

import { TickerIcon } from '@/components/token/ticker-icon';
import { TokenIcon } from '@/components/token/token-icon';
import { Badge, ReasonTag } from '@/components/ui/badge';
import { cx } from '@/components/ui/cx';
import { DebtSecurityLine } from '@/components/ui/debt-security-line';
import { formatUtc } from '@/components/ui/format-time';
import { Identicon } from '@/components/ui/identicon';
import { Skeleton } from '@/components/ui/skeleton';
import type { InboxItem } from '@/data/types';

import { PAYMENT_STATE_LABEL, PAYMENT_STATE_TONE, type PaymentStory } from './payment-outcome';
import { SplitRail } from './split-rail';

/**
 * One payment (D-024): who sent it, how much, when, whether it is sorted, and what it became, with the way to the
 * details and proof of the split that sorted it. The sender comes from the transfer log, so it is labeled derived
 * where the page explains its source.
 */

/** The sender's picture with the USDG mark on its corner: a payment is always USDG arriving. */
export function SenderMark({ from, size = 'md' }: { from: string; size?: 'md' | 'lg' }): JSX.Element {
  return (
    <span className="relative inline-flex shrink-0 self-start">
      <Identicon value={from} size={size} />
      <span className="absolute -bottom-1 -right-1 inline-flex">
        <TokenIcon token="USDG" size="xs" decorative cutout="surface" />
      </span>
    </span>
  );
}

const DOT = 'size-2 shrink-0 rounded-pill';

/** What the payment became: the thin rail and a line per part, each with its mark. */
export function PaymentBecame({ story, className }: { story: PaymentStory; className?: string }): JSX.Element | null {
  if (story.tone === 'loading' && story.note === null) {
    return (
      <div aria-hidden="true" className={cx('flex flex-col gap-2', className)}>
        <Skeleton className="h-1 w-full rounded-pill" />
        <Skeleton className="h-3.5 w-48 max-w-full" />
      </div>
    );
  }
  const waiting = story.tone === 'waiting';
  return (
    <div className={cx('min-w-0 text-body-s', className)}>
      {story.parts === null ? null : <SplitRail parts={story.parts} size="row" className="mb-2" />}
      <ul className="flex flex-col gap-1">
        {story.spendLine === null ? null : (
          <li className="flex items-start gap-2 text-ink">
            <span aria-hidden="true" className={cx(DOT, 'mt-1.5 bg-spend')} />
            <span className="min-w-0">{story.spendLine}</span>
          </li>
        )}
        {story.equityLine === null ? null : (
          <li className="flex items-start gap-2 text-ink">
            {story.tickerId === null ? (
              <span aria-hidden="true" className={cx(DOT, 'mt-1.5', waiting ? 'bg-waiting-stripes' : 'bg-equity')} />
            ) : (
              <TickerIcon tickerId={story.tickerId} size="xs" className="mt-0.5" />
            )}
            <span className="min-w-0">
              {story.equityLine}
              {waiting ? (
                <>
                  {' '}
                  <ReasonTag reason={story.reason} className="align-[1px]" />
                </>
              ) : null}
            </span>
          </li>
        )}
      </ul>
      {story.bought ? <DebtSecurityLine className="mt-1" /> : null}
      {story.note === null ? null : <p className="mt-1 text-ink-muted">{story.note}</p>}
    </div>
  );
}

export interface PaymentRowProps {
  item: InboxItem;
  story: PaymentStory;
  /** The details and proof page of the split that sorted it. Left out while it is not sorted. */
  href?: string;
  /** compact puts what it became under the payment; register gives it its own column from 768 px. */
  layout?: 'compact' | 'register';
  /** More lines under the time, such as the transaction hash. Interactive content needs relative z-[1] to sit above the row link. */
  children?: ReactNode;
}

export function PaymentRow({ item, story, href, layout = 'register', children }: PaymentRowProps): JSX.Element {
  const amount = `${formatUsdg(item.amount, { maxFractionDigits: 6 })} USDG`;
  const receiptId = item.sortedBy?.receiptId;
  return (
    <li
      className={cx(
        'relative border-t border-border px-4 py-3.5 first:border-t-0 md:px-5 md:py-4',
        href !== undefined && 'transition-colors duration-fast ease-standard hover:bg-surface-muted',
      )}
    >
      <div className={cx(layout === 'register' ? 'flex flex-col md:grid md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] md:gap-6' : 'flex')}>
        <div className="flex min-w-0 flex-1 gap-3">
          <SenderMark from={item.from} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <p className="text-body font-semibold tabular-nums text-ink">
                {href === undefined ? (
                  amount
                ) : (
                  <Link
                    href={href}
                    className="after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-focus"
                  >
                    {amount}
                    <span className="sr-only">, details and proof</span>
                  </Link>
                )}
              </p>
              <Badge tone={PAYMENT_STATE_TONE[item.state]}>{PAYMENT_STATE_LABEL[item.state]}</Badge>
            </div>
            <p className="mt-0.5 break-words text-body-s text-ink-secondary">
              From <span className="font-mono text-mono-s">{shortAddress(item.from)}</span>
            </p>
            <p className="mt-0.5 text-body-s text-ink-muted">
              {formatUtc(item.timestamp)}
              {receiptId === undefined ? null : <span>, #{receiptId.toString()}</span>}
            </p>
            {children}
          </div>
        </div>
        {layout === 'register' ? (
          <PaymentBecame story={story} className="mt-3 pl-[calc(var(--size-avatar)_+_0.75rem)] md:mt-0 md:pl-0" />
        ) : null}
      </div>
      {layout === 'compact' ? <PaymentBecame story={story} className="mt-3 pl-[calc(var(--size-avatar)_+_0.75rem)]" /> : null}
    </li>
  );
}
