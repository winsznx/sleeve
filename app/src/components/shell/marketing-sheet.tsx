'use client';

import { CHAIN_NAME, formatFeedPrice, tickerById } from '@sleeve/core';
import { useId, useState, type JSX, type ReactNode } from 'react';

import { tickerSymbol } from '@/components/sleeve/text';
import { NetworkGlyph } from '@/components/token/glyphs';
import { tickerTokenKey } from '@/components/token/ticker-icon';
import { TokenIcon } from '@/components/token/token-icon';
import { ButtonLink, IconButton } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { Icon } from '@/components/ui/icons';
import { Wordmark } from '@/components/ui/wordmark';
import { useMarket } from '@/data/hooks';
import { DISCLAIMER } from '@/lib/copy';

import { ProductItems, ProofItems } from './marketing-menus';
import { MenuSheet } from './menu-sheet';
import { PaydayCard } from './payday-card';
import { SampleTag, SessionMark } from './sample-tag';
import { SiteLink } from './site-link';
import { APP_HOME, QUESTIONS_LINK, VERIFY_PATH } from './site-map';
import { SplitCheckForm } from './split-check-form';
import { followedTicker, useMarketSession, useOwnerRule } from './use-market-session';

/**
 * The marketing menu below 1024 px: a full-height sheet with the same content as the desktop menus, after Arc and
 * Stripe (docs/design/inspiration.md 4.5). Large rows open in place, the live payday card and the check form included;
 * the way into the app, the sign-in caption and the disclaimer stay pinned while the list scrolls.
 */

export interface MarketingSheetProps {
  open: boolean;
  onClose: () => void;
}

function Row({ title, children, defaultOpen = false }: { title: string; children: ReactNode; defaultOpen?: boolean }): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  const buttonId = useId();
  const regionId = useId();
  return (
    <li>
      <h2>
        <button
          id={buttonId}
          type="button"
          aria-expanded={open}
          aria-controls={regionId}
          onClick={() => setOpen((current) => !current)}
          className="flex min-h-16 w-full items-center justify-between gap-4 text-left text-h1 text-ink focus-visible:-outline-offset-2"
        >
          {title}
          <Icon name="chevronDown" className={cx('size-5 text-ink-secondary transition-transform duration-fast', open && 'rotate-180')} />
        </button>
      </h2>
      <div id={regionId} role="region" aria-labelledby={buttonId} hidden={!open} className="pb-5">
        {children}
      </div>
    </li>
  );
}

function SessionSummary(): JSX.Element {
  const read = useMarketSession(followedTicker(useOwnerRule()));
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-module bg-surface-muted px-4 py-3 text-body-s">
      {read.status === 'ready' ? (
        <p className="flex min-w-0 items-center gap-2 text-ink">
          <SessionMark tone={read.words.tone} />
          <span className="font-medium">{read.words.title}</span>
          {read.words.countdown === null ? null : <span className="text-ink-secondary">{read.words.countdown}</span>}
        </p>
      ) : (
        <p className="text-ink-secondary">{read.status === 'error' ? 'Market status unavailable' : 'Reading the market'}</p>
      )}
      <p className="flex items-center gap-1.5 text-ink-secondary">
        <NetworkGlyph className="size-4" />
        {CHAIN_NAME}
      </p>
    </div>
  );
}

function TickerRows(): JSX.Element {
  const market = useMarket();
  if (market.data === undefined) {
    return <p className="text-body-s text-ink-secondary">{market.isError ? 'Reference prices are unavailable right now.' : 'Reading reference prices.'}</p>;
  }
  return (
    <ul className="divide-y divide-border rounded-module border border-border">
      {market.data.tickers.map((ticker) => {
        const icon = tickerTokenKey(ticker.tickerId);
        return (
          <li key={ticker.tickerId} className="flex items-center gap-3 px-4 py-3">
            {icon === null ? null : <TokenIcon token={icon} size="md" decorative />}
            <span className="min-w-0 flex-1">
              <span className="block text-body font-semibold text-ink">{tickerSymbol(ticker.tickerId)}</span>
              <span className="block truncate text-body-s text-ink-secondary">{tickerById(ticker.tickerId)?.name}</span>
            </span>
            <span className="shrink-0 text-right text-body-s">
              <span className="block font-medium tabular-nums text-ink">{formatFeedPrice(ticker.feed.answer)} USD</span>
              <span className="block text-ink-secondary">Chainlink reference</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function MarketingSheet({ open, onClose }: MarketingSheetProps): JSX.Element {
  return (
    <MenuSheet open={open} onClose={onClose} label="Menu">
      <div className="flex min-h-topbar shrink-0 items-center justify-between gap-3 border-b border-border px-gutter">
        <Wordmark href="/" />
        <IconButton icon="close" label="Close the menu" onClick={onClose} className="-mr-2" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-gutter pb-6 pt-4">
        <SessionSummary />
        <ul className="mt-3 divide-y divide-border border-b border-border">
          <Row title="Product" defaultOpen>
            <ProductItems onNavigate={onClose} className="-mx-3" />
            <PaydayCard className="mt-3 border border-border shadow-none" />
          </Row>
          <Row title="Proof">
            <ProofItems onNavigate={onClose} className="-mx-3" />
            <div className="mt-3 rounded-module border border-border p-4">
              <SplitCheckForm />
            </div>
          </Row>
          <li>
            <SiteLink
              href={QUESTIONS_LINK.href}
              onNavigate={onClose}
              className="flex min-h-16 items-center text-h1 text-ink focus-visible:-outline-offset-2"
            >
              {QUESTIONS_LINK.label}
            </SiteLink>
          </li>
        </ul>
        <div className="mt-6">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <h2 className="text-h3 text-ink">Stock Tokens at launch</h2>
            <SampleTag />
          </div>
          <TickerRows />
        </div>
      </div>
      <div className="shrink-0 border-t border-border bg-surface px-gutter pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3">
        <div className="grid grid-cols-2 gap-2">
          <ButtonLink href={APP_HOME} size="lg" fullWidth onClick={onClose}>
            Open the app
          </ButtonLink>
          <ButtonLink href={VERIFY_PATH} variant="secondary" size="lg" fullWidth onClick={onClose}>
            Check a split
          </ButtonLink>
        </div>
        <p className="mt-2 text-center text-body-s text-ink-secondary">Sign in with a passkey or a wallet.</p>
        <p className="mt-2 text-body-s text-ink-secondary">{DISCLAIMER}</p>
      </div>
    </MenuSheet>
  );
}
