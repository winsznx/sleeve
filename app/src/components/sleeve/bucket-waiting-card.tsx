import { formatUsdg, type Rule } from '@sleeve/core';
import Link from 'next/link';
import type { JSX } from 'react';

import { tickerTokenKey } from '@/components/token/ticker-icon';
import { TokenStack } from '@/components/token/token-stack';
import { Amount } from '@/components/ui/amount';
import { ReasonTag } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Banner } from '@/components/ui/card';
import { cx } from '@/components/ui/cx';
import { formatDuration, formatUtc } from '@/components/ui/format-time';
import type { BucketView } from '@/data/types';

import { reasonSentence, tickerSymbol } from './text';

/** Five days in seconds. PRD 7.4: after five days queued, the app asks the owner to raise the cap, switch ticker, or release. */
export const LONG_WAIT_SECONDS = 432_000n;

export interface BucketWaitingCardProps {
  bucket: BucketView;
  /** Chain time now (LedgerView.asOf.timestamp or MarketSnapshot.asOf.timestamp), never the device clock. */
  now: bigint;
  /** For SESSION: when the ticker's market reopens (TickerMarket.session.nextOpenAt). */
  reopensAt?: bigint | null;
  /** The current rule, for the minimum buy and the premium cap in the reason sentence. */
  rule?: Pick<Rule, 'minClip' | 'premiumCapBps'>;
  /** Moves the whole amount to spend. Confirm first if the screen wants to; the card only asks. */
  onRelease: () => void;
  /** The release is running: the button shows "Releasing" and ignores more clicks. */
  releasing?: boolean;
  /** The rule editor, offered once the wait passes five days. */
  ruleHref?: string;
  className?: string;
}

/**
 * Equity waiting for the guard (PRD 15, Waiting): the amount, the reason in plain words and what happens next, how
 * long it has waited, that the money is still USDG in the owner's account, and a release button. A row card,
 * because it asks for a decision.
 */
export function BucketWaitingCard({
  bucket,
  now,
  reopensAt,
  rule,
  onRelease,
  releasing = false,
  ruleHref,
  className,
}: BucketWaitingCardProps): JSX.Element {
  const symbol = tickerSymbol(bucket.tickerId);
  const tickerKey = tickerTokenKey(bucket.tickerId);
  const waited = now - bucket.since;
  const longWait = waited >= LONG_WAIT_SECONDS;

  return (
    <article className={cx('min-w-0 rounded-row border border-border bg-surface p-4 transition-colors duration-fast hover:border-border-strong', className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <h3 className="flex items-center gap-2 text-body font-semibold text-ink">
          <TokenStack tokens={tickerKey === null ? ['USDG'] : ['USDG', tickerKey]} size="md" decorative />
          <span>
            <Amount value={formatUsdg(bucket.amount)} unit="USDG" kind="waiting" /> waiting to buy {symbol}
          </span>
        </h3>
        <ReasonTag reason={bucket.reason} />
      </div>
      <p className="mt-2 text-body-s text-ink">
        {reasonSentence(bucket.reason, {
          symbol,
          reopensAt,
          minClip: rule?.minClip,
          premiumCapBps: rule?.premiumCapBps,
        })}
      </p>
      <p className="mt-1 text-body-s text-ink-secondary">
        Waiting for {formatDuration(waited)}, since {formatUtc(bucket.since)}. It stays in your account as USDG, and you
        can release it to spend at any time.
      </p>
      {longWait ? (
        <Banner title={`Waiting for ${formatDuration(waited)}`} className="mt-3">
          You can raise your cap, switch ticker, or release it to spend.
          {ruleHref === undefined ? null : (
            <>
              {' '}
              <Link href={ruleHref} className="font-medium text-link underline underline-offset-4 hover:text-link-hover">
                Edit your rule
              </Link>
            </>
          )}
        </Banner>
      ) : null}
      <div className="mt-3">
        <Button variant="secondary" size="sm" onClick={onRelease} busy={releasing} busyLabel="Releasing">
          Release to spend
        </Button>
      </div>
    </article>
  );
}
