'use client';

import type { Rule } from '@sleeve/core';
import { useId, type JSX } from 'react';

import { SplitLegend, SplitRail } from '@/components/sleeve/split-rail';
import { usdgExact } from '@/components/sleeve/text';
import { Amount } from '@/components/ui/amount';
import { Button, ButtonLink } from '@/components/ui/button';
import { ErrorBlock } from '@/components/ui/card';
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
}

/**
 * Unsorted USDG and the owner's way to sort it now (PRD 9: when the keeper is down, the owner triggers from the
 * app). It says what the split would do at this moment, then runs it as one owner action. A toast confirms and
 * links the receipt; a failure says what failed and that the USDG is still in the account.
 */
export function SortCard({ preview, rule, payments, reopensAt }: SortCardProps): JSX.Element {
  const headingId = useId();
  const toast = useToast();
  const split = useSplit();
  const forecast = forecastSort(preview, rule, reopensAt);

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
          body: `Receipt ${id} records the split.`,
          action: { label: `Open receipt ${id}`, href: `/receipts/${id}` },
        });
      },
    });
  }

  return (
    <section aria-labelledby={headingId} className="min-w-0 rounded-module border border-border bg-surface p-card">
      <h2 id={headingId} className="text-h3 text-ink">
        <Amount value={usdgExact(preview.unsorted)} unit="USDG" /> waiting to be sorted
      </h2>
      <p className="mt-1 text-body-s text-ink-secondary">
        {arrivedLine(payments)}It is spendable in your account now.
      </p>

      {preview.ruleStatus === 'ACTIVE' ? (
        <>
          {forecast === null ? null : (
            <div className="mt-4">
              <SplitRail parts={forecast.parts} />
              <SplitLegend items={forecast.legend} className="mt-3" />
              <p className="mt-3 max-w-reading text-body-s text-ink">{forecast.sentence}</p>
            </div>
          )}
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button onClick={sortNow} busy={split.isPending} busyLabel="Sorting" className="w-full sm:w-auto">
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
