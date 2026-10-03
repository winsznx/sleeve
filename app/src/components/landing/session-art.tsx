'use client';

import { RULE_DEFAULTS, formatUsdg, type TickerId } from '@sleeve/core';
import type { JSX } from 'react';

import { tickerSymbol } from '@/components/sleeve/text';
import { tickerTokenKey } from '@/components/token/ticker-icon';
import { TokenPair } from '@/components/token/token-stack';
import { Amount } from '@/components/ui/amount';
import { cx } from '@/components/ui/cx';
import { formatNewYork } from '@/components/ui/format-time';
import { Skeleton, SkeletonGroup, SkeletonText } from '@/components/ui/skeleton';
import type { SessionState } from '@/data/types';

import { useChainNow, useExampleAccount, useMarketSnapshot } from './landing-data';
import { SESSION_WEEK, WEEK_HOURS, newYorkWeekHour } from './landing-time';
import { LoadError, SessionDot, SessionPill, reopenWords, sessionWords } from './widgets';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

function percentOfWeek(hours: number): string {
  return `${(hours / WEEK_HOURS) * 100}%`;
}

/**
 * The 24/5 week as one bar in New York time: open from Sunday 20:00 to Friday 20:00, the weekend hatched in the
 * waiting pattern because that is when an equity share waits, and a mark at the chain's own time.
 */
function WeekStrip({ nowHour }: { nowHour: number }): JSX.Element {
  return (
    <div aria-hidden="true">
      <div className="relative h-3">
        <div className="flex h-full overflow-hidden rounded-pill">
          <span className="h-full bg-equity" style={{ width: percentOfWeek(SESSION_WEEK.closesAt) }} />
          <span className="h-full bg-waiting-stripes" style={{ width: percentOfWeek(SESSION_WEEK.opensAt - SESSION_WEEK.closesAt) }} />
          <span className="h-full flex-1 bg-equity" />
        </div>
        <span
          className="absolute -bottom-1.5 -top-1.5 w-1 -translate-x-1/2 rounded-pill bg-ink ring-2 ring-surface"
          style={{ left: percentOfWeek(nowHour) }}
        />
      </div>
      <div className="mt-2 grid grid-cols-7 text-micro text-ink-secondary">
        {DAYS.map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
    </div>
  );
}

/**
 * The featured card's picture: the market session for the example rule's ticker, read from the data layer, and the
 * buy that is waiting for it. Every time comes from the chain read, never from the device's clock.
 */
export function SessionArt({ className }: { className?: string }): JSX.Element {
  const snapshot = useMarketSnapshot();
  const example = useExampleAccount();
  const frame = cx('w-full rounded-panel bg-surface p-4 text-left text-ink shadow-floating', className);

  if (snapshot.status === 'loading' || example.status === 'loading') {
    return (
      <SkeletonGroup label="Loading the market session" className={frame}>
        <Skeleton className="h-4 w-36" />
        <Skeleton className="mt-5 h-3 w-full rounded-pill" />
        <SkeletonText lines={3} className="mt-5" />
      </SkeletonGroup>
    );
  }
  if (snapshot.status === 'error') {
    return <LoadError what="The market session" retry={snapshot.retry} className={className} />;
  }

  const { market, readAt } = snapshot.data;
  const account = example.status === 'ready' ? example.data : null;
  const tickerId = account?.rule.tickerId ?? RULE_DEFAULTS.tickerId;
  const ticker = market.tickers.find((item) => item.tickerId === tickerId) ?? market.tickers[0];
  const bucket = account?.buckets.find((item) => item.tickerId === tickerId);
  if (ticker === undefined) {
    return <p className={cx(frame, 'text-body-s text-ink-secondary')}>The market read lists no launch ticker.</p>;
  }
  return (
    <SessionCard
      className={frame}
      snapshot={{ asOf: market.asOf.timestamp, readAt }}
      session={ticker.session}
      tickerId={ticker.tickerId}
      waiting={bucket?.amount ?? null}
    />
  );
}

interface SessionCardProps {
  /** The market read's chain time and when the browser received it. */
  snapshot: { asOf: bigint; readAt: number };
  session: SessionState;
  tickerId: TickerId;
  /** USDG waiting to buy this ticker, or null when nothing waits. */
  waiting: bigint | null;
  className: string;
}

function SessionCard({ snapshot, session, tickerId, waiting, className }: SessionCardProps): JSX.Element {
  const now = useChainNow(snapshot.asOf, snapshot.readAt);
  const symbol = tickerSymbol(tickerId);
  const tickerKey = tickerTokenKey(tickerId);
  const reopen = reopenWords(session);
  return (
    <div className={className}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-body-s font-semibold">{symbol} market session</p>
        <SessionPill session={session} />
      </div>
      <div className="mt-4">
        <WeekStrip nowHour={newYorkWeekHour(now)} />
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-label text-ink-secondary">
        <li className="flex items-center gap-1.5">
          <SessionDot open />
          Open Sunday 20:00 to Friday 20:00, New York time
        </li>
        <li className="flex items-center gap-1.5">
          <SessionDot open={false} />
          Closed, buys wait
        </li>
      </ul>
      <p className="mt-3 text-body-s text-ink">
        {sessionWords(session)}.{reopen === null ? null : ` ${reopen}.`}
      </p>
      <p className="mt-0.5 text-label text-ink-secondary">Chain time {formatNewYork(now)}</p>
      {waiting === null ? null : (
        <div className="mt-3 flex items-center gap-2.5 border-t border-border pt-3">
          {tickerKey === null ? null : <TokenPair from="USDG" to={tickerKey} size="md" decorative />}
          <p className="min-w-0 text-body-s text-ink-secondary">
            <Amount value={formatUsdg(waiting)} unit="USDG" kind="waiting" className="font-semibold" /> waiting to buy {symbol},
            kept as USDG in the account
          </p>
        </div>
      )}
    </div>
  );
}
