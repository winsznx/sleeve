import { formatFeedPrice, formatUsdg, type Receipt } from '@sleeve/core';
import type { JSX } from 'react';

import { cx } from '@/components/ui/cx';
import { formatUtc } from '@/components/ui/format-time';

import { percentWords, tickerSymbol } from './text';

/**
 * What a fill paid against the market reference (docs/DESIGN.md 12.2, PRD 7.11 and 16). The premium is a plain
 * sentence, never green or red. The all-in price comes from what left and entered the account, so it includes
 * every pool fee, even one taken inside a hook. The pool fill and the Chainlink reference are separate lines,
 * each with its own time; Sleeve never merges them into one price.
 */

export type PremiumSide = 'buy' | 'sell';

/** "Bought 0.04 percent above the market reference." The sign of premiumBps is the receipt's. */
export function premiumSentence(side: PremiumSide, premiumBps: bigint): string {
  const verb = side === 'buy' ? 'Bought' : 'Sold';
  if (premiumBps === 0n) return `${verb} at the market reference.`;
  const direction = premiumBps > 0n ? 'above' : 'below';
  return `${verb} ${percentWords(premiumBps)} ${direction} the market reference.`;
}

/** Term over value on a phone, side by side from 640 px. */
const ROW = 'grid grid-cols-1 gap-0.5 py-2 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-4';

export interface PremiumLineProps {
  side: PremiumSide;
  symbol: string;
  /** USDG base units per whole token, all in (receipt execPrice). */
  execPrice: bigint;
  /** Signed basis points against the feed (receipt premiumBps). */
  premiumBps: bigint;
  /** The Chainlink answer, 8 decimals (receipt answer). */
  referencePrice: bigint;
  /** When that answer was published (receipt updatedAt). */
  referenceAt: bigint;
  /** Block time of the fill (receipt timestamp). */
  filledAt: bigint;
  /** Only the sentence, for cards and rows. */
  compact?: boolean;
  className?: string;
}

export function PremiumLine({
  side,
  symbol,
  execPrice,
  premiumBps,
  referencePrice,
  referenceAt,
  filledAt,
  compact = false,
  className,
}: PremiumLineProps): JSX.Element {
  const sentence = premiumSentence(side, premiumBps);
  if (compact) return <p className={cx('text-body-s text-ink-secondary', className)}>{sentence}</p>;

  return (
    <div className={cx('min-w-0 text-body-s', className)}>
      <p className="text-ink-secondary">{sentence}</p>
      <dl className="mt-2 divide-y divide-border border-y border-border">
        <div className={ROW}>
          <dt className="text-ink-secondary">All-in price</dt>
          <dd className="sm:text-right">
            <span className="font-medium tabular-nums text-ink">
              <span className="whitespace-nowrap">{formatUsdg(execPrice)}</span> USDG per {symbol}
            </span>
            <span className="block text-ink-muted">
              {side === 'buy' ? 'Paid' : 'Received'} {formatUtc(filledAt)}
            </span>
          </dd>
        </div>
        <div className={ROW}>
          <dt className="text-ink-secondary">Market reference</dt>
          <dd className="sm:text-right">
            <span className="font-medium tabular-nums text-ink">
              <span className="whitespace-nowrap">{formatFeedPrice(referencePrice)}</span> USD per {symbol}
            </span>
            <span className="block text-ink-muted">Chainlink price from {formatUtc(referenceAt)}</span>
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-ink-muted">
        The all-in price is what left and entered your account, so it includes every pool fee.
      </p>
    </div>
  );
}

/** The premium line for a receipt that bought or sold, or null for one that did neither. */
export function premiumLinePropsOf(receipt: Receipt): Omit<PremiumLineProps, 'compact' | 'className'> | null {
  const side: PremiumSide | null =
    receipt.status === 'FILLED' || receipt.status === 'SETTLED'
      ? 'buy'
      : receipt.status === 'PART_SOLD' || receipt.status === 'SOLD'
        ? 'sell'
        : null;
  if (side === null || receipt.execPrice === 0n) return null;
  return {
    side,
    symbol: tickerSymbol(receipt.tickerId),
    execPrice: receipt.execPrice,
    premiumBps: receipt.premiumBps,
    referencePrice: receipt.answer,
    referenceAt: receipt.updatedAt,
    filledAt: receipt.timestamp,
  };
}
