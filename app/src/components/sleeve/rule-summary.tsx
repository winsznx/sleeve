import { TOTAL_BPS, formatBps, type Rule } from '@sleeve/core';
import type { JSX } from 'react';

import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { DefinitionList } from '@/components/ui/list';

import { SplitRail } from './split-rail';
import { percentWords, tickerSymbol, usdgText } from './text';

/** PRD 7.4: in session the feed can trail the live price by up to about 0.5 percent, so the cap gains that much. */
const FEED_TRAIL_BPS = 50;

function percent(bps: number): string {
  return formatBps(bps, { minFractionDigits: 2 });
}

export interface RuleSummaryProps {
  rule: Rule;
  /** The rule editor. Adds an "Edit rule" or "Set your rule" button. */
  editHref?: string;
  className?: string;
}

/**
 * The owner's rule as it stands (PRD 7.3): the split of every payment, the ticker, the premium cap with the worst
 * case against the live price next to it (PRD 7.4), the slippage cap, the minimum buy, status and version.
 */
export function RuleSummary({ rule, editHref, className }: RuleSummaryProps): JSX.Element {
  const frame = cx('min-w-0 rounded-module border border-border bg-surface p-card', className);

  if (rule.status === 'NONE') {
    return (
      <section className={frame}>
        <h2 className="text-h3 text-ink">No rule yet</h2>
        <p className="mt-1 text-body-s text-ink-secondary">
          Nothing is split until you set a rule. USDG that arrives stays spendable in your account.
        </p>
        {editHref === undefined ? null : (
          <ButtonLink href={editHref} size="sm" className="mt-4">
            Set your rule
          </ButtonLink>
        )}
      </section>
    );
  }

  const symbol = tickerSymbol(rule.tickerId);
  const spendBps = TOTAL_BPS - rule.equityBps;
  const paused = rule.status === 'PAUSED';

  return (
    <section className={frame}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 className="text-h3 text-ink">Your rule</h2>
        <div className="flex items-center gap-2">
          <Badge tone={paused ? 'waiting' : 'success'}>{paused ? 'Paused' : 'Active'}</Badge>
          <span className="text-body-s text-ink-muted">Version {rule.version}</span>
        </div>
      </div>

      <p className="mt-3 text-body text-ink">
        Every payment: {formatBps(spendBps)} stays spendable and {formatBps(rule.equityBps)} buys {symbol}.
      </p>
      <SplitRail parts={{ spend: BigInt(spendBps), equity: BigInt(rule.equityBps), waiting: 0n }} className="mt-3" />
      {paused ? (
        <p className="mt-3 text-body-s text-ink-secondary">
          Paused. New USDG stays unsorted and spendable, and is split by this rule when you resume it.
        </p>
      ) : null}

      <DefinitionList
        className="mt-4 border-t border-border"
        items={[
          { id: 'spend', term: 'Spend share', value: formatBps(spendBps) },
          { id: 'equity', term: 'Equity share', value: `${formatBps(rule.equityBps)} to ${symbol}` },
          {
            id: 'premium',
            term: 'Premium cap',
            value: (
              <>
                {percent(rule.premiumCapBps)} above the market reference
                <span className="mt-0.5 block text-ink-secondary">
                  The reference can trail the live price by up to about 0.5 percent, so the most a buy could pay above
                  the live price is about {percentWords(rule.premiumCapBps + FEED_TRAIL_BPS)}.
                </span>
              </>
            ),
          },
          { id: 'slippage', term: 'Slippage cap', value: `${percent(rule.slippageBps)} from the quote` },
          { id: 'clip', term: 'Minimum buy', value: usdgText(rule.minClip) },
        ]}
      />

      {editHref === undefined ? null : (
        <ButtonLink href={editHref} variant="secondary" size="sm" className="mt-4">
          Edit rule
        </ButtonLink>
      )}
    </section>
  );
}
