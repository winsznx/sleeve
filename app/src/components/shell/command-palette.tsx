'use client';

import { formatFeedPrice, shortAddress, tickerById, type Address } from '@sleeve/core';
import { useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type JSX,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react';

import { receiptSentence, receiptTitle, tickerSymbol } from '@/components/sleeve/text';
import { TickerIcon } from '@/components/token/ticker-icon';
import { StatusTag } from '@/components/ui/badge';
import { IconButton } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { DebtSecurityLine } from '@/components/ui/debt-security-line';
import { formatUtc } from '@/components/ui/format-time';
import { useToast } from '@/components/ui/toast';
import { useMarket, useReceipt } from '@/data/hooks';
import { DATA_SOURCE } from '@/data/source';

import { NavIcon, type NavIconName } from './glyphs';
import { TickerFacts } from './markets-panel';
import { flattenGroups, paletteGroups, type DetailsItem, type PaletteItem, type TickerItem } from './palette-items';
import { useOpenReceive } from './receive';
import { SampleTag, SessionMark } from './sample-tag';
import type { NavItem } from './sections';
import styles from './shell.module.css';
import { useMarketSession } from './use-market-session';

/**
 * The search palette (docs/design/inspiration.md 5.6, after Raycast, Linear and TradingView): ⌘K on a Mac, Ctrl K
 * elsewhere, or "/" outside a text field. It finds the app's pages, a few actions, the launch Stock Tokens with their
 * reference price, and an action by its number. From 1024 px a preview pane shows the highlighted item: a Stock
 * Token's pool quote and reference apart (PRD 7.11), or an action's status and sentence. Gated features never appear.
 *
 * It is a combobox over a grouped listbox in a native <dialog>: the input keeps focus, the arrow keys move the
 * highlight, Enter runs it, Escape closes and focus goes back to where it was.
 */

const PaletteContext = createContext<(() => void) | null>(null);

/** Opens the palette, or null outside the app shell. */
export function usePaletteOpener(): (() => void) | null {
  return useContext(PaletteContext);
}

function subscribeToNothing(): () => void {
  return () => undefined;
}

function platformHint(): string {
  return /Mac|iPhone|iPad|iPod/.test(navigator.userAgent) ? '⌘K' : 'Ctrl K';
}

/** The shortcut as this device writes it, known only after hydration so the server never guesses the platform. */
export function useShortcutHint(): string | null {
  return useSyncExternalStore(subscribeToNothing, platformHint, () => null);
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
}

export interface PaletteProviderProps {
  /** The app's places, in the order the palette lists them. */
  pages: readonly NavItem[];
  account: Address | null;
  /** Off in focused flows such as onboarding, where there is nowhere else to go. */
  enabled?: boolean;
  children: ReactNode;
}

export function PaletteProvider({ pages, account, enabled = true, children }: PaletteProviderProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const openPalette = useCallback(() => setOpen(true), []);

  // The shortcuts are document key events, outside React's tree. ⌘K and Ctrl K toggle the palette unless another
  // dialog is open; "/" only opens it, and only when focus is not in a field and no dialog is open.
  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing) return;
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
        if (document.querySelector('dialog[open]:not([data-palette])') !== null) return;
        event.preventDefault();
        setOpen((current) => !current);
        return;
      }
      if (event.key !== '/' || modifier || event.altKey || isTypingTarget(event.target)) return;
      if (document.querySelector('dialog[open]') !== null) return;
      event.preventDefault();
      setOpen(true);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [enabled]);

  return (
    <PaletteContext.Provider value={enabled ? openPalette : null}>
      {children}
      {enabled ? <CommandPalette open={open} onClose={() => setOpen(false)} pages={pages} account={account} /> : null}
    </PaletteContext.Provider>
  );
}

const BAR_BUTTON =
  'inline-flex size-touch shrink-0 items-center justify-center gap-1.5 rounded-pill border border-border bg-surface text-body-s text-ink-secondary transition-colors duration-fast ease-standard hover:border-border-strong hover:text-ink md:size-10 min-[1440px]:w-auto min-[1440px]:pl-3 min-[1440px]:pr-1.5';

/**
 * Opens the palette. "bar" is the top bar's chip: the lens alone, and from 1440 px, where the bar has the room, the
 * lens with the shortcut beside it, after TradingView's field. "menu" is a row in the phone's More sheet.
 */
export function PaletteButton({
  look,
  onOpen,
  className,
}: {
  look: 'bar' | 'menu';
  onOpen?: () => void;
  className?: string;
}): JSX.Element | null {
  const openPalette = usePaletteOpener();
  const hint = useShortcutHint();
  if (openPalette === null) return null;
  function handleClick() {
    onOpen?.();
    openPalette?.();
  }
  if (look === 'menu') {
    return (
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={handleClick}
        className={cx(
          'flex min-h-control-lg w-full items-center gap-3 rounded-row px-2 text-left text-body text-ink transition-colors duration-fast hover:bg-surface-muted',
          className,
        )}
      >
        <NavIcon name="search" className="text-ink-secondary" />
        <span className="min-w-0 flex-1">Search</span>
        <NavIcon name="chevronRight" className="size-4 text-ink-muted" />
      </button>
    );
  }
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-label="Search"
      aria-keyshortcuts="Meta+K Control+K /"
      onClick={handleClick}
      className={cx(BAR_BUTTON, className)}
    >
      <NavIcon name="search" className="size-[1.125rem]" />
      {hint === null ? null : (
        <kbd
          aria-hidden="true"
          className="hidden rounded-control border border-border bg-surface-muted px-1.5 py-0.5 font-sans text-label font-medium text-ink-secondary min-[1440px]:inline"
        >
          {hint}
        </kbd>
      )}
    </button>
  );
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  pages: readonly NavItem[];
  account: Address | null;
}

/** The palette's native dialog. The body mounts only while it is open, so every opening starts from an empty query. */
function CommandPalette({ open, onClose, pages, account }: CommandPaletteProps): JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const pressStartedOnScrim = useRef(false);

  // Keeps the native dialog in step with the open prop: showModal and close are browser APIs outside React.
  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open) {
      if (!dialog.open) {
        opener.current = document.activeElement;
        dialog.showModal();
      }
      return;
    }
    if (!dialog.open) return;
    dialog.close();
    const target = opener.current;
    opener.current = null;
    if (target instanceof HTMLElement && target.isConnected) target.focus({ preventScroll: true });
  }, [open]);

  // While it is open the page behind does not scroll.
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      root.style.overflow = previous;
    };
  }, [open]);

  function handleCancel(event: SyntheticEvent<HTMLDialogElement>) {
    event.preventDefault();
    onClose();
  }

  function handleNativeClose() {
    if (open) onClose();
  }

  function handlePointerDown(event: PointerEvent<HTMLDialogElement>) {
    pressStartedOnScrim.current = event.target === event.currentTarget;
  }

  function handleClick(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === event.currentTarget && pressStartedOnScrim.current) onClose();
    pressStartedOnScrim.current = false;
  }

  return (
    <dialog
      ref={ref}
      data-palette=""
      aria-label="Search"
      aria-modal="true"
      onCancel={handleCancel}
      onClose={handleNativeClose}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      className={cx(
        styles.scrim,
        'fixed inset-0 z-overlay m-0 h-dvh max-h-none w-full max-w-none overflow-hidden bg-scrim p-0 text-ink backdrop:bg-transparent open:flex open:flex-col md:open:items-center md:open:px-gutter md:open:pt-[12vh]',
      )}
    >
      {open ? <PaletteBody pages={pages} account={account} onClose={onClose} /> : null}
    </dialog>
  );
}

function optionDomId(base: string, item: PaletteItem): string {
  return `${base}-${item.key}`;
}

function PaletteBody({ pages, account, onClose }: Omit<CommandPaletteProps, 'open'>): JSX.Element {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const router = useRouter();
  const toast = useToast();
  const openReceive = useOpenReceive();
  const base = useId();
  const listboxId = `${base}-listbox`;

  const groups = paletteGroups({ query, pages, signedIn: account !== null });
  const items = flattenGroups(groups);
  const activeIndex = items.length === 0 ? -1 : Math.min(active, items.length - 1);
  const activeItem = activeIndex === -1 ? null : (items[activeIndex] ?? null);

  async function copyAddress(address: Address) {
    try {
      if (typeof navigator === 'undefined' || navigator.clipboard === undefined) throw new Error('No clipboard here');
      await navigator.clipboard.writeText(address);
      toast.show({ title: 'Payment address copied', body: shortAddress(address) });
    } catch {
      toast.show({ tone: 'danger', title: 'Copy failed', body: 'Open Receive to copy your payment address by hand.' });
    }
  }

  function run(item: PaletteItem) {
    onClose();
    if (item.kind !== 'command') {
      router.push(item.href);
      return;
    }
    if (item.command === 'receive') openReceive?.();
    else if (account !== null) void copyAddress(account);
  }

  function highlight(index: number) {
    setActive(index);
    const item = items[index];
    if (item !== undefined) document.getElementById(optionDomId(base, item))?.scrollIntoView({ block: 'nearest' });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (items.length === 0) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      highlight((activeIndex + step + items.length) % items.length);
      return;
    }
    if (event.key === 'Enter' && activeItem !== null) {
      event.preventDefault();
      run(activeItem);
    }
  }

  return (
    <div
      className={cx(
        styles.palette,
        'flex h-full w-full flex-col overflow-hidden bg-surface md:h-auto md:max-h-[min(38rem,80dvh)] md:max-w-[40rem] md:rounded-card md:shadow-overlay lg:max-w-[50rem]',
      )}
    >
      <div className="flex min-h-16 shrink-0 items-center gap-3 border-b border-border pl-4 pr-2 transition-colors duration-fast focus-within:border-focus md:pr-3">
        <NavIcon name="search" className="text-ink-secondary" />
        {/* No autoFocus: it would move focus before the dialog records where focus was. showModal focuses the
            first control, this input; the row's green rule marks it as focused in place of a ring. */}
        <input
          role="combobox"
          aria-label="Search Sleeve"
          aria-expanded="true"
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeItem === null ? undefined : optionDomId(base, activeItem)}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="go"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Search pages, Stock Tokens or an action number"
          className="min-h-touch min-w-0 flex-1 bg-transparent text-input text-ink outline-none placeholder:text-ink-muted focus-visible:outline-none"
        />
        <kbd
          aria-hidden="true"
          className="hidden rounded-control border border-border bg-surface-muted px-1.5 py-0.5 font-sans text-label font-medium text-ink-secondary md:inline"
        >
          Esc
        </kbd>
        <IconButton icon="close" label="Close search" onClick={onClose} className="md:hidden" />
      </div>
      <p role="status" className="sr-only">
        {items.length === 0 ? 'No results' : `${items.length} ${items.length === 1 ? 'result' : 'results'}`}
      </p>
      <div className="flex min-h-0 flex-1">
        <div
          id={listboxId}
          role="listbox"
          aria-label="Results"
          className="min-w-0 flex-1 overflow-y-auto overscroll-contain p-2 md:max-h-[26rem]"
        >
          {groups.length === 0 ? (
            <p className="px-3 py-10 text-center text-body-s text-ink-secondary">
              Nothing matches. Try a page, a ticker such as SPY, or an action number.
            </p>
          ) : (
            groups.map((group) => {
              const labelId = `${base}-group-${group.key}`;
              return (
                <div key={group.key} role="group" aria-labelledby={labelId} className="pb-1.5 [&+&]:border-t [&+&]:border-border [&+&]:pt-1.5">
                  <p id={labelId} role="presentation" className="px-3 pb-1 pt-2 text-label font-medium text-ink-secondary">
                    {group.label}
                  </p>
                  {group.items.map((item) => {
                    const index = items.indexOf(item);
                    const isActive = index === activeIndex;
                    return (
                      <div
                        key={item.key}
                        id={optionDomId(base, item)}
                        role="option"
                        aria-selected={isActive}
                        onPointerMove={() => {
                          if (!isActive) setActive(index);
                        }}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => run(item)}
                        className={cx(
                          'flex min-h-touch cursor-pointer items-center gap-3 rounded-row px-3 py-2 transition-colors duration-fast ease-standard',
                          isActive ? 'bg-surface-muted' : undefined,
                        )}
                      >
                        <ItemVisual item={item} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-body font-medium text-ink">{item.label}</span>
                          <span className="block truncate text-body-s text-ink-secondary">
                            <ItemLine item={item} />
                          </span>
                        </span>
                        {item.kind === 'ticker' ? <ReferencePrice item={item} /> : null}
                        <NavIcon name="enter" className={cx('size-4 shrink-0 text-ink-secondary', isActive ? 'opacity-100' : 'opacity-0')} />
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
        <aside aria-label="Preview" className="hidden w-[18rem] shrink-0 overflow-y-auto border-l border-border bg-surface-muted p-5 lg:block">
          {activeItem === null ? null : <Preview item={activeItem} account={account} />}
        </aside>
      </div>
      <div
        className={cx(
          'shrink-0 items-center justify-between gap-4 border-t border-border px-4 py-2.5 text-body-s text-ink-secondary',
          DATA_SOURCE === 'mock' ? 'flex' : 'hidden md:flex',
        )}
      >
        <p className="hidden items-center gap-4 md:flex">
          <span className="inline-flex items-center gap-1.5">
            <Key>↑</Key>
            <Key>↓</Key>
            to move
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Key>Enter</Key>
            to open
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Key>Esc</Key>
            to close
          </span>
        </p>
        <SampleTag />
      </div>
    </div>
  );
}

function Key({ children }: { children: ReactNode }): JSX.Element {
  return (
    <kbd className="inline-flex min-w-6 justify-center rounded-control border border-border bg-surface px-1.5 py-0.5 font-sans text-label font-medium text-ink-secondary">
      {children}
    </kbd>
  );
}

const TILE = 'grid size-8 shrink-0 place-items-center rounded-control border border-border bg-surface text-ink-secondary';

function ItemVisual({ item }: { item: PaletteItem }): JSX.Element {
  if (item.kind === 'ticker') {
    return (
      <span className="grid size-8 shrink-0 place-items-center">
        <TickerIcon tickerId={item.tickerId} size="md" />
      </span>
    );
  }
  if (item.kind === 'details' || item.kind === 'check') {
    return (
      <span aria-hidden="true" className={TILE}>
        <NavIcon name={item.kind === 'details' ? 'receipt' : 'verify'} className="size-4" />
      </span>
    );
  }
  return (
    <span aria-hidden="true" className={TILE}>
      <NavIcon name={item.icon} className="size-4" />
    </span>
  );
}

/** The option's second line. An action looked up by number shows what it was once it loads. */
function ItemLine({ item }: { item: PaletteItem }): JSX.Element {
  if (item.kind === 'details') return <DetailsLine item={item} />;
  return <>{item.description}</>;
}

function DetailsLine({ item }: { item: DetailsItem }): JSX.Element {
  const receipt = useReceipt(item.receiptId);
  if (receipt.data === undefined) return <>{receipt.isError ? 'Did not load. Open it to try again.' : 'Looking it up.'}</>;
  if (receipt.data === null) return <>No action with this number yet.</>;
  return <>{receiptTitle(receipt.data)}</>;
}

/** The Chainlink reference beside a ticker, the way a token list shows a price. No change, no color. */
function ReferencePrice({ item }: { item: TickerItem }): JSX.Element | null {
  const market = useMarket();
  const ticker = market.data?.tickers.find((candidate) => candidate.tickerId === item.tickerId);
  if (ticker === undefined) return null;
  return (
    <span className="shrink-0 text-right text-body-s tabular-nums text-ink">
      {formatFeedPrice(ticker.feed.answer)}
      <span className="text-ink-secondary"> USD</span>
    </span>
  );
}

function Preview({ item, account }: { item: PaletteItem; account: Address | null }): JSX.Element {
  switch (item.kind) {
    case 'ticker':
      return <TickerPreview item={item} />;
    case 'details':
      return <DetailsPreview item={item} />;
    case 'check':
      return (
        <PreviewText icon="verify" title={item.label}>
          The public page reads #{item.receiptId.toString()} from Robinhood Chain again and recomputes every field. Anyone can open
          it, signed in or not.
        </PreviewText>
      );
    case 'command':
      return (
        <PreviewText icon={item.icon} title={item.label}>
          {item.description}
          {account === null ? null : <span className="mt-3 block break-all font-mono text-mono-s text-ink">{account}</span>}
        </PreviewText>
      );
    case 'page':
      return (
        <PreviewText icon={item.icon} title={item.label}>
          {item.description}
        </PreviewText>
      );
  }
}

function PreviewText({ icon, title, children }: { icon: NavIconName; title: string; children: ReactNode }): JSX.Element {
  return (
    <div>
      <span aria-hidden="true" className="grid size-icon-tile place-items-center rounded-row border border-border bg-surface text-ink-secondary">
        <NavIcon name={icon} />
      </span>
      <p className="mt-3 text-h3 text-ink">{title}</p>
      <div className="mt-1.5 text-body-s text-ink-secondary">{children}</div>
    </div>
  );
}

function TickerPreview({ item }: { item: TickerItem }): JSX.Element {
  const read = useMarketSession(item.tickerId);
  const name = tickerById(item.tickerId)?.name ?? '';
  return (
    <div>
      <div className="flex items-center gap-3">
        <TickerIcon tickerId={item.tickerId} size="xl" />
        <div className="min-w-0">
          <p className="text-h3 text-ink">{tickerSymbol(item.tickerId)}</p>
          <p className="truncate text-body-s text-ink-secondary">{name}</p>
        </div>
      </div>
      <DebtSecurityLine className="mt-3" />
      {read.status === 'ready' ? (
        <>
          <p className="mt-4 flex items-center gap-2 text-body-s font-medium text-ink">
            <SessionMark tone={read.words.tone} />
            {read.words.title}
            {read.words.countdown === null ? null : <span className="font-normal text-ink-secondary">{read.words.countdown}</span>}
          </p>
          <TickerFacts market={read.market} className="mt-3" />
        </>
      ) : (
        <p className="mt-4 text-body-s text-ink-secondary">
          {read.status === 'error' ? 'Market data did not load.' : 'Reading the market.'}
        </p>
      )}
    </div>
  );
}

function DetailsPreview({ item }: { item: DetailsItem }): JSX.Element {
  const receipt = useReceipt(item.receiptId);
  const number = `#${item.receiptId.toString()}`;
  if (receipt.data === undefined) {
    return receipt.isError ? (
      <PreviewText icon="alert" title={`${number} did not load`}>
        Open it to try again, or check it on the public page.
      </PreviewText>
    ) : (
      <div aria-busy="true" className="space-y-2.5">
        <span className="sr-only">Looking up {number}</span>
        <span className="block h-5 w-20 rounded-xs bg-skeleton" />
        <span className="block h-4 w-4/5 rounded-xs bg-skeleton" />
        <span className="block h-4 w-3/5 rounded-xs bg-skeleton" />
      </div>
    );
  }
  if (receipt.data === null) {
    return (
      <PreviewText icon="receipt" title={`No action ${number} yet`}>
        Action numbers count up across all of Sleeve. The public page can check any number once it exists.
      </PreviewText>
    );
  }
  const record = receipt.data;
  const bought = record.receipt.status === 'FILLED' || record.receipt.status === 'SETTLED';
  return (
    <div>
      <div className="flex items-center gap-2">
        <TickerIcon tickerId={record.receipt.tickerId} size="sm" />
        <StatusTag status={record.receipt.status} />
        <span className="text-body-s tabular-nums text-ink-secondary">{number}</span>
      </div>
      <p className="mt-3 text-h3 text-ink">{receiptTitle(record)}</p>
      {bought ? <DebtSecurityLine className="mt-1" /> : null}
      <p className="mt-2 text-body-s text-ink-secondary">{receiptSentence(record)}</p>
      <p className="mt-3 text-body-s text-ink-secondary">{formatUtc(record.receipt.timestamp)}</p>
    </div>
  );
}
