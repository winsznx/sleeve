import { formatFeedPrice, formatStockToken, formatUsdg, type TickerId } from '@sleeve/core';
import type { JSX, ReactNode } from 'react';

import { percentWords } from '@/components/sleeve/text';
import { tickerTokenKey } from '@/components/token/ticker-icon';
import { cx } from '@/components/ui/cx';
import { formatUtc } from '@/components/ui/format-time';
import { Icon } from '@/components/ui/icons';
import type { SellQuote } from '@/data/types';

import { PoolRoute } from '../../receipts/_components/pool-route';
import { feeTierWords, poolFacts } from '../../receipts/_lib/pool';
import { discountWords, quotePriceLine } from '../sell-text';

/**
 * The quote a sell would run on (PRD 7.5 and 7.11): the pool price and the Chainlink reference on separate lines,
 * each with what it is, the discount against the cap, the least the swap accepts, the lots it draws from and the
 * route through the allowlisted pool. The sell itself re-checks all of it onchain.
 */

function Row({ term, children, note }: { term: string; children: ReactNode; note?: ReactNode }): JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-0.5 px-4 py-3 sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)]">
      <dt className="text-body-s text-ink-secondary">{term}</dt>
      <dd className="min-w-0 text-body-s text-ink sm:text-right">
        <div className="break-words">{children}</div>
        {note === undefined ? null : <div className="mt-0.5 text-ink-muted">{note}</div>}
      </dd>
    </div>
  );
}

export interface QuoteDetailsProps {
  quote: SellQuote;
  tickerId: TickerId;
  symbol: string;
  /** The heading takes focus when a quote replaces the control the owner just used. */
  headingRef: (node: HTMLElement | null) => void;
  /** Words for the price row while the sell waits: the price is the last one, not a live one. */
  waiting: boolean;
  /** The owner is still typing a new amount: this quote is for the last one. */
  stale?: boolean;
}

export function QuoteDetails({ quote, tickerId, symbol, headingRef, waiting, stale = false }: QuoteDetailsProps): JSX.Element {
  const { request } = quote;
  const widened = request.overrideCapBps > 0;
  const within = quote.discountBps <= BigInt(quote.capBps);
  const pool = poolFacts(tickerId, quote.pool);
  const token = tickerTokenKey(tickerId);
  return (
    <section
      aria-labelledby="sell-quote-title"
      aria-busy={stale || undefined}
      className={cx('min-w-0 overflow-hidden rounded-module border border-border bg-surface transition-opacity duration-fast', stale && 'opacity-60')}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-4 pb-3 pt-4">
        <h3 id="sell-quote-title" ref={headingRef} tabIndex={-1} className="text-body-s font-semibold text-ink">
          {waiting ? 'Quote at the last price' : 'Your quote'}
        </h3>
        <span className="text-body-s tabular-nums text-ink-secondary">{quotePriceLine(quote, symbol)}</span>
      </div>
      <dl className="divide-y divide-border border-t border-border">
        <Row term="Pool price" note="All in, from the pool. Every pool fee is in it.">
          <span className="tabular-nums">{formatUsdg(quote.quote)}</span> USDG per {symbol}
        </Row>
        <Row term="Market reference" note={`Chainlink price from ${formatUtc(quote.feed.updatedAt)}`}>
          <span className="tabular-nums">{formatFeedPrice(quote.feed.answer)}</span> USD per {symbol}
        </Row>
        <Row
          term="Against the reference"
          note={
            <span className={cx('inline-flex items-center gap-1', within ? 'text-success' : 'text-danger')}>
              <Icon name={within ? 'check' : 'alert'} className="size-4" />
              {within ? 'Inside' : 'More than'} {widened ? 'the cap for this sell' : "your rule's cap"}, {percentWords(quote.capBps)}
            </span>
          }
        >
          {discountWords(quote.discountBps)}
        </Row>
        <Row term="Least you get" note="If the pool would pay less, the sell stops and nothing moves.">
          <span className="tabular-nums">{formatUsdg(quote.minOut)}</span> USDG
        </Row>
        <Row term={request.lotId === 0n ? 'Taken from, oldest first' : 'Taken from'}>
          <ul>
            {quote.lots.map((part) => (
              <li key={part.lotId.toString()} className="tabular-nums">
                Lot {part.lotId.toString()}: {formatStockToken(part.tokens)} {symbol}
              </li>
            ))}
          </ul>
        </Row>
        <div className="px-4 py-3">
          <dt className="text-body-s text-ink-secondary">Route</dt>
          <dd className="mt-2 min-w-0">
            <PoolRoute
              from={{ token, symbol }}
              to={{ token: 'USDG', symbol: 'USDG' }}
              venue="Uniswap v3"
              fee={pool.fee}
              allowlisted={pool.allowlisted}
            />
            <p className="mt-2 text-body-s text-ink-muted">
              {pool.allowlisted
                ? `One hop through the ${symbol} pool on Sleeve's allowlist${pool.fee === null ? '' : `, ${feeTierWords(pool.fee)} fee tier`}.`
                : `This pool is not on the ${symbol} allowlist.`}
            </p>
          </dd>
        </div>
        <Row term="The USDG goes to">Spend. Sleeve never splits it.</Row>
      </dl>
    </section>
  );
}
