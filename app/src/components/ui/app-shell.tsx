'use client';

import { CHAIN_ID, CHAIN_NAME, shortAddress, type Address } from '@sleeve/core';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type JSX, type ReactNode } from 'react';

import { cx } from './cx';
import { Dialog } from './dialog';
import { Icon, type IconName } from './icons';
import { ToastProvider } from './toast';
import { Wordmark } from './wordmark';

/**
 * The signed-in app's frame, closeout's product shell (docs/DESIGN.md 9 and 11.11).
 *
 * Below 768 px: a top bar with the wordmark, the page, and a bottom bar with up to three destinations plus More,
 * which opens a sheet with the rest. From 768: the rail on the grey shell (224 px, 262 px from 1024) and the page
 * in a white workspace panel.
 *
 * The bottom bar is sticky to the bottom of the shell rather than fixed to the window. The root layout prints the
 * disclaimer footer after the shell, and a fixed bar would cover the end of it; a sticky bar stays at the bottom
 * of the screen while the page scrolls and steps aside when the footer comes into view.
 *
 * The shell also mounts the toast provider and tells toasts how far to sit above the bottom bar.
 */

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
}

export interface AppShellProps {
  children: ReactNode;
  /** Up to three destinations: the phone's bottom bar, and first in the rail. */
  primaryNav: readonly NavItem[];
  /** Behind More on a phone, and after the primary items in the rail. Never a gated feature. */
  secondaryNav?: readonly NavItem[];
  /** The signed-in account. The rail and the More sheet show its payment address in short form. */
  account?: Address | null;
  /** Where the wordmark leads. Default /home. */
  homeHref?: string;
  /** The right end of the top bar, such as a Receive button. */
  topBarAction?: ReactNode;
  /** Overrides the path used to mark the current page. Previews use it; the app leaves it out. */
  currentPath?: string;
}

const NETWORK_LINE = `${CHAIN_NAME}, chain id ${CHAIN_ID}`;

export function isCurrentPath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({
  children,
  primaryNav,
  secondaryNav = [],
  account = null,
  homeHref = '/home',
  topBarAction,
  currentPath,
}: AppShellProps): JSX.Element {
  const routerPath = usePathname();
  const pathname = currentPath ?? routerPath ?? '';
  const [moreOpen, setMoreOpen] = useState(false);
  const allItems = [...primaryNav, ...secondaryNav];
  const section = allItems.find((item) => isCurrentPath(pathname, item.href));
  const moreIsCurrent = secondaryNav.some((item) => isCurrentPath(pathname, item.href));

  return (
    // The toast viewport renders inside the shell so it inherits --toast-inset, the room the bottom bar takes.
    <div className="flex min-h-dvh flex-col [--toast-inset:calc(var(--layout-bottom-nav)_+_env(safe-area-inset-bottom))] md:flex-row md:bg-shell md:[--toast-inset:0px]">
      <ToastProvider>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-gutter focus:top-3 focus:z-toast focus:rounded-pill focus:bg-brand focus:px-4 focus:py-2.5 focus:text-body-s focus:font-medium focus:text-on-brand"
        >
          Skip to content
        </a>

        <Rail items={allItems} pathname={pathname} account={account} homeHref={homeHref} />

        <div className="flex min-w-0 flex-1 flex-col bg-canvas md:my-3 md:mr-3 md:rounded-workspace md:bg-surface md:shadow-workspace">
          <header className="flex min-h-topbar items-center justify-between gap-3 border-b border-border px-gutter">
            <div className="flex min-w-0 items-center">
              <Wordmark href={homeHref} className="md:hidden" />
              {section === undefined ? null : (
                <nav aria-label="Breadcrumb" className="hidden min-w-0 text-body-s md:block">
                  {pathname === section.href ? (
                    <span aria-current="page" className="font-semibold text-ink">
                      {section.label}
                    </span>
                  ) : (
                    <Link href={section.href} className="text-ink-muted transition-colors duration-fast hover:text-ink">
                      {section.label}
                    </Link>
                  )}
                </nav>
              )}
            </div>
            {topBarAction === undefined ? null : <div className="flex shrink-0 items-center gap-2">{topBarAction}</div>}
          </header>
          <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 px-gutter pb-10 pt-5 focus-visible:outline-none md:pt-7">
            {children}
          </main>
        </div>

        <nav
          aria-label="Main"
          className="sticky bottom-0 z-nav border-t border-border bg-chrome pb-[env(safe-area-inset-bottom)] backdrop-blur-lg md:hidden"
        >
          <ul className="flex min-h-bottom-nav items-stretch gap-1 px-2 py-1.5">
            {primaryNav.map((item) => (
              <li key={item.href} className="flex min-w-0 flex-1">
                <BottomLink item={item} current={isCurrentPath(pathname, item.href)} />
              </li>
            ))}
            {secondaryNav.length === 0 ? null : (
              <li className="flex min-w-0 flex-1">
                <button
                  type="button"
                  aria-haspopup="dialog"
                  aria-expanded={moreOpen}
                  onClick={() => setMoreOpen(true)}
                  className={cx(BOTTOM_ITEM, moreIsCurrent ? BOTTOM_ITEM_CURRENT : BOTTOM_ITEM_IDLE)}
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
            {secondaryNav.map((item) => {
              const current = isCurrentPath(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={current ? 'page' : undefined}
                    onClick={() => setMoreOpen(false)}
                    className={cx(
                      'flex min-h-control-lg items-center gap-3 rounded-row px-2 text-body transition-colors duration-fast hover:bg-surface-muted',
                      current ? 'font-semibold text-ink' : 'text-ink',
                    )}
                  >
                    <Icon name={item.icon} className="text-ink-secondary" />
                    <span className="min-w-0 flex-1">{item.label}</span>
                    <Icon name="chevronRight" className="size-4 text-ink-muted" />
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="mt-4 border-t border-border pt-4">
            {account === null ? null : (
              <p className="text-body-s text-ink">
                <span className="font-semibold">Payment address </span>
                <span className="font-mono text-mono-s text-ink-secondary">{shortAddress(account)}</span>
              </p>
            )}
            <p className="mt-1 text-body-s text-ink-secondary">{NETWORK_LINE}</p>
          </div>
        </Dialog>
      </ToastProvider>
    </div>
  );
}

const BOTTOM_ITEM =
  'flex min-h-touch min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-row text-micro transition-colors duration-fast ease-standard';
const BOTTOM_ITEM_IDLE = 'font-medium text-ink-secondary hover:text-ink';
const BOTTOM_ITEM_CURRENT = 'bg-surface-muted font-semibold text-ink';

function BottomLink({ item, current }: { item: NavItem; current: boolean }): JSX.Element {
  return (
    <Link
      href={item.href}
      aria-current={current ? 'page' : undefined}
      className={cx(BOTTOM_ITEM, current ? BOTTOM_ITEM_CURRENT : BOTTOM_ITEM_IDLE)}
    >
      <Icon name={item.icon} />
      <span className="max-w-full truncate">{item.label}</span>
    </Link>
  );
}

interface RailProps {
  items: readonly NavItem[];
  pathname: string;
  account: Address | null;
  homeHref: string;
}

function Rail({ items, pathname, account, homeHref }: RailProps): JSX.Element {
  return (
    <div className="sticky top-0 hidden max-h-dvh w-rail-compact shrink-0 flex-col self-start overflow-y-auto px-3 pb-5 pt-5 md:flex lg:w-rail lg:px-4">
      <div>
        <div className="px-2.5 pb-4">
          <Wordmark href={homeHref} />
        </div>
        {account === null ? null : (
          <div className="mb-5 rounded-row bg-shell-raised px-3 py-2.5">
            <p className="text-body-s font-semibold text-ink">Payment address</p>
            <p className="mt-0.5 font-mono text-mono-s text-ink-muted">{shortAddress(account)}</p>
          </div>
        )}
        <nav aria-label="Main">
          <ul className="flex flex-col gap-0.5">
            {items.map((item) => {
              const current = isCurrentPath(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={current ? 'page' : undefined}
                    className={cx(
                      'flex min-h-control-lg items-center gap-3 rounded-row px-3.5 text-body transition-colors duration-fast ease-standard',
                      current ? 'bg-surface font-semibold text-ink shadow-raised' : 'text-ink-secondary hover:bg-shell-raised hover:text-ink',
                    )}
                  >
                    <Icon name={item.icon} />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
      <p className="mt-6 border-t border-border px-2.5 pt-4 text-body-s text-ink-secondary">{NETWORK_LINE}</p>
    </div>
  );
}
