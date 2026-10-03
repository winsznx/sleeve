'use client';

import { formatStockToken, formatUsdg, tickerById, type TickerId } from '@sleeve/core';
import type { JSX } from 'react';

import { tickerSymbol, tokenText } from '@/components/sleeve/text';
import { TickerIcon } from '@/components/token/ticker-icon';
import { Amount } from '@/components/ui/amount';
import { cx } from '@/components/ui/cx';
import { DebtSecurityLine } from '@/components/ui/debt-security-line';
import { Dialog } from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icons';
import type { Holding } from '@/data/types';

import { sellableTokens } from '../sell-text';

/**
 * Choosing what to sell, as a swap's token list: each Stock Token the account can sell through Sleeve, with its
 * icon, the amount its lots hold, the debt security line and its value at the Chainlink reference. Tokens that
 * arrived outside Sleeve are listed apart, because Sleeve cannot sell them in M0 (D-009 Q30).
 */

export interface TokenPickerProps {
  open: boolean;
  onClose: () => void;
  holdings: readonly Holding[];
  current: TickerId;
  onChoose: (tickerId: TickerId) => void;
}

function lotCount(holding: Holding): string {
  const lots = holding.lots.length;
  return lots === 1 ? '1 lot' : `${lots} lots`;
}

export function TokenPicker({ open, onClose, holdings, current, onChoose }: TokenPickerProps): JSX.Element {
  const sellable = holdings.filter((holding) => sellableTokens(holding) > 0n);
  const outsideOnly = holdings.filter((holding) => sellableTokens(holding) === 0n && holding.balance > 0n);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Choose a Stock Token"
      description="Sleeve sells from the lots your rule bought, oldest first."
    >
      <ul aria-label="Stock Tokens you can sell" className="-mx-2 flex flex-col gap-1">
        {sellable.map((holding) => {
          const symbol = tickerSymbol(holding.tickerId);
          const chosen = holding.tickerId === current;
          return (
            <li key={holding.tickerId}>
              <button
                type="button"
                aria-pressed={chosen}
                onClick={() => onChoose(holding.tickerId)}
                className={cx(
                  'flex w-full items-start gap-3 rounded-row px-2 py-3 text-left transition-colors duration-fast ease-standard hover:bg-surface-muted',
                  chosen && 'bg-surface-muted',
                )}
              >
                <TickerIcon tickerId={holding.tickerId} size="lg" className="mt-0.5" />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="text-body font-semibold text-ink">{symbol}</span>
                    <Amount value={formatStockToken(sellableTokens(holding))} unit={symbol} className="text-body font-medium text-ink" />
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-baseline justify-between gap-x-3 text-body-s text-ink-muted">
                    <span className="min-w-0">{tickerById(holding.tickerId)?.name ?? symbol}</span>
                    <span className="tabular-nums">
                      {formatUsdg(holding.value)} USDG, {lotCount(holding)}
                    </span>
                  </span>
                  <DebtSecurityLine className="mt-1" />
                </span>
                <span aria-hidden="true" className={cx('mt-2 shrink-0 text-ink', chosen ? 'visible' : 'invisible')}>
                  <Icon name="check" />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {outsideOnly.length === 0 ? null : (
        <div className="mt-4 border-t border-border pt-4">
          {outsideOnly.map((holding) => (
            <p key={holding.tickerId} className="flex items-center gap-2.5 text-body-s text-ink-secondary">
              <TickerIcon tickerId={holding.tickerId} size="sm" />
              {tokenText(holding.balance, tickerSymbol(holding.tickerId))} arrived outside Sleeve and cannot be sold here.
            </p>
          ))}
        </div>
      )}
      <p className="mt-4 text-body-s text-ink-muted">Values are at the Chainlink reference, not the pool price.</p>
    </Dialog>
  );
}
