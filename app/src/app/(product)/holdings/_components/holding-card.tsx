import { formatFeedPrice, formatStockToken, formatUsdg, tickerById } from '@sleeve/core';
import type { JSX, ReactNode } from 'react';

import { Glyph } from '@/app/(product)/receipts/_components/glyphs';
import { isoTime } from '@/app/(product)/receipts/_lib/register';
import { tickerSymbol, tokenText } from '@/components/sleeve/text';
import { TickerIcon } from '@/components/token/ticker-icon';
import { Amount } from '@/components/ui/amount';
import { ButtonLink } from '@/components/ui/button';
import { DebtSecurityLine } from '@/components/ui/debt-security-line';
import { formatUtc } from '@/components/ui/format-time';
import type { Holding, TickerMarket } from '@/data/types';

import { poolGap, sellableTokens, tokensOutsideLots, underlyingName } from '../_lib/holdings';
import { LotList } from './lot-list';

/**
 * One Stock Token the account holds (PRD 7.11, docs/DESIGN.md 12.5): the balance with the debt security line
 * directly under it, its value at the Chainlink reference with that price and its time, the pool price right now on
 * its own line with its own time, the lots oldest first, and the way to sell. Tokens that arrived outside Sleeve
 * count in the balance but cannot be sold here in M0 (D-009 Q30), and the card says so.
 */

export interface HoldingCardProps {
  holding: Holding;
  /** The live market for this ticker, when it loaded. */
  market: TickerMarket | undefined;
  /** USDG waiting to buy more of this ticker, drawn under the balance (a WaitingStrip). */
  waiting?: ReactNode;
}

export function HoldingCard({ holding, market, waiting }: HoldingCardProps): JSX.Element {
  const symbol = tickerSymbol(holding.tickerId);
  const name = underlyingName(holding.tickerId);
  const titleId = `holding-${symbol}-title`;
  const sellable = sellableTokens(holding);
  const outside = tokensOutsideLots(holding);
  const pool = market?.poolPrice ?? null;
  const gap = pool === null ? null : poolGap(pool, holding.feed.answer, symbol);
  const known = tickerById(holding.tickerId) !== undefined;

  return (
    <article
      id={`holding-${symbol}`}
      aria-labelledby={titleId}
      className="flex min-w-0 scroll-mt-6 flex-col rounded-module border border-border bg-surface p-card md:p-6"
    >
      <header className="flex items-start gap-3">
        <TickerIcon tickerId={holding.tickerId} size="xl" />
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-h3 text-ink">
            {symbol}
          </h2>
          {name === null ? null : <p className="text-body-s text-ink-muted">{name}</p>}
        </div>
        {sellable > 0n && known ? (
          <ButtonLink href={`/sell?ticker=${symbol}`} variant="secondary" size="sm" icon="sell" aria-label={`Sell ${symbol}`}>
            Sell
          </ButtonLink>
        ) : null}
      </header>

      <dl className="mt-5 grid gap-x-6 gap-y-4 sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-body-s text-ink-secondary">You hold</dt>
          <dd className="mt-0.5 text-figure-m text-ink">
            <Amount value={formatStockToken(holding.balance)} unit={symbol} kind="equity" />
          </dd>
          <dd>
            <DebtSecurityLine className="mt-0.5" />
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-body-s text-ink-secondary">Value at the Chainlink reference</dt>
          <dd className="mt-0.5 text-figure-m text-ink">
            <Amount value={formatUsdg(holding.value)} unit="USDG" />
          </dd>
          <dd className="mt-0.5 text-body-s text-ink-muted">
            {formatFeedPrice(holding.feed.answer)} USD per {symbol}, published{' '}
            <time dateTime={isoTime(holding.feed.updatedAt)}>{formatUtc(holding.feed.updatedAt)}</time>
          </dd>
        </div>
      </dl>

      {waiting === undefined ? null : <div className="mt-5">{waiting}</div>}

      {gap === null || pool === null ? null : (
        <div className="mt-5 flex items-start gap-3 rounded-row border border-border bg-surface-muted p-4">
          <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-row bg-surface text-ink-secondary">
            <Glyph name="pool" />
          </span>
          <div className="min-w-0 text-body-s">
            <p className="text-ink-secondary">Pool price now</p>
            <p className="mt-0.5 font-medium tabular-nums text-ink">{gap.price}</p>
            <p className="mt-0.5 text-ink-muted">
              Quoted <time dateTime={isoTime(pool.at.timestamp)}>{formatUtc(pool.at.timestamp)}</time>. {gap.sentence}
            </p>
          </div>
        </div>
      )}

      {holding.lots.length === 0 ? null : <LotList lots={holding.lots} symbol={symbol} className="mt-5" />}

      {outside > 0n ? (
        <p className="mt-4 rounded-row border border-dashed border-border-strong bg-surface-muted p-3.5 text-body-s text-ink-secondary">
          {tokenText(outside, symbol)} arrived outside Sleeve and cannot be sold here. Sleeve sells only from the lots its
          rule bought.
        </p>
      ) : null}
    </article>
  );
}
