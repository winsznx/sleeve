'use client';

import { formatBps, formatUsdg, RULE_DEFAULTS } from '@sleeve/core';
import type { JSX } from 'react';

import { SplitRail } from '@/components/sleeve/split-rail';
import { tickerSymbol, usdgText } from '@/components/sleeve/text';
import { tickerTokenKey } from '@/components/token/ticker-icon';
import { TokenIcon } from '@/components/token/token-icon';
import { cx } from '@/components/ui/cx';
import { DebtSecurityLine } from '@/components/ui/debt-security-line';

import { previewPayday } from './payday-preview';
import { equityLine } from './payday-words';
import { SampleTag } from './sample-tag';
import { followedTicker, useMarketSession, useOwnerRule } from './use-market-session';

/** The PRD's example payday: 500 USDG in, 450 stays spendable, 50 goes to the Stock Token (PRD 8.1). */
export const EXAMPLE_PAYDAY = 500_000_000n;

const TITLE = `If ${formatUsdg(EXAMPLE_PAYDAY, { minFractionDigits: 0, maxFractionDigits: 0 })} USDG arrived now`;

/**
 * "If 500 USDG arrived now": the payday split as a live card, from the followed rule and the market snapshot. The
 * rail draws the equity share green when it would buy and in the waiting stripes when it would wait, which is the
 * whole product in one picture (D-024). A share that would buy carries the debt security line under it.
 */
export function PaydayCard({ className }: { className?: string }): JSX.Element {
  const ownerRule = useOwnerRule();
  const read = useMarketSession(followedTicker(ownerRule));
  const suggested = ownerRule === null || ownerRule.status === 'NONE';
  const rule = suggested ? RULE_DEFAULTS : ownerRule;
  const symbol = tickerSymbol(rule.tickerId);
  const icon = tickerTokenKey(rule.tickerId);

  if (read.status !== 'ready') {
    return (
      <div aria-busy={read.status === 'pending'} className={cx('rounded-module bg-surface p-4', className)}>
        <p className="text-body-s font-medium text-ink">{TITLE}</p>
        {read.status === 'error' ? (
          <p className="mt-2 text-body-s text-ink-secondary">The market did not load, so this preview cannot run.</p>
        ) : (
          <div className="mt-3 space-y-2">
            <span className="block h-3 rounded-pill bg-skeleton" />
            <span className="block h-4 w-3/4 rounded-xs bg-skeleton" />
            <span className="block h-4 w-2/3 rounded-xs bg-skeleton" />
          </div>
        )}
      </div>
    );
  }

  const preview = previewPayday(EXAMPLE_PAYDAY, rule, read.market, read.snapshot.usdgUsd, read.view, read.now);
  const buys = preview.outcome?.kind === 'buys';
  const waits = preview.outcome?.kind === 'waits';
  const parts = {
    spend: preview.spend + (preview.outcome?.kind === 'refused' ? preview.equity : 0n),
    equity: buys ? preview.equity : 0n,
    waiting: waits ? preview.equity : 0n,
  };

  return (
    <div className={cx('rounded-module bg-surface p-4 shadow-soft', className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="text-body-s font-medium text-ink">{TITLE}</p>
        <SampleTag />
      </div>
      <SplitRail parts={parts} className="mt-3" />
      <ul className="mt-3 space-y-2 text-body-s">
        <li className="flex items-start gap-2">
          <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-pill bg-spend" />
          <span className="min-w-0">
            <span className="font-semibold tabular-nums text-ink">{usdgText(preview.spend)}</span>{' '}
            <span className="text-ink-secondary">would stay spendable</span>
          </span>
        </li>
        {preview.outcome === null ? null : (
          <li className="flex items-start gap-2">
            <span
              aria-hidden="true"
              className={cx(
                'mt-1.5 size-2 shrink-0 rounded-pill',
                buys ? 'bg-equity' : waits ? 'bg-waiting-stripes ring-1 ring-inset ring-waiting' : 'bg-spend',
              )}
            />
            <div className="min-w-0">
              <p>
                <span className="font-semibold tabular-nums text-ink">{usdgText(preview.equity)}</span>{' '}
                <span className="text-ink-secondary">{equityLine(preview.outcome, symbol, rule.premiumCapBps)}</span>
              </p>
              {buys ? <DebtSecurityLine className="mt-0.5" /> : null}
            </div>
          </li>
        )}
      </ul>
      <p className="mt-3 flex items-center gap-2 border-t border-border pt-3 text-body-s text-ink-secondary">
        {icon === null ? null : <TokenIcon token={icon} size="xs" decorative />}
        <span>
          {suggested ? 'Suggested rule' : 'Your rule'}: {formatBps(rule.equityBps)} to {symbol}, cap {formatBps(rule.premiumCapBps)}
        </span>
      </p>
    </div>
  );
}
