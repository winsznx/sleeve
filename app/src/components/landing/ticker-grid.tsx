'use client';

import {
  LAUNCH_TICKERS,
  formatBps,
  formatFeedPrice,
  formatUsdg,
  premiumBps,
  shortAddress,
  type SessionType,
  type Ticker,
} from '@sleeve/core';
import type { JSX, ReactNode } from 'react';

import { percentWords } from '@/components/sleeve/text';
import { TickerIcon } from '@/components/token/ticker-icon';
import { DebtSecurityLine } from '@/components/ui/debt-security-line';
import { formatUtc } from '@/components/ui/format-time';
import { Skeleton } from '@/components/ui/skeleton';
import { DATA_SOURCE } from '@/data/source';
import type { MarketSnapshot, TickerMarket } from '@/data/types';

import { useMarketSnapshot, type Remote } from './landing-data';
import { Eyebrow } from './primitives';
import { LoadError, SessionDot, SessionPill, reopenWords } from './widgets';

const SESSION_TYPE_WORDS: Record<SessionType, { name: string; hours: string }> = {
  ALL_DAY: { name: '24 hours, 5 days a week', hours: 'Sunday 20:00 to Friday 20:00, New York time' },
  REGULAR: { name: 'Regular hours', hours: '09:30 to 16:00 on trading days, New York time' },
  NONE: { name: 'No session', hours: 'Never open for buys' },
};

/** A v3 fee tier in hundredths of a basis point, as a percent: 500 is "0.05%". */
function feeTier(fee: number): string {
  return formatBps(fee / 100);
}

/**
 * The section's eyebrow carries the live session instead of a label: whether the launch tickers' market is open,
 * and when it opens, from the market read. Sample data says so while the mock runs.
 */
export function MarketEyebrow(): JSX.Element {
  const snapshot = useMarketSnapshot();
  const sample = DATA_SOURCE === 'mock' ? 'Sample market data. ' : '';
  if (snapshot.status !== 'ready') {
    return (
      <Eyebrow mark={<SessionDot open={false} />}>
        {snapshot.status === 'loading' ? 'Reading the market session' : 'Market session did not load'}
      </Eyebrow>
    );
  }
  const session = snapshot.data.market.tickers[0]?.session;
  if (session === undefined) return <Eyebrow>Launch tickers</Eyebrow>;
  const reopen = reopenWords(session);
  return (
    <Eyebrow mark={<SessionDot open={session.open} />}>
      {sample}
      {session.open ? 'Market open now' : `Market closed${reopen === null ? '' : `. ${reopen}`}`}
    </Eyebrow>
  );
}

/**
 * closeout's provider cards (blueprint section 7) as the four launch Stock Tokens: the mark of what each tracks, its
 * Chainlink price and the allowlisted pool's quote as separate prices with their own times (PRD 7.11), and the
 * session. The static facts render at once from @sleeve/core; the live ones fill in from the market read.
 */
export function TickerGrid({ className }: { className?: string }): JSX.Element {
  const snapshot = useMarketSnapshot();
  return (
    <div className={className}>
      {snapshot.status === 'error' ? <LoadError what="Live market data" retry={snapshot.retry} className="mb-[1.375rem]" /> : null}
      <ul className="grid gap-[1.375rem] sm:grid-cols-2 xl:grid-cols-4">
        {LAUNCH_TICKERS.map((ticker) => (
          <li key={ticker.id} className="flex">
            <TickerCard ticker={ticker} snapshot={snapshot} />
          </li>
        ))}
      </ul>
    </div>
  );
}

type Snapshot = Remote<{ market: MarketSnapshot; readAt: number }>;

function TickerCard({ ticker, snapshot }: { ticker: Ticker; snapshot: Snapshot }): JSX.Element {
  const live: TickerMarket | undefined =
    snapshot.status === 'ready' ? snapshot.data.market.tickers.find((item) => item.tickerId === ticker.id) : undefined;
  const pending = snapshot.status === 'loading';
  const [pool, ...otherPools] = ticker.pools;
  const titleId = `ticker-${ticker.symbol.toLowerCase()}`;

  return (
    <article aria-labelledby={titleId} className="flex w-full flex-col rounded-card bg-surface-muted p-6">
      <div className="flex items-start justify-between gap-3">
        <TickerIcon tickerId={ticker.id} size="xl" />
        {live === undefined ? null : <SessionPill session={live.session} />}
      </div>
      <h3 id={titleId} className="mt-4 text-h2 font-medium text-ink">
        {ticker.symbol}
      </h3>
      <p className="text-label font-semibold text-accent">{ticker.name}</p>
      <DebtSecurityLine className="mt-1.5" />

      <dl className="mt-4 divide-y divide-border border-t border-border text-body-s">
        <Fact term="Chainlink price feed" pending={pending}>
          {live === undefined ? null : (
            <>
              <span className="font-semibold tabular-nums text-ink">{formatFeedPrice(live.feed.answer)} USD</span>
              <span className="block text-label text-ink-secondary">Updated {formatUtc(live.feed.updatedAt)}</span>
            </>
          )}
          <span className="block font-mono text-mono-s text-ink-secondary">{shortAddress(ticker.feed)}</span>
        </Fact>
        {pool === undefined ? null : (
          <Fact term={`Allowlisted Uniswap v3 pool, ${feeTier(pool.fee)} fee`} pending={pending}>
            {live === undefined || live.poolPrice === null ? null : (
              <>
                <span className="font-semibold tabular-nums text-ink">{formatUsdg(live.poolPrice.execPrice)} USDG</span>
                <span className="block text-label text-ink-secondary">
                  Quote for {formatUsdg(live.poolPrice.usdgIn, { minFractionDigits: 0 })} USDG at block{' '}
                  {live.poolPrice.at.l2Block.toLocaleString('en-US')}
                </span>
                <QuoteGap live={live} />
              </>
            )}
            <span className="block font-mono text-mono-s text-ink-secondary">{shortAddress(pool.address)}</span>
            {otherPools.length === 0 ? null : (
              <span className="block text-label text-ink-secondary">
                Also allowlisted: {otherPools.map((other) => `${feeTier(other.fee)} fee pool`).join(', ')}
              </span>
            )}
          </Fact>
        )}
        <Fact term="Session" pending={false}>
          <span className="block text-ink">{SESSION_TYPE_WORDS[ticker.sessionType].name}</span>
          <span className="block text-label text-ink-secondary">{SESSION_TYPE_WORDS[ticker.sessionType].hours}</span>
        </Fact>
      </dl>
    </article>
  );
}

/**
 * How far the pool's quote sits from the Chainlink price, the check every buy runs (PRD 7.4 step 8), as a plain
 * sentence in a neutral tone. The two prices stay on their own lines above it; this only compares them.
 */
function QuoteGap({ live }: { live: TickerMarket }): JSX.Element | null {
  const quote = live.poolPrice;
  if (quote === null || quote.tokensOut === 0n || live.feed.answer <= 0n) return null;
  const gap = premiumBps(quote.usdgIn, quote.tokensOut, live.feed.answer);
  return (
    <span className="block text-label font-medium text-ink">
      {gap === 0n ? 'Level with the Chainlink price' : `${percentWords(gap)} ${gap > 0n ? 'above' : 'below'} the Chainlink price`}
    </span>
  );
}

function Fact({ term, pending, children }: { term: string; pending: boolean; children: ReactNode }): JSX.Element {
  return (
    <div className="py-2.5">
      <dt className="text-label text-ink-secondary">{term}</dt>
      <dd className="mt-0.5">
        {pending ? <Skeleton className="my-1 h-4 w-24" /> : null}
        {children}
      </dd>
    </div>
  );
}
