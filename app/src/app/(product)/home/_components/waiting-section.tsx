'use client';

import { formatUsdg, type Rule, type RuleStatus, type TickerId } from '@sleeve/core';
import Link from 'next/link';
import { useId, useState, type JSX } from 'react';

import { BucketWaitingCard } from '@/components/sleeve/bucket-waiting-card';
import { tickerSymbol, usdgText } from '@/components/sleeve/text';
import { Amount } from '@/components/ui/amount';
import { Button } from '@/components/ui/button';
import { ErrorBlock } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { useRelease } from '@/data/hooks';
import type { BucketView, MarketSnapshot } from '@/data/types';

import { failureText } from '../_lib/sentences';

const LINK =
  'inline-flex min-h-touch items-center text-body-s font-medium text-link underline underline-offset-4 hover:text-link-hover';

function arrivedLine(payments: number): string {
  if (payments === 1) return 'It arrived in 1 payment and your rule has not split it yet.';
  if (payments > 1) return `It arrived in ${payments} payments and your rule has not split it yet.`;
  return 'It arrived from outside and your rule has not split it yet.';
}

function sortingLine(status: RuleStatus): string {
  switch (status) {
    case 'ACTIVE':
      return "Sleeve's keeper sorts it by your rule. You can also sort it now from your inbox.";
    case 'PAUSED':
      return 'Your rule is paused, so it stays unsorted until you resume it.';
    case 'NONE':
      return 'You have no rule yet, so it stays unsorted until you set one.';
  }
}

interface UnsortedCardProps {
  amount: bigint;
  /** Inbound transfers not sorted yet; 0 when the inbox does not know. */
  payments: number;
  ruleStatus: RuleStatus;
}

/** USDG that arrived and is not split yet (PRD 7.2): it is spendable the whole time. */
function UnsortedCard({ amount, payments, ruleStatus }: UnsortedCardProps): JSX.Element {
  return (
    <article className="min-w-0 rounded-row border border-border bg-surface p-4">
      <h3 className="flex items-center gap-2 text-body font-semibold text-ink">
        <span aria-hidden="true" className="size-2.5 shrink-0 rounded-pill bg-spend" />
        <span>
          <Amount value={formatUsdg(amount)} unit="USDG" /> waiting to be sorted
        </span>
      </h3>
      <p className="mt-2 text-body-s text-ink">It is spendable now. {arrivedLine(payments)}</p>
      <p className="mt-1 text-body-s text-ink-secondary">{sortingLine(ruleStatus)}</p>
      <Link href="/inbox" className={`${LINK} mt-1`}>
        Open inbox
      </Link>
    </article>
  );
}

export interface WaitingSectionProps {
  /** LedgerView.unsorted. */
  unsorted: bigint;
  /** How many inbound transfers are not sorted yet. */
  unsortedPayments: number;
  rule: Rule;
  /** Non-empty buckets, ascending ticker id. */
  buckets: readonly BucketView[];
  /** Chain time (LedgerView.asOf.timestamp), never the device clock. */
  now: bigint;
  /** For reopen times. Missing when the market snapshot did not load; the cards then leave the time out. */
  market: MarketSnapshot | undefined;
}

/**
 * Money that is still USDG in the account and waiting (PRD 15, Waiting): first what arrived and is not sorted,
 * then each bucket waiting to buy, with the reason in plain words and a release that asks before it moves
 * anything. A toast confirms a release and links its receipt.
 */
export function WaitingSection({ unsorted, unsortedPayments, rule, buckets, now, market }: WaitingSectionProps): JSX.Element {
  const headingId = useId();
  const toast = useToast();
  const release = useRelease();
  // The bucket the dialog asks about stays set after it closes, so the sheet keeps its words while it leaves.
  const [target, setTarget] = useState<BucketView | null>(null);
  const [confirming, setConfirming] = useState(false);

  const shown = target === null ? null : (buckets.find((bucket) => bucket.tickerId === target.tickerId) ?? target);
  const hasWaiting = unsorted > 0n || buckets.length > 0;

  function reopensAt(tickerId: TickerId): bigint | null | undefined {
    return market?.tickers.find((ticker) => ticker.tickerId === tickerId)?.session.nextOpenAt;
  }

  function askToRelease(bucket: BucketView) {
    release.reset();
    setTarget(bucket);
    setConfirming(true);
  }

  function closeDialog() {
    if (!release.isPending) setConfirming(false);
  }

  function confirmRelease(tickerId: TickerId) {
    release.mutate(tickerId, {
      onSuccess: (record) => {
        setConfirming(false);
        const id = record.receipt.id.toString();
        toast.show({
          title: `Released ${usdgText(record.receipt.usdgIn)} to spend`,
          body: `It stays in your account as USDG. Receipt ${id} records the move.`,
          action: { label: `Open receipt ${id}`, href: `/receipts/${id}` },
        });
      },
    });
  }

  return (
    <>
      {hasWaiting ? (
        <section aria-labelledby={headingId}>
          <h2 id={headingId} className="text-h2 text-ink">
            Waiting
          </h2>
          <div className="mt-3 flex flex-col gap-2.5">
            {unsorted > 0n ? <UnsortedCard amount={unsorted} payments={unsortedPayments} ruleStatus={rule.status} /> : null}
            {buckets.map((bucket) => (
              <BucketWaitingCard
                key={bucket.tickerId}
                bucket={bucket}
                now={now}
                reopensAt={reopensAt(bucket.tickerId)}
                rule={rule.status === 'NONE' ? undefined : rule}
                onRelease={() => askToRelease(bucket)}
                releasing={release.isPending && release.variables === bucket.tickerId}
                ruleHref="/rule"
              />
            ))}
          </div>
        </section>
      ) : null}
      {shown === null ? null : (
        <Dialog
          open={confirming}
          onClose={closeDialog}
          title={`Release ${usdgText(shown.amount)} to spend?`}
          description={`It stops waiting to buy ${tickerSymbol(shown.tickerId)} and moves to spend. It stays in your account as USDG.`}
          actions={
            <>
              <Button variant="secondary" onClick={closeDialog} disabled={release.isPending}>
                Keep waiting
              </Button>
              <Button onClick={() => confirmRelease(shown.tickerId)} busy={release.isPending} busyLabel="Releasing">
                Release to spend
              </Button>
            </>
          }
        >
          {release.isError ? (
            <ErrorBlock title="The release did not go through" fundsStillHere>
              {failureText(release.error, 'release')}
            </ErrorBlock>
          ) : undefined}
        </Dialog>
      )}
    </>
  );
}
