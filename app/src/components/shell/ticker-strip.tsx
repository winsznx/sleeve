'use client';

import { formatFeedPrice } from '@sleeve/core';
import type { JSX } from 'react';

import { tickerSymbol } from '@/components/sleeve/text';
import { tickerTokenKey } from '@/components/token/ticker-icon';
import { TokenIcon } from '@/components/token/token-icon';
import { cx } from '@/components/ui/cx';
import { useMarket } from '@/data/hooks';

import { SampleTag } from './sample-tag';
import styles from './shell.module.css';
import { utcSpan } from './time-words';

/**
 * The launch Stock Tokens under the marketing bar, each with its icon and the Chainlink reference price, after the
 * markets strips of Yahoo Finance and Jupiter (docs/design/inspiration.md 1), and when those prices were published.
 * Only the reference: the pool quote sits beside it in the markets panel, never merged with it (PRD 7.11). No change,
 * no sparkline, no color for direction.
 *
 * Below 1024 px the strip scrolls sideways, so it is a named region in the tab order: a keyboard reaches it and the
 * arrow keys scroll it (WCAG 2.1.1). The ring is drawn inside, clear of the edge fade.
 */
export function TickerStrip({ className }: { className?: string }): JSX.Element {
  const market = useMarket();
  const tickers = market.data?.tickers ?? [];
  const published = utcSpan(tickers.map((ticker) => ticker.feed.updatedAt));

  return (
    <div className={cx('border-b border-border', className)}>
      <div
        role="region"
        aria-label="Launch Stock Tokens at the Chainlink reference price"
        tabIndex={0}
        className={cx(
          styles.strip,
          'mx-auto flex min-h-9 w-full max-w-content items-center gap-x-5 overflow-x-auto px-gutter text-body-s focus-visible:-outline-offset-2',
        )}
      >
        {market.data === undefined ? (
          market.isError ? (
            <p className="py-2 text-ink-secondary">Reference prices are unavailable right now.</p>
          ) : (
            <ul aria-busy="true" aria-label="Loading reference prices" className="flex items-center gap-5 py-2">
              {[0, 1, 2, 3].map((slot) => (
                <li key={slot} className="h-4 w-24 rounded-xs bg-skeleton" />
              ))}
            </ul>
          )
        ) : (
          <>
            <ul className="flex shrink-0 items-center gap-x-5 py-2">
              {tickers.map((ticker) => {
                const icon = tickerTokenKey(ticker.tickerId);
                return (
                  <li key={ticker.tickerId} className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
                    {icon === null ? null : <TokenIcon token={icon} size="xs" decorative />}
                    <span className="font-semibold text-ink">{tickerSymbol(ticker.tickerId)}</span>
                    <span className="tabular-nums text-ink">{formatFeedPrice(ticker.feed.answer)}</span>
                    <span className="text-ink-secondary">USD</span>
                  </li>
                );
              })}
            </ul>
            <p className="flex shrink-0 items-center gap-2 whitespace-nowrap py-2 text-ink-secondary lg:ml-auto">
              <span>
                Chainlink reference
                {published === null ? null : <span className="hidden xl:inline">, {published}</span>}
              </span>
              <SampleTag />
            </p>
          </>
        )}
      </div>
    </div>
  );
}
