'use client';

import { CHAIN_NAME, formatBps, TOTAL_BPS, type Address } from '@sleeve/core';
import Link from 'next/link';
import type { JSX } from 'react';

import { useSleeveOff } from '@/components/sleeve/sleeve-off';
import { SplitRail } from '@/components/sleeve/split-rail';
import { tickerSymbol } from '@/components/sleeve/text';
import { NetworkGlyph } from '@/components/token/glyphs';
import { TickerIcon } from '@/components/token/ticker-icon';
import { TokenIcon } from '@/components/token/token-icon';
import { cx } from '@/components/ui/cx';
import { Wordmark } from '@/components/ui/wordmark';
import { useMarket, useRule } from '@/data/hooks';
import { DATA_SOURCE } from '@/data/source';

import { NavIcon } from './glyphs';
import { ReceiveButton } from './receive';
import { SampleTag, SessionMark } from './sample-tag';
import type { CurrentSection, NavItem } from './sections';
import { useWallClock } from './use-browser';
import { followedTicker, useMarketSession, useOwnerRule } from './use-market-session';

/**
 * The rail from 768 px, closeout's NavRail (docs/design/closeout-product-blueprint.md 2.2 and 15.1), on the grey shell
 * and sticky under the sample strip. Top: the wordmark, the rule as a split where closeout shows its workspace card
 * (D-024: the payday split leads everywhere), the four places and the black Receive pill. Bottom: the market session
 * card where closeout shows its help card, the two secondary places, and the network line.
 */

export interface AppRailProps {
  primary: readonly NavItem[];
  secondary: readonly NavItem[];
  current: CurrentSection | null;
  account: Address | null;
  /** The session read has not answered yet: the rule card and Receive keep their room, so the places never move. */
  pending: boolean;
  homeHref: string;
}

/** Closeout's 46 px rail rows, 44 px on screens under 820 px tall so the whole rail fits a 768 px window. */
const ITEM =
  'flex min-h-control-lg items-center gap-3 rounded-row px-3.5 text-body transition-colors duration-fast ease-standard [@media(max-height:820px)]:min-h-control';

function RailLink({ item, current }: { item: NavItem; current: boolean }): JSX.Element {
  return (
    <Link
      href={item.href}
      aria-current={current ? 'page' : undefined}
      className={cx(
        ITEM,
        current ? 'bg-surface font-semibold text-ink shadow-raised' : 'text-ink-secondary hover:bg-shell-raised hover:text-ink',
      )}
    >
      <NavIcon name={item.icon} className={current ? undefined : 'opacity-80'} />
      {item.label}
    </Link>
  );
}

const RULE_CARD = 'mb-5 block rounded-row bg-shell-raised px-3 py-3';

/** The rule card's loading body, the height of a loaded rule. */
function RuleSkeleton(): JSX.Element {
  return (
    <span aria-hidden="true" className="mt-2.5 block space-y-2">
      <span className="block h-3 rounded-pill bg-skeleton" />
      <span className="block h-[1.21875rem] w-4/5 rounded-xs bg-skeleton" />
    </span>
  );
}

/** Holds the rule card's place while the session read is out. */
function RuleCardPlaceholder(): JSX.Element {
  return (
    <div aria-hidden="true" className={RULE_CARD}>
      <span className="block text-body-s font-semibold text-ink">Each payment</span>
      <RuleSkeleton />
    </div>
  );
}

/** The card while Sleeve is off for the account (D-040): no rule splits a payment, and the way back is on Home. */
function SleeveOffCard(): JSX.Element {
  return (
    <Link href="/home" className={cx(RULE_CARD, 'transition-colors duration-fast ease-standard hover:bg-surface')}>
      <span className="flex items-center justify-between gap-2">
        <span className="text-body-s font-semibold text-ink">Each payment</span>
        <span className="text-label font-medium text-ink-secondary">Off</span>
      </span>
      <span className="mt-1 block text-body-s text-ink-secondary">
        Sleeve is off for this account, so payments stay as USDG. Turn it back on from Home.
      </span>
    </Link>
  );
}

/** The owner's rule drawn as the split it makes, in closeout's workspace-card slot. */
function RuleCard({ account }: { account: Address }): JSX.Element {
  const rule = useRule(account);
  const sleeveOff = useSleeveOff(account);
  const data = rule.data;
  if (sleeveOff) return <SleeveOffCard />;
  let body: JSX.Element;
  if (data === undefined) {
    body = rule.isError ? (
      <span className="mt-1 block text-body-s text-ink-secondary">Your rule did not load.</span>
    ) : (
      <RuleSkeleton />
    );
  } else if (data.status === 'NONE') {
    body = <span className="mt-1 block text-body-s text-ink-secondary">No rule yet. Every payment stays spendable until you set one.</span>;
  } else {
    const equity = BigInt(data.equityBps);
    const paused = data.status === 'PAUSED';
    body = (
      <>
        <SplitRail parts={{ spend: BigInt(TOTAL_BPS) - equity, equity: paused ? 0n : equity, waiting: paused ? equity : 0n }} className="mt-2.5" />
        <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-body-s text-ink-secondary">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2 rounded-pill bg-spend" />
            <span className="font-medium tabular-nums text-ink">{formatBps(TOTAL_BPS - data.equityBps)}</span>
            <TokenIcon token="USDG" size="xs" decorative />
            USDG
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className={cx('size-2 rounded-pill', paused ? 'bg-waiting-stripes ring-1 ring-inset ring-waiting' : 'bg-equity')} />
            <span className="font-medium tabular-nums text-ink">{formatBps(data.equityBps)}</span>
            <TickerIcon tickerId={data.tickerId} size="xs" />
            {tickerSymbol(data.tickerId)}
          </span>
        </span>
      </>
    );
  }
  const status = data === undefined ? null : data.status === 'ACTIVE' ? 'Active' : data.status === 'PAUSED' ? 'Paused' : 'Not set';
  return (
    <Link
      href="/rule"
      aria-busy={data === undefined && !rule.isError ? true : undefined}
      className={cx(RULE_CARD, 'transition-colors duration-fast ease-standard hover:bg-surface')}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-body-s font-semibold text-ink">Each payment</span>
        {status === null ? null : <span className="text-label font-medium text-ink-secondary">{status}</span>}
      </span>
      {body}
    </Link>
  );
}

/**
 * Closeout's help card, holding the market session: the state, when it changes, and what that means for a payment.
 * The times follow the data layer's clock, so the card carries the sample tag while the mock runs. On a short
 * window the last line folds away; the session pill in the top bar says the same.
 */
function MarketCard(): JSX.Element {
  const read = useMarketSession(followedTicker(useOwnerRule()));
  if (read.status !== 'ready') {
    return (
      <div aria-busy={read.status === 'pending'} className="mb-3 rounded-panel bg-shell-raised p-3.5 text-body-s text-ink-secondary">
        {read.status === 'error' ? 'Market status unavailable.' : 'Reading the market session.'}
      </div>
    );
  }
  const { words, view } = read;
  return (
    <div className="mb-3 rounded-panel bg-shell-raised p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <p className="flex items-center gap-2 text-body-s font-semibold text-ink">
          <SessionMark tone={words.tone} />
          {words.title}
        </p>
        <SampleTag />
      </div>
      {words.when === null ? null : (
        <p className="mt-1 text-body-s text-ink-secondary">
          {view.state === 'open' ? 'Closes' : 'Opens'} {words.when} New York time
          {words.remaining === null ? null : <span className="tabular-nums">, in {words.remaining}</span>}.
        </p>
      )}
      <p className="mt-1 text-body-s text-ink-secondary [@media(max-height:820px)]:hidden">
        {view.state === 'open' ? 'Payments buy within your price cap.' : 'Payments wait as USDG until then.'}
      </p>
    </div>
  );
}

/**
 * The network as words with the neutral glyph, and on the chain source the read health beside it: a solid dot and
 * "Live" while the last read is under a minute old, the waiting stripes and "Reconnecting" after (Hyperliquid's
 * connection word). On the mock the market card carries the sample tag instead.
 */
function NetworkLine(): JSX.Element {
  const market = useMarket();
  const wall = useWallClock();
  let status: JSX.Element | null = null;
  if (DATA_SOURCE !== 'mock' && market.data !== undefined && wall !== null) {
    const fresh = wall / 1_000 - Number(market.data.asOf.timestamp) < 60;
    status = (
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className={cx('size-2 rounded-pill', fresh ? 'bg-equity' : 'bg-waiting-stripes ring-1 ring-inset ring-waiting')} />
        {fresh ? 'Live' : 'Reconnecting'}
      </span>
    );
  }
  return (
    <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border px-2.5 pt-3 text-body-s text-ink-secondary">
      <NetworkGlyph className="size-4" />
      {CHAIN_NAME}
      {status}
    </p>
  );
}

export function AppRail({ primary, secondary, current, account, pending, homeHref }: AppRailProps): JSX.Element {
  return (
    <div
      className="sticky hidden h-[calc(100dvh-var(--sample-notice-height,0px))] w-rail-compact shrink-0 flex-col justify-between overflow-y-auto px-3 pb-4 pt-5 md:top-[var(--sample-notice-height,0px)] md:flex lg:w-rail lg:px-4"
    >
      <div>
        <div className="px-2.5 pb-3">
          <Wordmark href={homeHref} />
        </div>
        {account !== null ? <RuleCard account={account} /> : pending ? <RuleCardPlaceholder /> : null}
        <nav aria-label="Main">
          <ul className="flex flex-col gap-0.5">
            {primary.map((item) => (
              <li key={item.href}>
                <RailLink item={item} current={current?.item.href === item.href} />
              </li>
            ))}
          </ul>
        </nav>
        <div className="pt-4">
          {account === null && pending ? (
            <span aria-hidden="true" className="block h-control w-full rounded-pill bg-skeleton" />
          ) : (
            <ReceiveButton look="rail" />
          )}
        </div>
      </div>
      <div className="pt-5">
        <MarketCard />
        <nav aria-label="More">
          <ul className="flex flex-col gap-0.5">
            {secondary.map((item) => (
              <li key={item.href}>
                <RailLink item={item} current={current?.item.href === item.href} />
              </li>
            ))}
          </ul>
        </nav>
        <NetworkLine />
      </div>
    </div>
  );
}
