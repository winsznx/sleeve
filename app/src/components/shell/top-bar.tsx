'use client';

import type { Address } from '@sleeve/core';
import Link from 'next/link';
import type { JSX, ReactNode } from 'react';

import { ButtonLink } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { Wordmark } from '@/components/ui/wordmark';

import { AccountChip } from './account';
import { BalanceChip } from './balances';
import { PaletteButton } from './command-palette';
import { ReceiveButton } from './receive';
import type { CurrentSection } from './sections';
import { SessionPill } from './session-pill';

/**
 * The workspace's top bar (docs/design/inspiration.md 5.1): the breadcrumb on the left from 768 px, the wordmark on a
 * phone, and on the right search from 768 px, the market session pill, the spendable USDG from 1024 px, Receive, and
 * the account chip. Chips fold to icons as the room shrinks, after RainbowKit's responsive connect button.
 */

export interface AppTopBarProps {
  current: CurrentSection | null;
  account: Address | null;
  homeHref: string;
  /** A focused flow, such as onboarding: the wordmark and the session only, with a way back to the site. */
  focused: boolean;
  /** Extra controls at the right end, such as a page's own action. */
  action?: ReactNode;
}

function Breadcrumb({ current }: { current: CurrentSection }): JSX.Element {
  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-2 text-body-s md:flex">
      {current.trail === null ? (
        <span aria-current="page" className="truncate font-semibold text-ink">
          {current.item.label}
        </span>
      ) : (
        <>
          <Link href={current.item.href} className="shrink-0 text-ink-muted transition-colors duration-fast hover:text-ink">
            {current.item.label}
          </Link>
          <span aria-hidden="true" className="text-border-strong">
            /
          </span>
          <span aria-current="page" className="truncate font-semibold tabular-nums text-ink">
            {current.trail}
          </span>
        </>
      )}
    </nav>
  );
}

export function AppTopBar({ current, account, homeHref, focused, action }: AppTopBarProps): JSX.Element {
  return (
    <header className="flex min-h-topbar items-center gap-2 border-b border-border px-gutter sm:gap-3">
      <Wordmark href={focused ? '/' : homeHref} className={cx('shrink-0', !focused && 'md:hidden')} />
      {focused || current === null ? null : <Breadcrumb current={current} />}
      <div className="ml-auto flex min-w-0 items-center gap-1.5 sm:gap-2">
        {focused ? null : <PaletteButton look="bar" className="hidden md:inline-flex" />}
        <SessionPill className="min-w-0" />
        {focused ? (
          <ButtonLink href="/" variant="ghost" size="sm" className="shrink-0">
            Back to the site
          </ButtonLink>
        ) : account === null ? (
          <ButtonLink href="/onboard" size="sm" className="shrink-0">
            Sign in
          </ButtonLink>
        ) : (
          <>
            <BalanceChip account={account} className="hidden lg:block" />
            <ReceiveButton look="bar" />
            <AccountChip account={account} />
          </>
        )}
        {action === undefined ? null : <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>
    </header>
  );
}
