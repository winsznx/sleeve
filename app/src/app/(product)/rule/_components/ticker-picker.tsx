'use client';

import { formatFeedPrice, formatUsdg, LAUNCH_TICKERS, shortAddress, type TickerId } from '@sleeve/core';
import { useId, type JSX } from 'react';

import { SessionMark } from '@/components/shell/sample-tag';
import { useMarketSession } from '@/components/shell/use-market-session';
import { tickerTokenKey } from '@/components/token/ticker-icon';
import { TokenIcon } from '@/components/token/token-icon';
import { Badge } from '@/components/ui/badge';
import { cx } from '@/components/ui/cx';
import { formatUtc } from '@/components/ui/format-time';
import { Icon } from '@/components/ui/icons';
import { Skeleton } from '@/components/ui/skeleton';
import type { MarketSnapshot } from '@/data/types';

import { isBroadFund, SUGGESTED_TICKER } from '../_lib/rule-draft';

/** "0.05 percent fee" for a v3 fee tier in hundredths of a basis point. */
function feeWords(fee: number): string {
  return `${(fee / 10_000).toFixed(2)} percent fee`;
}

function SessionLine({ tickerId }: { tickerId: TickerId }): JSX.Element {
  const read = useMarketSession(tickerId);
  if (read.status === 'pending') return <Skeleton className="h-3.5 w-36" />;
  if (read.status === 'error') return <span>Market status unavailable</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <SessionMark tone={read.words.tone} className="size-2" />
      {read.words.countdown === null ? read.words.title : `${read.words.title}, ${read.words.countdown}`}
    </span>
  );
}

const ROW = 'flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5';

interface TickerCardProps {
  ticker: (typeof LAUNCH_TICKERS)[number];
  name: string;
  checked: boolean;
  onSelect: () => void;
  market: MarketSnapshot | undefined;
  disabled: boolean;
}

function TickerCard({ ticker, name, checked, onSelect, market, disabled }: TickerCardProps): JSX.Element {
  const token = tickerTokenKey(ticker.id);
  const live = market?.tickers.find((candidate) => candidate.tickerId === ticker.id);
  const pool = ticker.pools[0];
  const suggested = ticker.id === SUGGESTED_TICKER;
  const kind = isBroadFund(ticker.id) ? 'Broad ETF' : 'Single company';
  return (
    <label
      className={cx(
        'relative flex min-w-0 cursor-pointer flex-col rounded-large border bg-surface p-4 transition-colors duration-fast ease-standard',
        'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus',
        checked ? 'border-brand ring-1 ring-brand' : 'border-border hover:border-border-strong',
        disabled && 'cursor-not-allowed opacity-disabled',
      )}
    >
      <input
        type="radio"
        name={name}
        value={ticker.symbol}
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        aria-label={`${ticker.symbol}, ${ticker.name}, ${isBroadFund(ticker.id) ? 'broad ETF' : 'single company'}${suggested ? ', suggested' : ''}`}
        className="sr-only"
      />
      <span className="flex items-start gap-3">
        {token === null ? null : <TokenIcon token={token} size="xl" decorative />}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-h3 text-ink">{ticker.symbol}</span>
            {suggested ? <Badge tone="success">Suggested</Badge> : null}
          </span>
          <span className="block text-body-s text-ink-secondary">{ticker.name}</span>
          <span className="block text-label text-ink-muted">{kind}</span>
        </span>
        <span
          aria-hidden="true"
          className={cx(
            'grid size-6 shrink-0 place-items-center rounded-pill border',
            checked ? 'border-brand bg-brand text-on-brand' : 'border-border-control bg-surface',
          )}
        >
          {checked ? <Icon name="check" className="size-3.5" /> : null}
        </span>
      </span>
      <span className="mt-3 flex flex-col gap-1.5 border-t border-border pt-3 text-body-s sm:mt-4">
        <span className={ROW}>
          <span className="text-ink-secondary">Chainlink reference</span>
          <span className="font-medium tabular-nums text-ink">
            {live === undefined ? <Skeleton className="h-3.5 w-20" /> : `${formatFeedPrice(live.feed.answer)} USD`}
          </span>
        </span>
        {/* On a phone only the chosen card shows the rest, so four cards fit on a screen or two. */}
        <span className={cx('flex-col gap-1.5', checked ? 'flex' : 'hidden sm:flex')}>
          {live === undefined ? null : <span className="text-ink-muted">Published {formatUtc(live.feed.updatedAt)}</span>}
          <span className={ROW}>
            <span className="text-ink-secondary">Pool price</span>
            <span className="font-medium tabular-nums text-ink">
              {live?.poolPrice === null || live?.poolPrice === undefined ? 'Not quoted' : `${formatUsdg(live.poolPrice.execPrice)} USDG`}
            </span>
          </span>
          {pool === undefined ? null : (
            <span className="text-ink-muted">
              Allowlisted pool <span className="font-mono text-mono-s">{shortAddress(pool.address)}</span>, {feeWords(pool.fee)}
            </span>
          )}
          <span className={cx(ROW, 'mt-1 text-ink')}>
            <SessionLine tickerId={ticker.id} />
          </span>
        </span>
      </span>
    </label>
  );
}

export interface TickerPickerProps {
  value: TickerId;
  onChange: (tickerId: TickerId) => void;
  market: MarketSnapshot | undefined;
  disabled?: boolean;
}

/**
 * Which Stock Token the equity share buys (PRD 7.3): one card per launch ticker, with its icon, what it tracks, the
 * Chainlink reference and its time, the pool price apart from it, the allowlisted pool and its fee, and the market
 * session. Native radio inputs carry the choice, so arrow keys move between cards.
 */
export function TickerPicker({ value, onChange, market, disabled = false }: TickerPickerProps): JSX.Element {
  const name = useId();
  const hintId = useId();
  return (
    <div className="min-w-0">
      <div role="radiogroup" aria-label="Stock Token to buy" aria-describedby={hintId} className="grid gap-3 sm:grid-cols-2">
        {LAUNCH_TICKERS.map((ticker) => (
          <TickerCard
            key={ticker.id}
            ticker={ticker}
            name={name}
            checked={ticker.id === value}
            onSelect={() => onChange(ticker.id)}
            market={market}
            disabled={disabled}
          />
        ))}
      </div>
      <p id={hintId} className="mt-3 max-w-reading text-body-s text-ink-secondary">
        Sleeve suggests a broad ETF, never a single company, because a default tends to stay. The choice is yours. Pool
        and reference prices are shown apart, never merged.
      </p>
    </div>
  );
}
