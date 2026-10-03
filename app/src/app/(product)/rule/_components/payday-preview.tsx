'use client';

import { formatUsdg, type RuleInput } from '@sleeve/core';
import { useId, type JSX } from 'react';

import { EXAMPLE_PAYDAY } from '@/components/shell/payday-card';
import { previewPayday } from '@/components/shell/payday-preview';
import { equityLine, verdictSentence } from '@/components/shell/payday-words';
import { useMarketSession } from '@/components/shell/use-market-session';
import { SplitRail } from '@/components/sleeve/split-rail';
import { tickerSymbol } from '@/components/sleeve/text';
import { tickerTokenKey } from '@/components/token/ticker-icon';
import { TokenIcon } from '@/components/token/token-icon';
import { TokenPair } from '@/components/token/token-stack';
import { Amount } from '@/components/ui/amount';
import { cx } from '@/components/ui/cx';
import { DebtSecurityLine } from '@/components/ui/debt-security-line';
import { Skeleton } from '@/components/ui/skeleton';

import type { RuleChange } from '../_lib/rule-draft';

export interface PaydayPreviewProps {
  /** The draft as setRule would take it, or the last valid one while the minimum buy is being typed. */
  input: RuleInput;
  /** What saving would change against the rule as it stands. Left out in onboarding, where nothing stands yet. */
  changes?: readonly RuleChange[];
  className?: string;
}

/**
 * The draft rule on an example payday (PRD 8.1: 500 USDG in, 450 stays spendable, 50 goes to the Stock Token), live:
 * the split rail, each part with its token, and what the equity share would do if the payment arrived right now,
 * from the market snapshot. A share that would buy carries the debt security line under it.
 */
export function PaydayPreview({ input, changes, className }: PaydayPreviewProps): JSX.Element {
  const titleId = useId();
  const read = useMarketSession(input.tickerId);
  const symbol = tickerSymbol(input.tickerId);
  const token = tickerTokenKey(input.tickerId);
  const example = `${formatUsdg(EXAMPLE_PAYDAY, { minFractionDigits: 0, maxFractionDigits: 0 })} USDG`;

  const preview = read.status === 'ready' ? previewPayday(EXAMPLE_PAYDAY, input, read.market, read.snapshot.usdgUsd, read.view, read.now) : null;
  const outcome = preview?.outcome ?? null;
  const buys = outcome?.kind === 'buys';
  const refused = outcome?.kind === 'refused';
  const spend = preview === null ? EXAMPLE_PAYDAY - (EXAMPLE_PAYDAY * BigInt(input.equityBps)) / 10_000n : preview.spend;
  const equity = EXAMPLE_PAYDAY - spend;
  const parts = {
    spend: spend + (refused ? equity : 0n),
    equity: buys || outcome === null ? equity : 0n,
    waiting: outcome?.kind === 'waits' ? equity : 0n,
  };

  return (
    <section aria-labelledby={titleId} className={cx('min-w-0 rounded-module border border-border bg-surface p-card shadow-card', className)}>
      <h2 id={titleId} className="text-body-s font-semibold text-ink-secondary">
        On a {example} payday
      </h2>
      <p className="mt-2 flex items-center gap-2.5">
        <TokenIcon token="USDG" size="lg" decorative />
        <Amount value={formatUsdg(EXAMPLE_PAYDAY)} unit="USDG" className="text-figure-m text-ink" />
      </p>
      <SplitRail parts={parts} className="mt-4" />
      <ul className="mt-4 flex flex-col gap-3">
        <li className="flex items-center gap-3">
          <TokenIcon token="USDG" size="md" decorative />
          <span className="min-w-0">
            <Amount value={formatUsdg(parts.spend)} unit="USDG" className="block text-body font-semibold text-ink" />
            <span className="block text-body-s text-ink-secondary">stays spendable</span>
          </span>
        </li>
        {equity > 0n && !refused ? (
          <li className="flex items-center gap-3">
            {token === null ? <TokenIcon token="USDG" size="md" decorative /> : <TokenPair from="USDG" to={token} size="md" decorative />}
            <span className="min-w-0">
              <Amount
                value={formatUsdg(equity)}
                unit="USDG"
                kind={outcome?.kind === 'waits' ? 'waiting' : 'equity'}
                className="block text-body font-semibold"
              />
              <span className="block text-body-s text-ink-secondary">
                {outcome === null ? `goes to ${symbol}` : equityLine(outcome, symbol, input.premiumCapBps)}
              </span>
            </span>
          </li>
        ) : null}
      </ul>
      {buys ? <DebtSecurityLine className="mt-2" /> : null}
      <div className="mt-4 rounded-row bg-surface-muted p-3 text-body-s text-ink">
        {read.status === 'pending' ? (
          <Skeleton className="h-3.5 w-full" />
        ) : read.status === 'error' ? (
          'The market did not load, so this cannot say what a payment would do right now.'
        ) : (
          <>
            <span className="font-semibold">Right now: </span>
            {verdictSentence(outcome, symbol, input.premiumCapBps)}
          </>
        )}
      </div>
      {changes === undefined ? null : changes.length === 0 ? (
        <p className="mt-4 border-t border-border pt-3 text-body-s text-ink-muted">No changes yet.</p>
      ) : (
        <div className="mt-4 border-t border-border pt-3">
          <h3 className="text-body-s font-semibold text-ink">Changes</h3>
          <dl className="mt-2 flex flex-col gap-1.5 text-body-s">
            {changes.map((change) => (
              <div key={change.id} className="flex flex-wrap justify-between gap-x-3">
                <dt className="text-ink-secondary">{change.label}</dt>
                <dd className="tabular-nums text-ink">
                  {change.from} to <span className="font-semibold">{change.to}</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </section>
  );
}
