'use client';

import { useCallback, useEffect, useRef, useState, type FocusEvent, type JSX, type PointerEvent } from 'react';

import { NavIcon } from '@/components/shell/glyphs';
import { ProductPanel, ProofPanel } from '@/components/shell/marketing-menus';
import { MarketingSheet } from '@/components/shell/marketing-sheet';
import { NetworkChip } from '@/components/shell/network-chip';
import { OpenAppLink } from '@/components/shell/open-app-link';
import { SessionPill } from '@/components/shell/session-pill';
import styles from '@/components/shell/shell.module.css';
import { SiteLink } from '@/components/shell/site-link';
import { QUESTIONS_LINK } from '@/components/shell/site-map';
import { SkipLink } from '@/components/shell/skip-link';
import { HOVER_QUERY, useMediaQuery } from '@/components/shell/use-browser';
import { cx } from '@/components/ui/cx';
import { Icon } from '@/components/ui/icons';
import { Wordmark } from '@/components/ui/wordmark';

/**
 * The marketing navbar (docs/design/inspiration.md 4, D-024). Closeout's bar: the wordmark, two menus that preview
 * the product and its proof, the live market session, the network as words, and the black "Open the app" pill.
 *
 * At rest the bar is clear and 72 px tall. After the first 8 px of scroll it condenses to 60 px on a frosted chrome
 * with a hairline, and the network chip folds away. The lost height becomes a bottom margin, so nothing below moves.
 * Scroll is watched with an IntersectionObserver on a sentinel at the top of the page, never a scroll listener.
 *
 * The menus are disclosures, not ARIA menus: each trigger is a button with aria-expanded, and its panel follows it in
 * the tab order, so Tab walks from the trigger into the panel. A pointer that can hover opens them after 120 ms and
 * closes them 200 ms after leaving; a click pins one open. Escape closes and returns focus to the trigger; a press
 * outside the menus, or focus leaving the trigger and its panel, closes too. Below 1024 px a full-height sheet carries
 * the same content.
 */

type MenuId = 'product' | 'proof';

const MENUS: { id: MenuId; label: string }[] = [
  { id: 'product', label: 'Product' },
  { id: 'proof', label: 'Proof' },
];

const OPEN_DELAY_MS = 120;
const CLOSE_DELAY_MS = 200;

const TRIGGER =
  'inline-flex min-h-touch items-center gap-1 rounded-pill px-3.5 text-body-s font-medium transition-colors duration-fast ease-standard';

function panelId(id: MenuId): string {
  return `marketing-menu-${id}`;
}

export function MarketingHeader(): JSX.Element {
  const [condensed, setCondensed] = useState(false);
  const [menu, setMenu] = useState<MenuId | null>(null);
  const [swapped, setSwapped] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const canHover = useMediaQuery(HOVER_QUERY);
  const sentinel = useRef<HTMLSpanElement>(null);
  const nav = useRef<HTMLElement>(null);
  const triggers = useRef<Partial<Record<MenuId, HTMLButtonElement | null>>>({});
  const pinned = useRef(false);
  const timers = useRef<{ open?: ReturnType<typeof setTimeout>; close?: ReturnType<typeof setTimeout> }>({});

  const closeMenu = useCallback(() => {
    clearTimeout(timers.current.open);
    clearTimeout(timers.current.close);
    pinned.current = false;
    setMenu(null);
  }, []);

  // The sentinel sits in the first 8 px of the page; once it scrolls out of view the bar condenses.
  useEffect(() => {
    const node = sentinel.current;
    if (node === null || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setCondensed(entry !== undefined && !entry.isIntersecting));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // An open menu listens to the whole document: Escape anywhere, and presses outside the menus, the session pill and
  // the network chip included. The panels sit inside the nav in the DOM, so a press inside one keeps it open.
  useEffect(() => {
    if (menu === null) return;
    const open = menu;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      closeMenu();
      triggers.current[open]?.focus();
    }
    function onPointerDown(event: globalThis.PointerEvent) {
      const target = event.target;
      if (target instanceof Node && nav.current?.contains(target)) return;
      closeMenu();
    }
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [menu, closeMenu]);

  // Pending hover timers die with the header.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      clearTimeout(pending.open);
      clearTimeout(pending.close);
    };
  }, []);

  function clearTimers() {
    clearTimeout(timers.current.open);
    clearTimeout(timers.current.close);
  }

  function show(id: MenuId, pin: boolean) {
    clearTimers();
    pinned.current = pin;
    setSwapped(menu !== null && menu !== id);
    setMenu(id);
  }

  function handleTriggerClick(id: MenuId) {
    // A click on a menu the pointer already opened pins it; a click on a pinned menu closes it.
    if (menu === id && pinned.current) closeMenu();
    else show(id, true);
  }

  function handlePointerEnter(id: MenuId, event: PointerEvent<HTMLElement>) {
    if (!canHover || event.pointerType !== 'mouse' || pinned.current) return;
    clearTimers();
    timers.current.open = setTimeout(() => show(id, false), menu === null ? OPEN_DELAY_MS : 0);
  }

  function handlePointerLeave(event: PointerEvent<HTMLElement>) {
    if (!canHover || event.pointerType !== 'mouse' || pinned.current) return;
    clearTimeout(timers.current.open);
    timers.current.close = setTimeout(closeMenu, CLOSE_DELAY_MS);
  }

  function keepOpen() {
    clearTimeout(timers.current.close);
  }

  /** Focus that leaves a trigger and its panel for anything else closes that panel. */
  function handleMenuBlur(id: MenuId, event: FocusEvent<HTMLElement>) {
    const next = event.relatedTarget;
    if (menu !== id || next === null) return;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    closeMenu();
  }

  const lit = menu !== null;

  return (
    <>
      <span ref={sentinel} aria-hidden="true" className="pointer-events-none absolute left-0 top-0 h-2 w-px" />
      <header
        data-condensed={condensed}
        className={cx(
          'sticky top-0 z-header border-b transition-colors duration-standard ease-standard motion-safe:transition-[background-color,border-color,margin] md:top-[var(--sample-notice-height,0px)]',
          lit
            ? 'border-border bg-surface'
            : condensed
              ? 'border-border bg-chrome backdrop-blur-lg [@media(prefers-reduced-transparency:reduce)]:bg-surface [@media(prefers-reduced-transparency:reduce)]:backdrop-blur-none'
              : 'border-transparent bg-transparent',
          condensed ? 'mb-1.5 lg:mb-3' : 'mb-0',
        )}
      >
        <SkipLink />
        <div
          className={cx(
            'mx-auto flex w-full max-w-content items-center gap-3 px-gutter motion-safe:transition-[height] motion-safe:duration-standard motion-safe:ease-standard',
            condensed ? 'h-14 lg:h-[3.75rem]' : 'h-[3.875rem] lg:h-[4.5rem]',
          )}
        >
          <Wordmark href="/" className="shrink-0" />
          <nav ref={nav} aria-label="Main" className="ml-5 hidden items-center gap-1 lg:flex">
            {MENUS.map(({ id, label }) => {
              const open = menu === id;
              return (
                <div key={id} className="contents" onBlur={(event) => handleMenuBlur(id, event)}>
                  <button
                    ref={(node) => {
                      triggers.current[id] = node;
                    }}
                    type="button"
                    aria-expanded={open}
                    aria-controls={open ? panelId(id) : undefined}
                    onClick={() => handleTriggerClick(id)}
                    onPointerEnter={(event) => handlePointerEnter(id, event)}
                    onPointerLeave={handlePointerLeave}
                    className={cx(TRIGGER, open ? 'bg-surface-muted text-ink' : 'text-ink-secondary hover:bg-surface-muted hover:text-ink')}
                  >
                    {label}
                    <Icon
                      name="chevronDown"
                      className={cx('size-3.5 transition-transform duration-fast ease-standard', open && 'rotate-180')}
                    />
                  </button>
                  {open ? (
                    // The panel continues the bar's white surface downward, full width under the header (Stripe).
                    <div className="absolute inset-x-0 top-full" onPointerEnter={keepOpen} onPointerLeave={handlePointerLeave}>
                      <div className="mx-auto w-full max-w-content px-gutter">
                        <div
                          id={panelId(id)}
                          role="region"
                          aria-label={label}
                          className={cx(
                            swapped ? styles.panelSwap : styles.panel,
                            'overflow-hidden rounded-b-card border-x border-b border-border bg-surface shadow-overlay',
                          )}
                        >
                          {id === 'product' ? <ProductPanel onNavigate={closeMenu} /> : <ProofPanel onNavigate={closeMenu} />}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
            <SiteLink href={QUESTIONS_LINK.href} className={cx(TRIGGER, 'text-ink-secondary hover:bg-surface-muted hover:text-ink')}>
              {QUESTIONS_LINK.label}
            </SiteLink>
          </nav>
          <div className="ml-auto flex min-w-0 items-center gap-2">
            <NetworkChip className={cx('hidden', condensed ? 'xl:hidden' : 'xl:block')} />
            <SessionPill className="min-w-0" />
            <OpenAppLink className="hidden sm:inline-flex" />
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={sheetOpen}
              aria-label="Menu"
              onClick={() => setSheetOpen(true)}
              className="inline-flex size-touch shrink-0 items-center justify-center rounded-pill border border-border bg-surface text-ink transition-colors duration-fast ease-standard hover:border-border-strong lg:hidden"
            >
              <NavIcon name="menu" />
            </button>
          </div>
        </div>
      </header>
      <MarketingSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </>
  );
}
