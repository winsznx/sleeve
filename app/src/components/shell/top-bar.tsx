'use client';

import type { Address } from '@sleeve/core';
import Link from 'next/link';
import type { JSX, ReactNode } from 'react';

import { NotificationBell } from '@/components/notifications/notification-bell';
import { ButtonLink } from '@/components/ui/button';
import { buttonClasses } from '@/components/ui/button-styles';
import { cx } from '@/components/ui/cx';
import { Wordmark } from '@/components/ui/wordmark';

import { AccountChip } from './account';
import { BalanceChip } from './balances';
import { PaletteButton } from './command-palette';
import { ReceiveButton } from './receive';
import type { CurrentSection } from './sections';
import { SessionPill } from './session-pill';
import { ThemeToggle } from './theme-switch';

/**
 * The workspace's top bar (docs/design/inspiration.md 5.1): the breadcrumb on the left from 768 px, the wordmark on a
 * phone, and on the right search from 768 px, the market session pill, the spendable USDG from 1024 px, the theme
 * switch from 768 px, the notification bell, Receive, and the account chip. Chips fold to icons as the room shrinks,
 * after RainbowKit's responsive connect button. Help sits in the rail and, with the theme, behind More on a phone.
 *
 * While the session read is pending the account's controls are placeholders of the same size, never a "Sign in" that
 * a signed-in owner would see flash, and Sign in appears only once the read says nobody is signed in.
 */

export interface AppTopBarProps {
  current: CurrentSection | null;
  account: Address | null;
  /** The session read has not answered yet, so the account is not known to be missing. */
  pending: boolean;
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

/** The account's controls at their loaded sizes, while the session read is out. */
function AccountPlaceholder(): JSX.Element {
  return (
    <span aria-busy="true" className="flex shrink-0 items-center gap-1.5 sm:gap-2">
      <span className="sr-only">Loading your account</span>
      <span aria-hidden="true" className="hidden h-control-sm w-40 rounded-pill bg-skeleton lg:block" />
      <span aria-hidden="true" className="block size-touch rounded-pill bg-skeleton md:size-control-sm" />
      <span aria-hidden="true" className="block size-touch rounded-pill bg-skeleton md:size-control-sm xl:w-28" />
      <span aria-hidden="true" className="block size-touch rounded-pill bg-skeleton md:h-control-sm md:w-12 xl:w-[12.5rem]" />
    </span>
  );
}

export function AppTopBar({ current, account, pending, homeHref, focused, action }: AppTopBarProps): JSX.Element {
  let owner: ReactNode;
  if (focused) {
    owner = (
      <ButtonLink href="/" variant="ghost" size="sm" className="shrink-0">
        Back to the site
      </ButtonLink>
    );
  } else if (account !== null) {
    owner = (
      <>
        <BalanceChip account={account} className="hidden lg:block" />
        <ThemeToggle className="hidden md:inline-flex" />
        <NotificationBell account={account} />
        <ReceiveButton look="bar" />
        <AccountChip account={account} />
      </>
    );
  } else if (pending) {
    owner = <AccountPlaceholder />;
  } else {
    // Onboarding loads the wallet stack, so the link never prefetches it for a visitor who may not follow it.
    owner = (
      <>
        <ThemeToggle className="hidden md:inline-flex" />
        <Link href="/onboard" prefetch={false} className={buttonClasses({ size: 'sm', className: 'shrink-0' })}>
          Sign in
        </Link>
      </>
    );
  }

  return (
    <header className="flex min-h-topbar items-center gap-2 border-b border-border px-gutter sm:gap-3">
      <Wordmark href={focused ? '/' : homeHref} className={cx('shrink-0', !focused && 'md:hidden')} />
      {focused || current === null ? null : <Breadcrumb current={current} />}
      <div className="ml-auto flex min-w-0 items-center gap-1.5 sm:gap-2">
        {focused ? null : <PaletteButton look="bar" className="hidden md:inline-flex" />}
        <SessionPill className="min-w-0" />
        {owner}
        {action === undefined ? null : <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>
    </header>
  );
}
