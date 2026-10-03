'use client';

import { formatBps, formatStockToken, formatUsdg, isPoolAllowlisted, shortAddress, type Address, type Receipt, type Rule } from '@sleeve/core';
import Link from 'next/link';
import { useEffect, useId, useState, type JSX, type ReactNode } from 'react';

import { SampleTag } from '@/components/shell/sample-tag';
import { useMarketSession } from '@/components/shell/use-market-session';
import type { WaitEnd } from '@/components/sleeve/payment-outcome';
import { premiumSentence } from '@/components/sleeve/premium-line';
import { SplitRail, splitPartsOf } from '@/components/sleeve/split-rail';
import { reasonSentence, tickerSymbol, usdgExactText, waitCause } from '@/components/sleeve/text';
import { tickerTokenKey } from '@/components/token/ticker-icon';
import { TokenIcon } from '@/components/token/token-icon';
import { TokenPair } from '@/components/token/token-stack';
import { Amount } from '@/components/ui/amount';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { cx } from '@/components/ui/cx';
import { DebtSecurityLine } from '@/components/ui/debt-security-line';
import { formatUtc, formatUtcDate } from '@/components/ui/format-time';
import { Icon } from '@/components/ui/icons';
import { Identicon } from '@/components/ui/identicon';
import type { BucketView } from '@/data/types';

import { sortedLine, type Payday } from '../_lib/payday';
import { isFirstShowing, rememberShown } from '../_lib/seen-split';

const LINK = 'inline-flex min-h-touch items-center gap-1 font-medium text-link underline underline-offset-4 hover:text-link-hover';

/** One part of the payday: a tinted tile that says what the part is, how much, and what happens to it. */
function Leg({
  tone,
  title,
  children,
}: {
  tone: 'spend' | 'equity' | 'waiting';
  title: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <div
      className={cx(
        'relative min-w-0 overflow-hidden rounded-row border p-4',
        tone === 'spend' && 'border-spend-border bg-spend-surface',
        tone === 'equity' && 'border-equity-border bg-equity-surface',
        tone === 'waiting' && 'border-border bg-surface pt-5',
      )}
    >
      {tone === 'waiting' ? <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1.5 bg-waiting-stripes" /> : null}
      <h3
        className={cx(
          'flex items-center gap-2 text-body-s font-semibold',
          tone === 'spend' && 'text-spend',
          tone === 'equity' && 'text-equity',
          tone === 'waiting' && 'text-waiting',
        )}
      >
        {title}
      </h3>
      {children}
    </div>
  );
}

/** The market countdown for a share waiting on the session: when it opens, ticking, in New York time. */
function OpenCountdown({ tickerId }: { tickerId: number }): JSX.Element | null {
  const read = useMarketSession(tickerId);
  if (read.status !== 'ready' || read.view.state !== 'closed' || read.words.remaining === null) return null;
  return (
    <div className="mt-3 rounded-row bg-waiting-soft px-3 py-2.5">
      <p className="text-body-s text-ink-secondary">Buys when the market opens, in</p>
      <p className="text-figure-s tabular-nums text-ink" aria-label={read.words.sentence}>
        {read.words.remaining}
      </p>
      {read.words.when === null ? null : <p className="text-body-s text-ink-secondary">{read.words.when} New York time</p>}
    </div>
  );
}

function EquityLeg({
  receipt,
  bucket,
  waitEnd,
  rule,
}: {
  receipt: Receipt;
  bucket: BucketView | undefined;
  waitEnd: WaitEnd | null;
  rule: Rule;
}): JSX.Element | null {
  const symbol = tickerSymbol(receipt.tickerId);
  const token = tickerTokenKey(receipt.tickerId);
  const mark = token === null ? <TokenIcon token="USDG" size="lg" decorative /> : <TokenIcon token={token} size="lg" decorative />;

  if (receipt.status === 'FILLED') {
    return (
      <Leg tone="equity" title={<>Became {symbol}</>}>
        <p className="mt-2 flex items-center gap-2.5">
          {mark}
          <Amount value={formatStockToken(receipt.tokensOut)} unit={symbol} kind="equity" className="text-figure-s md:text-figure-m" />
        </p>
        <DebtSecurityLine className="mt-1" />
        <p className="mt-2 text-body-s text-ink-secondary">
          Bought with {usdgExactText(receipt.usdgSpent)}. {premiumSentence('buy', receipt.premiumBps)}
        </p>
      </Leg>
    );
  }

  if (receipt.status !== 'QUEUED') return null;
  const pair = token === null ? <TokenIcon token="USDG" size="lg" decorative /> : <TokenPair from="USDG" to={token} size="lg" decorative />;
  const amount = <Amount value={formatUsdg(receipt.usdgQueued, { maxFractionDigits: 6 })} unit="USDG" kind="waiting" className="text-figure-s md:text-figure-m" />;

  if (waitEnd?.kind === 'bought') {
    return (
      <Leg tone="equity" title={<>Waited, then became {symbol}</>}>
        <p className="mt-2 flex items-center gap-2.5">
          {pair}
          <Amount value={formatUsdg(receipt.usdgQueued, { maxFractionDigits: 6 })} unit="USDG" kind="equity" className="text-figure-s md:text-figure-m" />
        </p>
        <DebtSecurityLine className="mt-1" />
        <p className="mt-2 text-body-s text-ink-secondary">
          It waited because {waitCause(receipt.reason)}, then bought {symbol} on {formatUtcDate(waitEnd.record.receipt.timestamp)}.
        </p>
      </Leg>
    );
  }
  if (waitEnd !== null) {
    return (
      <Leg tone="spend" title="Waited, then moved to spend">
        <p className="mt-2 flex items-center gap-2.5">
          <TokenIcon token="USDG" size="lg" decorative />
          <Amount value={formatUsdg(receipt.usdgQueued, { maxFractionDigits: 6 })} unit="USDG" className="text-figure-s md:text-figure-m" />
        </p>
        <p className="mt-2 text-body-s text-ink-secondary">
          It waited to buy {symbol}, then moved to spend on {formatUtcDate(waitEnd.record.receipt.timestamp)}.
        </p>
      </Leg>
    );
  }

  const stillWaiting = bucket !== undefined && bucket.amount > 0n && bucket.since <= receipt.timestamp;
  const reason = stillWaiting ? bucket.reason : receipt.reason;
  return (
    <Leg
      tone="waiting"
      title={
        <>
          <span aria-hidden="true" className="size-2.5 shrink-0 rounded-pill bg-waiting-stripes ring-1 ring-inset ring-waiting" />
          Waiting to buy {symbol}
        </>
      }
    >
      <p className="mt-2 flex items-center gap-2.5">
        {pair}
        {amount}
      </p>
      <p className="mt-2 text-body-s text-ink">
        {reason === 'SESSION'
          ? `Held as USDG in your account because the market is closed.`
          : reasonSentence(reason, { symbol, minClip: rule.minClip, premiumCapBps: rule.premiumCapBps })}
      </p>
      {reason === 'SESSION' ? <OpenCountdown tickerId={receipt.tickerId} /> : null}
    </Leg>
  );
}


/** "90%": the spend part of the payday, in its own numbers. */
function spendShare(receipt: Receipt): string {
  if (receipt.usdgIn === 0n) return '0%';
  return formatBps(Number((receipt.usdgToSpend * 10_000n) / receipt.usdgIn));
}

function headline(receipt: Receipt, waitEnd: WaitEnd | null): { tone: BadgeTone; label: string } {
  switch (receipt.status) {
    case 'FILLED':
      return { tone: 'success', label: 'Split and bought' };
    case 'QUEUED':
      if (waitEnd?.kind === 'bought') return { tone: 'success', label: 'Split, bought after a wait' };
      if (waitEnd !== null) return { tone: 'neutral', label: 'Split, waiting USDG moved to spend' };
      return { tone: 'waiting', label: 'Split, equity share waiting' };
    default:
      return { tone: 'neutral', label: 'Split, all spendable' };
  }
}

export interface PaydayHeroProps {
  account: Address;
  payday: Payday;
  rule: Rule;
  buckets: readonly BucketView[];
  /** How the equity share's wait ended, when it waited and ended. */
  waitEnd: WaitEnd | null;
  /** Payments newer than this payday that are not sorted yet. */
  newer: { count: number; amount: bigint };
}

/**
 * This payday as Home's hero (D-024, PRD 15): the payment that arrived, who sent it and when, the split rail, and
 * what each part became, spendable USDG and the Stock Token bought or waiting, each with its token. The equity
 * segment grows once, the first time this browser shows the split. The record behind it is one link away.
 */
export function PaydayHero({ account, payday, rule, buckets, waitEnd, newer }: PaydayHeroProps): JSX.Element {
  const titleId = useId();
  const receipt = payday.record.receipt;
  const id = receipt.id;
  const [animate] = useState(() => isFirstShowing(account, id));

  // Browser storage is outside React: note that this split has been shown, so a later visit leaves it still.
  useEffect(() => {
    rememberShown(account, id);
  }, [account, id]);

  const symbol = tickerSymbol(receipt.tickerId);
  const parts = splitPartsOf(receipt);
  const railParts =
    parts === null
      ? null
      : waitEnd?.kind === 'bought'
        ? { spend: parts.spend, equity: parts.waiting, waiting: 0n }
        : waitEnd !== null
          ? { spend: parts.spend + parts.waiting, equity: 0n, waiting: 0n }
          : parts;
  const bucket = buckets.find((candidate) => candidate.tickerId === receipt.tickerId);
  const status = headline(receipt, waitEnd);
  const refused = receipt.status === 'REFUSED_TICKER' || receipt.status === 'REFUSED_ACCOUNT';

  return (
    <section aria-labelledby={titleId} className="min-w-0 overflow-hidden rounded-module border border-border bg-surface shadow-card">
      {newer.count > 0 ? (
        <Link
          href="#waiting"
          className="flex items-center gap-2.5 border-b border-border bg-surface-muted px-card py-2.5 text-body-s text-ink transition-colors duration-fast ease-standard hover:bg-surface-strong"
        >
          <span aria-hidden="true" className="size-2 shrink-0 rounded-pill bg-spend" />
          <span className="min-w-0 flex-1">
            {newer.count === 1 ? '1 newer payment' : `${newer.count} newer payments`}, {usdgExactText(newer.amount)}, not sorted yet.
            Spendable now.
          </span>
          <Icon name="arrowDown" className="size-4 shrink-0 text-ink-secondary" />
        </Link>
      ) : null}

      <div className="p-card md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <h2 className="flex flex-wrap items-center gap-2 text-body-s font-semibold text-ink-secondary">
              <span id={titleId}>This payday</span> <SampleTag />
            </h2>
            <p className="mt-3 flex items-center gap-3">
              <TokenIcon token="USDG" size="xl" chain decorative />
              <Amount value={formatUsdg(receipt.usdgIn, { maxFractionDigits: 6 })} unit="USDG" className="text-figure-l text-ink" />
            </p>
            <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-body-s text-ink-secondary">
              {payday.from === null ? (
                <span>From {payday.payments} payments</span>
              ) : (
                <>
                  <Identicon value={payday.from} size="sm" />
                  <span>
                    From <span className="font-mono text-mono-s text-ink">{shortAddress(payday.from)}</span>
                  </span>
                </>
              )}
              {payday.arrivedAt === null ? null : <span>arrived {formatUtc(payday.arrivedAt)}</span>}
            </p>
          </div>
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>

        {railParts === null ? null : <SplitRail parts={railParts} animate={animate} className="mt-6" />}

        <div className={cx('mt-4 grid gap-3', !refused && 'sm:grid-cols-2')}>
          <Leg
            tone="spend"
            title={
              <>
                <span aria-hidden="true" className="size-2.5 shrink-0 rounded-pill bg-spend" />
                {refused ? 'All of it stayed spendable' : 'Stayed spendable'}
              </>
            }
          >
            <p className="mt-2 flex items-center gap-2.5">
              <TokenIcon token="USDG" size="lg" decorative />
              <Amount
                value={formatUsdg(refused ? receipt.usdgIn : receipt.usdgToSpend, { maxFractionDigits: 6 })}
                unit="USDG"
                className="text-figure-s md:text-figure-m"
              />
            </p>
            <p className="mt-2 text-body-s text-ink-secondary">
              {refused
                ? receipt.status === 'REFUSED_ACCOUNT'
                  ? `${symbol} could not be bought because the issuer's blocklist includes this account, so the equity share went to spend.`
                  : isPoolAllowlisted(receipt.tickerId, receipt.pool)
                    ? `${symbol} is no longer on Sleeve's ticker list, so the equity share went to spend.`
                    : `The pool this split named is not on the ${symbol} allowlist, so the equity share went to spend.`
                : `${spendShare(receipt)} of this payday, in your account as USDG. Yours to use now.`}
            </p>
          </Leg>
          {refused ? null : <EquityLeg receipt={receipt} bucket={bucket} waitEnd={waitEnd} rule={rule} />}
        </div>
      </div>

      <div className="flex flex-col gap-1 border-t border-border px-card py-3 text-body-s md:flex-row md:items-center md:justify-between md:px-6">
        <p className="text-ink-secondary">{sortedLine(payday)}</p>
        <div className="flex shrink-0 flex-wrap gap-x-5">
          <Link href={`/receipts/${id}`} className={LINK}>
            Details and proof <span className="sr-only">of this payday, #{id.toString()}</span>
          </Link>
          <Link href="/payments" className={LINK}>
            All payments
          </Link>
        </div>
      </div>
    </section>
  );
}
