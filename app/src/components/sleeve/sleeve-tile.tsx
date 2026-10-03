import { formatUsdg } from '@sleeve/core';
import Link from 'next/link';
import type { JSX, ReactNode } from 'react';

import { tickerTokenKey } from '@/components/token/ticker-icon';
import type { TokenKey } from '@/components/token/registry';
import { TokenIcon } from '@/components/token/token-icon';
import { TokenStack } from '@/components/token/token-stack';
import { Amount } from '@/components/ui/amount';
import { cx } from '@/components/ui/cx';
import { DebtSecurityLine } from '@/components/ui/debt-security-line';
import { Icon } from '@/components/ui/icons';
import type { Holding } from '@/data/types';

import { tickerSymbol, usdgText } from './text';

/**
 * The two sleeves as closeout's stat tiles (PRD 6 and 15, docs/DESIGN.md 2.5): spend on the apricot surface, Stock
 * Tokens on the mint one, each with its token marks, its figure in ink, one line on what else sits beside it, and
 * the way to the page that holds the detail.
 */

const SURFACE = {
  spend: 'border-spend-border bg-spend-surface',
  equity: 'border-equity-border bg-equity-surface',
} as const;

const DIVIDER = {
  spend: 'border-spend-border',
  equity: 'border-equity-border',
} as const;

function Tile({
  kind,
  title,
  mark,
  figure,
  below,
  trend,
  href,
  linkLabel,
  className,
}: {
  kind: 'spend' | 'equity';
  title: string;
  mark: ReactNode;
  figure: ReactNode;
  below?: ReactNode;
  trend: ReactNode;
  href: string;
  linkLabel: string;
  className?: string;
}): JSX.Element {
  return (
    <section aria-label={title} className={cx('flex min-w-0 flex-col rounded-module border', SURFACE[kind], className)}>
      <div className="flex items-start gap-3 p-4">
        <span className="grid size-icon-tile shrink-0 place-items-center rounded-row bg-surface">{mark}</span>
        <div className="min-w-0">
          <h2 className={cx('flex items-center gap-2 text-body-s font-semibold', kind === 'spend' ? 'text-spend' : 'text-equity')}>
            <span aria-hidden="true" className={cx('size-2.5 shrink-0 rounded-pill', kind === 'spend' ? 'bg-spend' : 'bg-equity')} />
            {title}
          </h2>
          <p className="mt-0.5 text-figure-m tabular-nums text-ink">{figure}</p>
          {below}
        </div>
      </div>
      <div className={cx('border-t px-4 py-3 text-body-s text-ink-secondary', DIVIDER[kind])}>{trend}</div>
      <Link
        href={href}
        className={cx(
          'mt-auto flex min-h-12 items-center justify-between gap-3 border-t px-4 text-body-s font-medium text-ink transition-colors duration-fast ease-standard hover:bg-surface/60',
          DIVIDER[kind],
        )}
      >
        {linkLabel}
        <Icon name="chevronRight" className="size-4 text-ink-secondary" />
      </Link>
    </section>
  );
}

export interface SpendTileProps {
  /** The spend ledger (LedgerView.spend). */
  spend: bigint;
  /** USDG that arrived and is not split yet (LedgerView.unsorted). Also spendable. */
  unsorted: bigint;
  className?: string;
}

export function SpendTile({ spend, unsorted, className }: SpendTileProps): JSX.Element {
  return (
    <Tile
      kind="spend"
      title="Spend"
      mark={<TokenIcon token="USDG" size="md" decorative />}
      figure={<Amount value={formatUsdg(spend)} unit="USDG" />}
      trend={
        unsorted > 0n
          ? `Another ${usdgText(unsorted)} arrived and is not sorted yet. It is spendable too.`
          : 'USDG your rule kept spendable, in your own account.'
      }
      href="/payments"
      linkLabel="See payments"
      className={className}
    />
  );
}

export interface StockTokensTileProps {
  /** getHoldings, ascending ticker id. */
  holdings: readonly Holding[];
  /** USDG waiting to buy, all tickers (LedgerView.pendingTotal). */
  pending: bigint;
  className?: string;
}

export function StockTokensTile({ holdings, pending, className }: StockTokensTileProps): JSX.Element {
  const held = holdings.filter((holding) => holding.balance > 0n);
  const value = held.reduce((sum, holding) => sum + holding.value, 0n);
  const keys = held.map((holding) => tickerTokenKey(holding.tickerId)).filter((key): key is TokenKey => key !== null);
  const symbols = held.map((holding) => tickerSymbol(holding.tickerId));
  const mark =
    keys.length === 0 ? (
      <Icon name="split" className="text-equity" />
    ) : keys.length === 1 && keys[0] !== undefined ? (
      <TokenIcon token={keys[0]} size="md" decorative />
    ) : (
      <TokenStack tokens={keys} size="sm" max={3} decorative />
    );
  return (
    <Tile
      kind="equity"
      title="Stock Tokens"
      mark={mark}
      figure={held.length === 0 ? 'None yet' : <Amount value={formatUsdg(value)} unit="USDG" />}
      below={
        held.length === 0 ? null : (
          <>
            <p className="text-body-s text-ink-secondary">
              {symbols.join(' and ')}, at the Chainlink reference
            </p>
            <DebtSecurityLine className="mt-0.5" />
          </>
        )
      }
      trend={
        pending > 0n ? (
          <span className="flex items-start gap-2">
            <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-pill bg-waiting-stripes ring-1 ring-inset ring-waiting" />
            <span>
              <span className="font-semibold text-waiting">{usdgText(pending)}</span> waiting to buy, held as USDG in your account.
            </span>
          </span>
        ) : held.length === 0 ? (
          'Your equity share buys them as payments arrive.'
        ) : (
          'Held in your own account. Sell any of them back to USDG.'
        )
      }
      href="/holdings"
      linkLabel="See holdings"
      className={className}
    />
  );
}
