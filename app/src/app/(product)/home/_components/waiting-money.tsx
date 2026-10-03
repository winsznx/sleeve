'use client';

import { formatUsdg, type Rule, type TickerId } from '@sleeve/core';
import Link from 'next/link';
import { useId, useState, type JSX } from 'react';

import { useMarketSession } from '@/components/shell/use-market-session';
import { LONG_WAIT_SECONDS } from '@/components/sleeve/bucket-waiting-card';
import { reasonSentence, tickerSymbol, usdgText } from '@/components/sleeve/text';
import { tickerTokenKey } from '@/components/token/ticker-icon';
import { TokenIcon } from '@/components/token/token-icon';
import { TokenPair } from '@/components/token/token-stack';
import { Amount } from '@/components/ui/amount';
import { ReasonTag } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Banner, ErrorBlock } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { formatDuration, formatUtc } from '@/components/ui/format-time';
import { useToast } from '@/components/ui/toast';
import { useRelease } from '@/data/hooks';
import type { BucketView, SplitPreview } from '@/data/types';

import { SortCard } from '../../payments/_components/sort-card';
import { failureText } from '../_lib/sentences';

/** The open of the market a share waits on, ticking: "in 1d 6h", then the time in New York. */
function Countdown({ tickerId }: { tickerId: TickerId }): JSX.Element | null {
  const read = useMarketSession(tickerId);
  if (read.status !== 'ready' || read.view.state !== 'closed' || read.words.remaining === null) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-row bg-waiting-soft px-3 py-2.5">
      <span className="text-body-s text-ink-secondary">Buys when the market opens, in</span>
      <span className="text-figure-s tabular-nums text-ink" aria-label={read.words.sentence}>
        {read.words.remaining}
      </span>
      {read.words.when === null ? null : <span className="text-body-s text-ink-secondary">{read.words.when} New York time</span>}
    </div>
  );
}

interface WaitingBucketProps {
  bucket: BucketView;
  /** Chain time now (LedgerView.asOf.timestamp), never the device clock. */
  now: bigint;
  rule: Rule;
  onRelease: () => void;
  releasing: boolean;
}

/** One bucket waiting to buy (PRD 15, Waiting): how much, why, until when, since when, and the release. */
function WaitingBucket({ bucket, now, rule, onRelease, releasing }: WaitingBucketProps): JSX.Element {
  const headingId = useId();
  const symbol = tickerSymbol(bucket.tickerId);
  const token = tickerTokenKey(bucket.tickerId);
  const waited = now > bucket.since ? now - bucket.since : 0n;
  const longWait = waited >= LONG_WAIT_SECONDS;
  return (
    <article aria-labelledby={headingId} className="relative min-w-0 overflow-hidden rounded-module border border-border bg-surface p-card pt-6">
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1.5 bg-waiting-stripes" />
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <h3 id={headingId} className="flex min-w-0 items-center gap-3 text-body font-semibold text-ink">
          {token === null ? <TokenIcon token="USDG" size="lg" decorative /> : <TokenPair from="USDG" to={token} size="lg" decorative />}
          <span>
            <Amount value={formatUsdg(bucket.amount)} unit="USDG" kind="waiting" className="text-figure-s" />
            <span className="block text-body-s font-medium text-ink-secondary">waiting to buy {symbol}</span>
          </span>
        </h3>
        <ReasonTag reason={bucket.reason} />
      </div>
      <p className="mt-3 text-body-s text-ink">
        {bucket.reason === 'SESSION'
          ? `The market is closed, so it waits as USDG and buys ${symbol} after the open.`
          : reasonSentence(bucket.reason, { symbol, minClip: rule.minClip, premiumCapBps: rule.premiumCapBps })}
      </p>
      {bucket.reason === 'SESSION' ? (
        <div className="mt-3">
          <Countdown tickerId={bucket.tickerId} />
        </div>
      ) : null}
      <p className="mt-3 text-body-s text-ink-secondary">
        Waiting for {formatDuration(waited)}, since {formatUtc(bucket.since)}. It stays in your account as USDG, and you can
        release it to spend at any time.
      </p>
      {longWait ? (
        <Banner title={`Waiting for ${formatDuration(waited)}`} className="mt-3">
          You can raise your cap, switch ticker, or release it to spend.{' '}
          <Link href="/rule" className="font-medium text-link underline underline-offset-4 hover:text-link-hover">
            Edit your rule
          </Link>
        </Banner>
      ) : null}
      <div className="mt-4">
        <Button variant="secondary" size="sm" onClick={onRelease} busy={releasing} busyLabel="Releasing">
          Release to spend
        </Button>
      </div>
    </article>
  );
}

export interface WaitingMoneyProps {
  /** previewSplit for the account, for USDG not sorted yet. */
  preview: SplitPreview;
  /** Inbound transfers not sorted yet. */
  unsortedPayments: number;
  rule: Rule;
  /** Non-empty buckets, ascending ticker id. */
  buckets: readonly BucketView[];
  /** Chain time (LedgerView.asOf.timestamp). */
  now: bigint;
  /** For reopen times in the sort forecast. */
  reopensAt: (tickerId: TickerId) => bigint | null | undefined;
}

/**
 * Money that is still USDG in the account and waiting (PRD 15, Waiting): what arrived and is not sorted, with the way
 * to sort it now, then each bucket waiting to buy, with the reason, the countdown to the open and a release that asks
 * before it moves anything. Renders nothing when nothing waits.
 */
export function WaitingMoney({ preview, unsortedPayments, rule, buckets, now, reopensAt }: WaitingMoneyProps): JSX.Element | null {
  const headingId = useId();
  const toast = useToast();
  const release = useRelease();
  // The bucket the dialog asks about stays set after it closes, so the sheet keeps its words while it leaves.
  const [target, setTarget] = useState<BucketView | null>(null);
  const [confirming, setConfirming] = useState(false);

  if (preview.unsorted === 0n && buckets.length === 0) return null;
  const shown = target === null ? null : (buckets.find((bucket) => bucket.tickerId === target.tickerId) ?? target);

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
          body: `It stays in your account as USDG. #${id} records the move.`,
          action: { label: `Open #${id}`, href: `/receipts/${id}` },
        });
      },
    });
  }

  return (
    <section id="waiting" aria-labelledby={headingId} className="min-w-0 scroll-mt-24">
      <h2 id={headingId} className="text-h2 text-ink">
        Waiting
      </h2>
      <p className="mt-1 text-body-s text-ink-secondary">Money still held as USDG in your account, and why.</p>
      <div className="mt-3 flex flex-col gap-stack">
        {preview.unsorted > 0n ? (
          <SortCard preview={preview} rule={rule} payments={unsortedPayments} reopensAt={reopensAt(preview.tickerId)} headingLevel={3} />
        ) : null}
        {buckets.map((bucket) => (
          <WaitingBucket
            key={bucket.tickerId}
            bucket={bucket}
            now={now}
            rule={rule}
            onRelease={() => askToRelease(bucket)}
            releasing={release.isPending && release.variables === bucket.tickerId}
          />
        ))}
      </div>
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
    </section>
  );
}
