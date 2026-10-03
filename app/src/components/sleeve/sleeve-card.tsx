import { formatStockToken, formatUsdg } from '@sleeve/core';
import type { JSX } from 'react';

import { Amount } from '@/components/ui/amount';
import { cx } from '@/components/ui/cx';
import { DebtSecurityLine } from '@/components/ui/debt-security-line';
import { formatUtc } from '@/components/ui/format-time';
import type { Holding } from '@/data/types';

import { TickerIcon } from '@/components/token/ticker-icon';
import { TokenIcon } from '@/components/token/token-icon';

import { tickerSymbol, usdgText } from './text';

/**
 * The two sleeves (PRD 6 and 15): spend is USDG the owner can use now, Stock Tokens are what the equity share
 * bought, held in the owner's own account. Waiting equity is USDG too, shown with the tokens it is meant to buy.
 */

export type SleeveCardProps =
  | {
      kind: 'spend';
      /** The spend ledger (LedgerView.spend). */
      spend: bigint;
      /** USDG that arrived and is not split yet (LedgerView.unsorted). Also spendable. */
      unsorted: bigint;
      className?: string;
    }
  | {
      kind: 'equity';
      /** getHoldings, ascending ticker id. */
      holdings: readonly Holding[];
      /** USDG waiting to buy, all tickers (LedgerView.pendingTotal). */
      pending: bigint;
      className?: string;
    };

function SleeveTitle({ kind }: { kind: 'spend' | 'equity' }): JSX.Element {
  return (
    <h2 className="flex items-center gap-2 text-h3 text-ink">
      <span aria-hidden="true" className={cx('size-2.5 shrink-0 rounded-pill', kind === 'spend' ? 'bg-spend' : 'bg-equity')} />
      {kind === 'spend' ? 'Spend' : 'Stock Tokens'}
    </h2>
  );
}

export function SleeveCard(props: SleeveCardProps): JSX.Element {
  if (props.kind === 'spend') {
    return (
      <section className={cx('min-w-0 rounded-module border border-border bg-spend-soft p-card', props.className)}>
        <SleeveTitle kind="spend" />
        <p className="mt-3 flex items-center gap-2.5 text-figure-m">
          <TokenIcon token="USDG" size="lg" decorative className="shrink-0" />
          <Amount value={formatUsdg(props.spend)} unit="USDG" kind="spend" />
        </p>
        <p className="mt-1 text-body-s text-ink-secondary">Spendable now.</p>
        {props.unsorted > 0n ? (
          <p className="mt-2 text-body-s text-ink-muted">
            Another {usdgText(props.unsorted)} arrived and is not sorted yet. It is spendable too.
          </p>
        ) : null}
      </section>
    );
  }

  const holdings = props.holdings.filter((holding) => holding.balance > 0n);
  return (
    <section className={cx('min-w-0 rounded-module border border-border bg-surface p-card', props.className)}>
      <SleeveTitle kind="equity" />
      {holdings.length === 0 ? (
        <p className="mt-3 text-body-s text-ink-secondary">
          No Stock Tokens yet. Your equity share buys them as payments arrive.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {holdings.map((holding) => {
            const symbol = tickerSymbol(holding.tickerId);
            return (
              <li key={holding.tickerId} className="flex gap-3 py-2.5 first:pt-0 last:pb-0">
                <TickerIcon tickerId={holding.tickerId} size="lg" className="mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-figure-s">
                    <Amount value={formatStockToken(holding.balance)} unit={symbol} kind="equity" />
                  </p>
                  <DebtSecurityLine className="mt-0.5" />
                  <p className="mt-1 text-body-s text-ink-muted">
                    Valued at <Amount value={formatUsdg(holding.value)} unit="USDG" className="text-ink-secondary" /> by
                    the Chainlink price from {formatUtc(holding.feed.updatedAt)}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {props.pending > 0n ? (
        <p className="mt-3 flex items-start gap-2 rounded-row bg-waiting-soft px-3 py-2 text-body-s text-ink">
          <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-pill bg-waiting" />
          <span>
            <span className="font-semibold text-waiting">{usdgText(props.pending)}</span> waiting to buy, held as USDG in your account.
          </span>
        </p>
      ) : null}
    </section>
  );
}
