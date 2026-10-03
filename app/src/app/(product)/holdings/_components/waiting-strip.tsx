import type { Rule } from '@sleeve/core';
import Link from 'next/link';
import type { JSX } from 'react';

import { reasonSentence, tickerSymbol, usdgExact } from '@/components/sleeve/text';
import { Amount } from '@/components/ui/amount';
import { cx } from '@/components/ui/cx';
import type { BucketView } from '@/data/types';

/**
 * USDG waiting to buy a Stock Token (PRD 7.4 and 15, Waiting), as a strip under the holding it will add to: amber
 * stripes, the amount, why it waits and what happens next in plain words. Releasing it to spend asks for a decision,
 * so it lives on Home with the other waiting money; the strip links there. The money is USDG in the owner's account
 * the whole time, never a Stock Token until it buys.
 */

export interface WaitingStripProps {
  bucket: BucketView;
  /** For a wait on the market session: when it reopens (TickerMarket.session.nextOpenAt). */
  reopensAt: bigint | null;
  /** The rule's minimum buy and cap, for the reason sentence. */
  rule: Pick<Rule, 'minClip' | 'premiumCapBps'> | null;
  /** "more" when the account already holds the ticker. */
  holdsTicker: boolean;
  className?: string;
}

export function WaitingStrip({ bucket, reopensAt, rule, holdsTicker, className }: WaitingStripProps): JSX.Element {
  const symbol = tickerSymbol(bucket.tickerId);
  return (
    <div data-waiting={symbol} className={cx('min-w-0 overflow-hidden rounded-row border border-border bg-surface', className)}>
      <span aria-hidden="true" className="block h-1.5 bg-waiting-stripes" />
      <div className="flex flex-col gap-2 p-3.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 text-body-s">
          <p className="font-medium text-ink">
            <Amount value={usdgExact(bucket.amount)} unit="USDG" kind="waiting" /> waits to buy {holdsTicker ? 'more ' : ''}
            {symbol}
          </p>
          <p className="mt-0.5 text-ink-secondary">
            {reasonSentence(bucket.reason, {
              symbol,
              reopensAt,
              minClip: rule?.minClip,
              premiumCapBps: rule?.premiumCapBps,
            })}
          </p>
        </div>
        <Link
          href="/home"
          className="inline-flex min-h-touch shrink-0 items-center text-body-s font-medium text-link underline underline-offset-4 hover:text-link-hover sm:-mt-3"
        >
          See it on Home
        </Link>
      </div>
    </div>
  );
}
