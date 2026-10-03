'use client';

import { formatUsdg, type Rule } from '@sleeve/core';
import { useId, type JSX } from 'react';

import { SplitRail } from '@/components/sleeve/split-rail';
import { tickerSymbol } from '@/components/sleeve/text';
import { tickerTokenKey } from '@/components/token/ticker-icon';
import { TokenIcon } from '@/components/token/token-icon';
import { TokenPair } from '@/components/token/token-stack';
import { Amount } from '@/components/ui/amount';
import { Button, ButtonLink } from '@/components/ui/button';
import { ErrorBlock } from '@/components/ui/card';
import { cx } from '@/components/ui/cx';
import { useToast } from '@/components/ui/toast';
import { useSplit } from '@/data/hooks';
import type { SplitPreview } from '@/data/types';

import { failureText } from '../../home/_lib/sentences';
import { forecastSort } from '../_lib/sort-preview';

function arrivedLine(payments: number): string {
  if (payments === 1) return 'From 1 payment. ';
  if (payments > 1) return `From ${payments} payments. `;
  return '';
}

export interface SortCardProps {
  /** previewSplit for the account; the card shows only while it has unsorted USDG. */
  preview: SplitPreview;
  rule: Rule;
  /** Inbound transfers not sorted yet. */
  payments: number;
  /** When the rule's ticker reopens (TickerMarket.session.nextOpenAt), for a split that would wait. */
  reopensAt: bigint | null | undefined;
  /** h2 on Payments, h3 inside Home's waiting section. */
  headingLevel?: 2 | 3;
  className?: string;
}

/**
 * Unsorted USDG and the owner's way to sort it now (PRD 9: when the keeper is down, the owner triggers from the
 * app). It says what the split would do at this moment, part by part with its token, then runs it as one owner
 * action. A toast confirms and links the details of the split; a failure says what failed and that the USDG is
 * still in the account.
 */
export function SortCard({ preview, rule, payments, reopensAt, headingLevel = 2, className }: SortCardProps): JSX.Element {
  const headingId = useId();
  const toast = useToast();
  const split = useSplit();
  const forecast = forecastSort(preview, rule, reopensAt);
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const symbol = tickerSymbol(preview.tickerId);
  const ticker = tickerTokenKey(preview.tickerId);

  function sortNow() {
    split.mutate(undefined, {
      onSuccess: (written) => {
        const last = written.at(-1);
        if (last === undefined) {
          toast.show({ tone: 'info', title: 'Nothing to sort', body: 'Every payment is already sorted.' });
          return;
        }
        const id = last.receipt.id.toString();
        toast.show({
          title: 'Sorted by your rule',
          body: `Split #${id} records what each part became.`,
          action: { label: `Open #${id}`, href: `/receipts/${id}` },
        });
      },
    });
  }

  return (
    <section aria-labelledby={headingId} className={cx('min-w-0 rounded-module border border-border bg-surface p-card', className)}>
      <div className="flex items-start gap-3">
        <TokenIcon token="USDG" size="lg" decorative />
        <div className="min-w-0">
          <Heading id={headingId} className="text-h3 text-ink">
            <Amount value={formatUsdg(preview.unsorted, { maxFractionDigits: 6 })} unit="USDG" /> not sorted yet
          </Heading>
          <p className="mt-0.5 text-body-s text-ink-secondary">{arrivedLine(payments)}It is spendable in your account now.</p>
        </div>
      </div>

      {preview.ruleStatus === 'ACTIVE' ? (
        <>
          {forecast === null ? null : (
            <div className="mt-4 rounded-row bg-surface-muted p-4">
              <SplitRail parts={forecast.parts} />
              <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                {forecast.legend.map((item) => (
                  <li key={item.kind} className="flex min-w-0 items-center gap-2.5">
                    {item.kind === 'spend' || ticker === null ? (
                      <TokenIcon token="USDG" size="md" cutout="muted" decorative />
                    ) : (
                      <TokenPair from="USDG" to={ticker} size="md" surface="muted" decorative />
                    )}
                    <span className="min-w-0">
                      <Amount
                        value={formatUsdg(item.amount, { maxFractionDigits: 6 })}
                        unit="USDG"
                        kind={item.kind}
                        className="block text-body font-semibold"
                      />
                      <span className="block text-body-s text-ink-secondary">
                        {item.kind === 'spend' ? 'stays spendable' : item.kind === 'equity' ? `buys ${symbol}` : item.label}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 max-w-reading text-body-s text-ink">{forecast.sentence}</p>
            </div>
          )}
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button onClick={sortNow} busy={split.isPending} busyLabel="Sorting" icon="split" className="w-full shrink-0 whitespace-nowrap sm:w-auto">
              Sort now
            </Button>
            <p className="text-body-s text-ink-muted">
              Sleeve&apos;s keeper sorts new USDG by your rule. Sorting now does the same without waiting for it.
            </p>
          </div>
          {split.isError ? (
            <ErrorBlock title="The sort did not go through" fundsStillHere className="mt-4">
              {failureText(split.error, 'sort')}
            </ErrorBlock>
          ) : null}
        </>
      ) : (
        <div className="mt-4 flex flex-col items-start gap-3">
          <p className="max-w-reading text-body-s text-ink">
            {preview.ruleStatus === 'PAUSED'
              ? 'Your rule is paused, so this stays unsorted and spendable until you resume it.'
              : 'You have no rule yet, so this stays unsorted and spendable until you set one.'}
          </p>
          <ButtonLink href="/rule" variant="secondary" size="sm" icon="rule">
            {preview.ruleStatus === 'PAUSED' ? 'Go to your rule' : 'Set your rule'}
          </ButtonLink>
        </div>
      )}
    </section>
  );
}
