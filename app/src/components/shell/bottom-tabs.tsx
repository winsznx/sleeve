'use client';

import { CHAIN_ID, CHAIN_NAME } from '@sleeve/core';
import Link from 'next/link';
import { useState, type JSX } from 'react';

import { NetworkGlyph } from '@/components/token/glyphs';
import { cx } from '@/components/ui/cx';
import { Dialog } from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icons';

import { PaletteButton } from './command-palette';
import { NavIcon } from './glyphs';
import { ReceiveButton } from './receive';
import { SampleTag } from './sample-tag';
import type { CurrentSection, NavItem } from './sections';

/**
 * The phone's bottom bar below 768 px (docs/DESIGN.md 11.11, closeout's MobileNav): the four places, then More, which
 * opens a sheet with search, History, Check a split, the way back to the site and Receive. The bar is sticky to the
 * bottom of the shell rather than fixed, so it steps aside for the footer line at the end of a page.
 */

const ITEM =
  'flex min-h-touch min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-row px-0.5 text-micro transition-colors duration-fast ease-standard';
const IDLE = 'font-medium text-ink-secondary hover:text-ink';
const CURRENT = 'bg-surface-muted font-semibold text-ink';

export interface BottomTabsProps {
  primary: readonly NavItem[];
  secondary: readonly NavItem[];
  current: CurrentSection | null;
}

export function BottomTabs({ primary, secondary, current }: BottomTabsProps): JSX.Element {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreIsCurrent = secondary.some((item) => current?.item.href === item.href);

  return (
    <>
      <nav
        aria-label="Main"
        className="sticky bottom-0 z-nav border-t border-border bg-chrome pb-[env(safe-area-inset-bottom)] backdrop-blur-lg md:hidden [@media(prefers-reduced-transparency:reduce)]:bg-surface"
      >
        <ul className="flex min-h-bottom-nav items-stretch gap-1 px-2 py-1.5">
          {primary.map((item) => {
            const isCurrent = current?.item.href === item.href;
            return (
              <li key={item.href} className="flex min-w-0 flex-1">
                <Link href={item.href} aria-current={isCurrent ? 'page' : undefined} className={cx(ITEM, isCurrent ? CURRENT : IDLE)}>
                  <NavIcon name={item.icon} />
                  <span className="max-w-full truncate">{item.label}</span>
                </Link>
              </li>
            );
          })}
          {secondary.length === 0 ? null : (
            <li className="flex min-w-0 flex-1">
              <button
                type="button"
                aria-haspopup="dialog"
                aria-expanded={moreOpen}
                onClick={() => setMoreOpen(true)}
                className={cx(ITEM, moreIsCurrent ? CURRENT : IDLE)}
              >
                <Icon name="more" />
                More
              </button>
            </li>
          )}
        </ul>
      </nav>

      <Dialog open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
        <ul className="-mx-1 divide-y divide-border">
          <li>
            <PaletteButton look="menu" onOpen={() => setMoreOpen(false)} />
          </li>
          {secondary.map((item) => {
            const isCurrent = current?.item.href === item.href;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isCurrent ? 'page' : undefined}
                  onClick={() => setMoreOpen(false)}
                  className={cx(
                    'flex min-h-control-lg items-center gap-3 rounded-row px-2 text-body text-ink transition-colors duration-fast hover:bg-surface-muted',
                    isCurrent && 'font-semibold',
                  )}
                >
                  <NavIcon name={item.icon} className="text-ink-secondary" />
                  <span className="min-w-0 flex-1">{item.label}</span>
                  <Icon name="chevronRight" className="size-4 text-ink-muted" />
                </Link>
              </li>
            );
          })}
          <li>
            <Link
              href="/"
              onClick={() => setMoreOpen(false)}
              className="flex min-h-control-lg items-center gap-3 rounded-row px-2 text-body text-ink transition-colors duration-fast hover:bg-surface-muted"
            >
              <Icon name="external" className="text-ink-secondary" />
              <span className="min-w-0 flex-1">About Sleeve</span>
              <Icon name="chevronRight" className="size-4 text-ink-muted" />
            </Link>
          </li>
        </ul>
        <ReceiveButton look="menu" onOpen={() => setMoreOpen(false)} className="mt-4 w-full" />
        <p className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4 text-body-s text-ink-secondary">
          <NetworkGlyph className="size-4" />
          {CHAIN_NAME}, chain id {CHAIN_ID}
          <SampleTag />
        </p>
      </Dialog>
    </>
  );
}
