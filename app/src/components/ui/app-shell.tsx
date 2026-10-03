'use client';

import type { Address } from '@sleeve/core';
import { usePathname } from 'next/navigation';
import type { JSX, ReactNode } from 'react';

import { AppFooter } from '@/components/shell/app-footer';
import { BottomTabs } from '@/components/shell/bottom-tabs';
import { PaletteProvider } from '@/components/shell/command-palette';
import { AppRail } from '@/components/shell/rail';
import { ReceiveProvider } from '@/components/shell/receive';
import { currentSection, isCurrentPath, type NavItem, type SectionAlias } from '@/components/shell/sections';
import { SkipLink } from '@/components/shell/skip-link';
import { AppTopBar } from '@/components/shell/top-bar';
import { useSession } from '@/data/hooks';

import { cx } from './cx';
import { ToastProvider } from './toast';

export { isCurrentPath, type NavItem, type SectionAlias };

/**
 * The signed-in app's frame, closeout's product shell (docs/DESIGN.md 9 and 11.11, docs/design/closeout-product-
 * blueprint.md 2 and 15.1), with the D-024 places: Home, Payments, Holdings and Rule first; History and Check a split
 * after them.
 *
 * Below 768 px: the top bar, the page, the footer line, and a bottom bar with the four places plus More. From 768:
 * the rail on the shell (224 px, 262 px from 1024) and the page in a workspace panel with the top bar. The panel is
 * the page color, white in the light theme and one step above the shell in the dark one, so cards stand on it. The
 * top bar carries search, the market session, the spendable USDG, help, the theme, notifications, Receive and the
 * account; the rail carries the rule as a split and the market session card. While the session read is out, both
 * hold the account's room with placeholders; the page is at least a window tall, so the footer never jumps.
 *
 * Paths under FOCUSED_PATHS, such as onboarding, get a focused frame: no rail, no bottom bar and no search, the
 * wordmark, the session and a way back to the site (blueprint 15.9).
 *
 * The shell also mounts the toast provider, the Receive dialog and the search palette (⌘K, Ctrl K or "/"), and
 * tells toasts how far to sit above the bottom bar.
 */

export interface AppShellProps {
  children: ReactNode;
  /** The phone's bottom bar, and first in the rail. Four at most. */
  primaryNav: readonly NavItem[];
  /** Behind More on a phone, and lower in the rail. Never a gated feature. */
  secondaryNav?: readonly NavItem[];
  /** Paths that belong to a place without being in the navigation. */
  aliases?: readonly SectionAlias[];
  /** Overrides the signed-in account. Previews use it; the app reads the session. */
  account?: Address | null;
  /** Where the wordmark leads. Default /home. */
  homeHref?: string;
  /** Extra controls at the right end of the top bar. */
  topBarAction?: ReactNode;
  /** Overrides the path used to mark the current page. Previews use it; the app leaves it out. */
  currentPath?: string;
}

/** Flows that take the whole workspace, with nothing to wander off to. */
export const FOCUSED_PATHS: readonly string[] = ['/onboard'];

export function AppShell({
  children,
  primaryNav,
  secondaryNav = [],
  aliases = [],
  account,
  homeHref = '/home',
  topBarAction,
  currentPath,
}: AppShellProps): JSX.Element {
  const routerPath = usePathname();
  const pathname = currentPath ?? routerPath ?? '';
  const session = useSession();
  const owner = account !== undefined ? account : (session.data?.account ?? null);
  // Pending is not signed out: until the session read answers, the chrome holds the account's room.
  const pending = account === undefined && session.isPending;
  const focused = FOCUSED_PATHS.some((path) => isCurrentPath(pathname, path));
  const places = [...primaryNav, ...secondaryNav];
  const current = currentSection(pathname, places, aliases);

  return (
    <ReceiveProvider account={owner}>
      {/* The toast viewport renders inside the shell so it inherits --toast-inset, the room the bottom bar takes. */}
      <div
        className={cx(
          'flex flex-1 flex-col md:flex-row md:bg-shell md:[--toast-inset:0px]',
          focused ? '[--toast-inset:0px]' : '[--toast-inset:calc(var(--layout-bottom-nav)_+_env(safe-area-inset-bottom))]',
        )}
      >
        <ToastProvider>
          <PaletteProvider pages={places} account={owner} enabled={!focused}>
            <SkipLink />
            {focused ? null : (
              <AppRail
                primary={primaryNav}
                secondary={secondaryNav}
                current={current}
                account={owner}
                pending={pending}
                homeHref={homeHref}
              />
            )}
            <div
              className={cx(
                'flex min-w-0 flex-1 flex-col bg-canvas md:my-3 md:rounded-workspace md:shadow-workspace',
                focused ? 'md:mx-3' : 'md:mr-3',
              )}
            >
              <AppTopBar
                current={current}
                account={owner}
                pending={pending}
                homeHref={homeHref}
                focused={focused}
                action={topBarAction}
              />
              {/* At least a window tall, so the footer starts below the fold and data arriving never pushes it away. */}
              <main
                id="main-content"
                tabIndex={-1}
                className="min-h-[calc(100dvh-var(--sample-notice-height,0px))] min-w-0 flex-1 px-gutter pb-10 pt-5 focus-visible:outline-none md:pt-7"
              >
                {children}
              </main>
              <AppFooter />
            </div>
            {focused ? null : <BottomTabs primary={primaryNav} secondary={secondaryNav} current={current} />}
          </PaletteProvider>
        </ToastProvider>
      </div>
    </ReceiveProvider>
  );
}
