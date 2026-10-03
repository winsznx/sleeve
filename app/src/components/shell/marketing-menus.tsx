'use client';

import type { JSX, ReactNode } from 'react';

import { TokenIcon } from '@/components/token/token-icon';
import { TokenPair } from '@/components/token/token-stack';
import { cx } from '@/components/ui/cx';
import { Icon } from '@/components/ui/icons';

import { NavIcon } from './glyphs';
import { PaydayCard } from './payday-card';
import { SampleTag } from './sample-tag';
import { SiteLink } from './site-link';
import {
  DISCLOSURE_PATH,
  isExternal,
  LANDING_ANCHORS,
  PRODUCT_LINKS,
  proofLinks,
  type MenuLink,
  type ProductKey,
  type ProofKey,
} from './site-map';
import { SplitCheckForm } from './split-check-form';
import { followedTicker, useMarketSession, useOwnerRule } from './use-market-session';

/**
 * What the Product and Proof menus hold, shared by the desktop panels and the phone sheet (D-024): the payday split
 * first, proof behind it. Each item carries a tile, closeout's provider tile, holding a real token icon where the item
 * is about a token and a line glyph otherwise.
 */

const TILE = 'grid size-icon-tile shrink-0 place-items-center rounded-row border border-border bg-surface text-ink-secondary';

const PRODUCT_VISUAL: Record<ProductKey, ReactNode> = {
  how: <TokenIcon token="USDG" size="md" decorative />,
  sleeves: <TokenPair from="USDG" to="SPY" size="sm" decorative />,
  rule: <NavIcon name="rule" />,
  holdings: <TokenPair from="SPY" to="USDG" size="sm" decorative />,
};

const PROOF_VISUAL: Record<ProofKey, ReactNode> = {
  check: <NavIcon name="verify" />,
  replay: <NavIcon name="clock" />,
  security: <NavIcon name="audit" />,
  gates: <NavIcon name="gate" />,
};

function MenuItem<K extends string>({
  link,
  visual,
  onNavigate,
}: {
  link: MenuLink<K>;
  visual: ReactNode;
  onNavigate?: () => void;
}): JSX.Element {
  const external = isExternal(link.href);
  return (
    <li>
      <SiteLink
        href={link.href}
        onNavigate={onNavigate}
        className="group flex min-h-touch gap-3.5 rounded-row p-3 transition-colors duration-fast ease-standard hover:bg-surface-muted focus-visible:-outline-offset-2"
      >
        <span className={TILE}>{visual}</span>
        <span className="min-w-0 pt-0.5">
          <span className="flex items-center gap-1 text-body font-medium text-ink">
            {link.title}
            {external ? <Icon name="external" className="size-4 text-ink-secondary" /> : null}
            {external ? <span className="sr-only">, opens the source on another site</span> : null}
          </span>
          <span className="mt-0.5 block text-body-s text-ink-secondary">{link.description}</span>
        </span>
      </SiteLink>
    </li>
  );
}

export function ProductItems({ onNavigate, className }: { onNavigate?: () => void; className?: string }): JSX.Element {
  return (
    <ul className={cx('grid gap-1', className)}>
      {PRODUCT_LINKS.map((link) => (
        <MenuItem key={link.key} link={link} visual={PRODUCT_VISUAL[link.key]} onNavigate={onNavigate} />
      ))}
    </ul>
  );
}

export function ProofItems({ onNavigate, className }: { onNavigate?: () => void; className?: string }): JSX.Element {
  return (
    <ul className={cx('grid gap-1', className)}>
      {proofLinks().map((link) => (
        <MenuItem key={link.key} link={link} visual={PROOF_VISUAL[link.key]} onNavigate={onNavigate} />
      ))}
    </ul>
  );
}

const FOOTER_LINK =
  'inline-flex min-h-touch shrink-0 items-center gap-1 font-medium text-link underline underline-offset-4 hover:text-link-hover';

/** The live sentence under the Product menu: what the market means for a payment arriving now. */
function SessionSentence(): JSX.Element {
  const read = useMarketSession(followedTicker(useOwnerRule()));
  if (read.status !== 'ready') return <span>When the market is closed, the equity share waits as USDG and buys at the open.</span>;
  if (read.view.state === 'open') {
    return (
      <span>
        {read.words.title}. A payment that arrives now can buy its Stock Token within the price cap
        {read.words.when === null ? '' : ` until ${read.words.when} New York time`}.
      </span>
    );
  }
  return (
    <span>
      {read.words.title}. The equity share of a payment that arrives now waits as USDG
      {read.words.when === null ? ' until the market opens' : ` until ${read.words.when} New York time`}.
    </span>
  );
}

export function ProductPanel({ onNavigate }: { onNavigate: () => void }): JSX.Element {
  return (
    <>
      <div className="grid grid-cols-[minmax(0,1fr)_20rem] gap-6 p-6">
        <ProductItems onNavigate={onNavigate} className="grid-cols-2 content-start" />
        <div className="rounded-module bg-surface-muted p-4">
          <PaydayCard />
        </div>
      </div>
      <div className="flex items-center justify-between gap-6 border-t border-border bg-surface px-6 py-2 text-body-s text-ink-secondary">
        <SessionSentence />
        <SiteLink href={`/#${LANDING_ANCHORS.tickers}`} onNavigate={onNavigate} className={FOOTER_LINK}>
          See the launch Stock Tokens
        </SiteLink>
      </div>
    </>
  );
}

export function ProofPanel({ onNavigate }: { onNavigate: () => void }): JSX.Element {
  return (
    <>
      <div className="grid grid-cols-[minmax(0,1fr)_20rem] gap-6 p-6">
        <ProofItems onNavigate={onNavigate} className="grid-cols-2 content-start" />
        <div className="rounded-module bg-surface-muted p-4">
          <div className="rounded-module bg-surface p-4 shadow-soft">
            <div className="flex items-start justify-between gap-3">
              <p className="text-body-s font-medium text-ink">Check a split now</p>
              <SampleTag />
            </div>
            <SplitCheckForm className="mt-2" />
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-6 border-t border-border bg-surface px-6 py-2 text-body-s text-ink-secondary">
        <span>Every buy, wait and release writes its receipt on chain in the same transaction.</span>
        <SiteLink href={DISCLOSURE_PATH} onNavigate={onNavigate} className={FOOTER_LINK}>
          Read the issuer disclosure
        </SiteLink>
      </div>
    </>
  );
}
