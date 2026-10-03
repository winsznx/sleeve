'use client';

import { formatBps, formatFeedPrice, formatUsdg, premiumBps, tickerById } from '@sleeve/core';
import type { JSX } from 'react';

import { percentWords, tickerSymbol } from '@/components/sleeve/text';
import { tickerTokenKey } from '@/components/token/ticker-icon';
import { TokenIcon } from '@/components/token/token-icon';
import { cx } from '@/components/ui/cx';
import { formatUtc } from '@/components/ui/format-time';
import type { MarketSnapshot, TickerMarket } from '@/data/types';

import type { SessionView, SessionWords } from './market-session';
import { previewPayday, type PreviewRule } from './payday-preview';
import { verdictSentence } from './payday-words';
import { SampleTag, SessionMark } from './sample-tag';
import { newYorkLong } from './time-words';

/**
 * The markets panel behind the session pill (docs/design/inspiration.md 5.3): the session with its next change, what a
 * payment arriving now would do under the followed rule, and each launch ticker's pool quote and Chainlink reference,
 * shown apart with their own times (PRD 7.11). No change column, no sparkline.
 */

export const SCHEDULE_LINE =
  'The US 24/5 session runs from Sunday 20:00 to Friday 20:00 New York time and closes on NYSE holidays.';

export const APART_LINE = 'The pool quote and the Chainlink reference are shown apart, never merged.';

export interface MarketsPanelProps {
  snapshot: MarketSnapshot;
  market: TickerMarket;
  now: bigint;
  view: SessionView;
  words: SessionWords;
  rule: PreviewRule;
  /** True when no owner rule is known and the suggested start stands in for it. */
  suggestedRule: boolean;
}

/** A payment the size PRD 8.1 uses, to say what the rule would do now. */
const EXAMPLE_PAYMENT = 500_000_000n;

/** Where the pool sits against the reference, as a sentence in plain words, never colored (docs/DESIGN.md 12.2). */
export function premiumSentence(market: TickerMarket): string {
  const pool = market.poolPrice;
  if (pool === null || pool.tokensOut <= 0n || market.feed.answer <= 0n) return 'No pool quote to compare right now.';
  const bps = premiumBps(pool.usdgIn, pool.tokensOut, market.feed.answer);
  if (bps === 0n) return 'The pool matches the reference.';
  return `The pool is ${percentWords(bps)} ${bps > 0n ? 'above' : 'below'} the reference.`;
}

/** A ticker's pool quote and Chainlink reference, each with its source and time, then the gap between them. */
export function TickerFacts({ market, className }: { market: TickerMarket; className?: string }): JSX.Element {
  const symbol = tickerSymbol(market.tickerId);
  const pool = market.poolPrice;
  return (
    <div className={className}>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-body-s">
        <dt className="text-ink-secondary">Pool</dt>
        <dd className="min-w-0 text-ink">
          {pool === null ? (
            'No quote'
          ) : (
            <>
              <span className="tabular-nums">{formatUsdg(pool.execPrice)} USDG</span> per {symbol}
              <span className="block text-ink-secondary">Uniswap quote, {formatUtc(pool.at.timestamp)}</span>
            </>
          )}
        </dd>
        <dt className="text-ink-secondary">Reference</dt>
        <dd className="min-w-0 text-ink">
          <span className="tabular-nums">{formatFeedPrice(market.feed.answer)} USD</span>
          <span className="block text-ink-secondary">Chainlink, updated {formatUtc(market.feed.updatedAt)}</span>
        </dd>
      </dl>
      <p className="mt-1.5 text-body-s text-ink-secondary">{premiumSentence(market)}</p>
    </div>
  );
}

function TickerRow({ market, followed }: { market: TickerMarket; followed: boolean }): JSX.Element {
  const symbol = tickerSymbol(market.tickerId);
  const name = tickerById(market.tickerId)?.name ?? '';
  const icon = tickerTokenKey(market.tickerId);
  return (
    <li className="flex gap-3 px-4 py-3.5">
      {icon === null ? <span className="size-6 shrink-0" /> : <TokenIcon token={icon} size="md" decorative className="mt-0.5" />}
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-baseline gap-2">
          <span className="text-body font-semibold text-ink">{symbol}</span>
          <span className="min-w-0 truncate text-body-s text-ink-secondary">{name}</span>
          {followed ? (
            <span className="ml-auto shrink-0 rounded-control bg-surface-strong px-1.5 py-0.5 text-label font-medium text-ink-secondary">
              Your rule
            </span>
          ) : null}
        </p>
        <TickerFacts market={market} className="mt-1.5" />
      </div>
    </li>
  );
}

export function MarketsPanel({ snapshot, market, now, view, words, rule, suggestedRule }: MarketsPanelProps): JSX.Element {
  const preview = previewPayday(EXAMPLE_PAYMENT, rule, market, snapshot.usdgUsd, view, now);
  const symbol = tickerSymbol(rule.tickerId);
  const change =
    view.state === 'open' ? view.closesAt : view.state === 'closed' ? view.opensAt : null;
  return (
    <div className="min-w-0">
      <div className="px-4 pb-3.5 pt-4">
        <p className="flex items-center gap-2 text-h3 text-ink">
          <SessionMark tone={words.tone} />
          {words.title}
        </p>
        {change === null ? null : (
          <p className="mt-1 text-body-s text-ink">
            {view.state === 'open' ? 'Closes' : 'Opens'} {newYorkLong(change)}
            {words.remaining === null ? null : <span className="text-ink-secondary">, in {words.remaining}</span>}
          </p>
        )}
        <p className="mt-2 text-body-s text-ink-secondary">{SCHEDULE_LINE}</p>
        <p className={cx('mt-3 rounded-row px-3 py-2.5 text-body-s text-ink', words.tone === 'open' ? 'bg-equity-surface' : 'bg-waiting-soft')}>
          {verdictSentence(preview.outcome, symbol, rule.premiumCapBps)}{' '}
          <span className="text-ink-secondary">
            Under {suggestedRule ? 'the suggested' : 'your'} rule: {formatBps(rule.equityBps)} of each payment to {symbol}, cap{' '}
            {formatBps(rule.premiumCapBps)} above the reference.
          </span>
        </p>
      </div>
      <ul aria-label="Launch Stock Tokens" className="divide-y divide-border border-t border-border">
        {snapshot.tickers.map((ticker) => (
          <TickerRow key={ticker.tickerId} market={ticker} followed={!suggestedRule && ticker.tickerId === rule.tickerId} />
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface-muted px-4 py-3">
        <p className="text-body-s text-ink-secondary">{APART_LINE}</p>
        <SampleTag />
      </div>
    </div>
  );
}
