import { formatStockToken, formatUsdg, tickerById } from '@sleeve/core';
import type { JSX } from 'react';

import { TickerIcon } from '@/components/token/ticker-icon';
import { Amount } from '@/components/ui/amount';
import { DebtSecurityLine } from '@/components/ui/debt-security-line';
import { formatUtc } from '@/components/ui/format-time';
import { ListRow } from '@/components/ui/list';
import type { Holding } from '@/data/types';

import { tickerSymbol, tokenText } from './text';

export interface HoldingRowProps {
  holding: Holding;
  /** The holding's detail page, where the sell action and the exit line live. */
  href?: string;
}

/**
 * One Stock Token holding in a ruled List: the balance with the debt security line directly under it, its value at
 * the Chainlink price on the right, then the underlying's name, the lot count and that price's time across the full
 * row. Tokens that arrived outside Sleeve count in the balance but cannot be sold through Sleeve in M0
 * (D-009 Q30), and the row says so.
 */
export function HoldingRow({ holding, href }: HoldingRowProps): JSX.Element {
  const symbol = tickerSymbol(holding.tickerId);
  const name = tickerById(holding.tickerId)?.name;
  const outside = holding.balance - holding.inLots;
  const lots = holding.lots.length;

  return (
    <ListRow
      href={href}
      leading={<TickerIcon tickerId={holding.tickerId} size="lg" />}
      title={<Amount value={formatStockToken(holding.balance)} unit={symbol} kind="equity" className="font-semibold" />}
      meta={<DebtSecurityLine />}
      trailing={<Amount value={formatUsdg(holding.value)} unit="USDG" />}
    >
      <p className="mt-2 text-body-s text-ink-muted">
        {name === undefined ? null : `${name}, `}
        in {lots} {lots === 1 ? 'lot' : 'lots'}. Valued at the Chainlink price from {formatUtc(holding.feed.updatedAt)}.
      </p>
      {outside > 0n ? (
        <p className="mt-1 text-body-s text-ink-muted">{tokenText(outside, symbol)} arrived outside Sleeve and cannot be sold here.</p>
      ) : null}
    </ListRow>
  );
}
