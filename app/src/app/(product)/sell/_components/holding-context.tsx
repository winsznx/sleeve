import { formatFeedPrice, formatStockToken, formatUsdg, tickerById } from '@sleeve/core';
import type { JSX } from 'react';

import { LotList } from '@/app/(product)/holdings/_components/lot-list';
import { tickerSymbol, tokenText } from '@/components/sleeve/text';
import { TickerIcon } from '@/components/token/ticker-icon';
import { Amount } from '@/components/ui/amount';
import { DebtSecurityLine } from '@/components/ui/debt-security-line';
import { formatUtc } from '@/components/ui/format-time';
import { Icon } from '@/components/ui/icons';
import type { Holding, TickerMarket } from '@/data/types';

import { marketState, sellableTokens, tokensOutsideLots } from '../sell-text';

/**
 * The token being sold, beside the swap card: its live market state, what its lots hold with the debt security
 * line, its value at the Chainlink reference with that price's time, and each lot with when and at what all-in
 * price it was bought. Lots open the details of the buy that opened them.
 */

export interface HoldingContextProps {
  holding: Holding;
  market: TickerMarket | undefined;
}

export function HoldingContext({ holding, market }: HoldingContextProps): JSX.Element {
  const symbol = tickerSymbol(holding.tickerId);
  const name = tickerById(holding.tickerId)?.name;
  const state = marketState(market);
  const outside = tokensOutsideLots(holding);
  return (
    <section aria-labelledby="sell-holding-title" className="min-w-0 rounded-module border border-border bg-surface p-card md:p-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <TickerIcon tickerId={holding.tickerId} size="xl" />
        <div className="min-w-0 flex-1">
          <h2 id="sell-holding-title" className="text-h3 text-ink">
            Your {symbol}
          </h2>
          {name === undefined ? null : <p className="text-body-s text-ink-muted">{name}</p>}
        </div>
      </div>
      {state === null ? null : (
        <p className="mt-3 flex items-start gap-2 text-body-s text-ink-secondary">
          <Icon name="clock" className="mt-px size-4 text-ink-muted" />
          <span>
            <span className="font-medium text-ink">{state.label}.</span>
            {state.detail === null ? null : ` ${state.detail}.`}
          </span>
        </p>
      )}

      <dl className="mt-5 grid gap-x-6 gap-y-4 border-t border-border pt-5 sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-body-s text-ink-secondary">In your lots</dt>
          <dd className="mt-0.5 text-figure-s text-ink">
            <Amount value={formatStockToken(sellableTokens(holding))} unit={symbol} kind="equity" />
          </dd>
          <dd>
            <DebtSecurityLine className="mt-0.5" />
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-body-s text-ink-secondary">At the market reference</dt>
          <dd className="mt-0.5 text-figure-s text-ink">
            <Amount value={formatUsdg(holding.value)} unit="USDG" />
          </dd>
          <dd className="mt-0.5 text-body-s text-ink-muted">
            Chainlink, {formatFeedPrice(holding.feed.answer)} USD per {symbol}, from {formatUtc(holding.feed.updatedAt)}
          </dd>
        </div>
      </dl>

      <LotList lots={holding.lots} symbol={symbol} className="mt-6" />
      {outside > 0n ? (
        <p className="mt-3 text-body-s text-ink-secondary">{tokenText(outside, symbol)} arrived outside Sleeve and cannot be sold here.</p>
      ) : null}
    </section>
  );
}
