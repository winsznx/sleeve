import { LAUNCH_TICKERS, type TickerId } from '@sleeve/core';

import { parseReceiptId } from '@/lib/receipt-id';

import type { NavIconName } from './glyphs';
import type { NavItem } from './sections';

/**
 * What the search palette offers and how a query narrows it (docs/design/inspiration.md 5.6, with D-024's places):
 * the app's pages, a few actions, the launch Stock Tokens, and, when the query is a number, that action's details
 * and its public check. Gated features are never listed. Pure, so the matching is tested without a browser.
 */

interface ItemBase {
  /** Unique within the palette; also the option's DOM id suffix. */
  key: string;
  label: string;
  description: string;
  /** Lowercase text a query is matched against: the label, the description and any keywords. */
  search: string;
}

export interface PageItem extends ItemBase {
  kind: 'page';
  href: string;
  icon: NavIconName;
}

/** Something the palette does in place rather than a page it opens. */
export type PaletteCommand = 'receive' | 'copy-address';

export interface CommandItem extends ItemBase {
  kind: 'command';
  command: PaletteCommand;
  icon: NavIconName;
}

export interface TickerItem extends ItemBase {
  kind: 'ticker';
  href: string;
  tickerId: TickerId;
}

/** An action looked up by its number: its details-and-proof page. */
export interface DetailsItem extends ItemBase {
  kind: 'details';
  href: string;
  receiptId: bigint;
}

/** An action looked up by its number: the public check of it. */
export interface CheckItem extends ItemBase {
  kind: 'check';
  href: string;
  receiptId: bigint;
}

export type PaletteItem = PageItem | CommandItem | TickerItem | DetailsItem | CheckItem;

export type PaletteGroupKey = 'number' | 'pages' | 'actions' | 'tokens';

export interface PaletteGroup {
  key: PaletteGroupKey;
  label: string;
  items: PaletteItem[];
}

function searchText(...parts: readonly (string | undefined)[]): string {
  return parts
    .filter((part): part is string => part !== undefined)
    .join(' ')
    .toLowerCase();
}

/** An action number typed as 642 or #642, or null when the query is not one. Leading zeros are dropped. */
export function paletteNumber(query: string): bigint | null {
  const match = /^#?\s*(\d{1,78})$/.exec(query.trim());
  if (match === null) return null;
  const digits = (match[1] ?? '').replace(/^0+(?=\d)/, '');
  return parseReceiptId(digits);
}

function pageItems(pages: readonly NavItem[]): PageItem[] {
  return pages.map((page) => ({
    kind: 'page',
    key: `page-${page.href.replace(/\W+/g, '-')}`,
    label: page.label,
    description: page.description ?? '',
    href: page.href,
    icon: page.icon,
    search: searchText(page.label, page.description, ...(page.keywords ?? [])),
  }));
}

/** Actions need a signed-in owner: there is no address to receive on or copy without one. */
function actionItems(signedIn: boolean): PaletteItem[] {
  const always: PageItem[] = [
    {
      kind: 'page',
      key: 'action-sell',
      label: 'Sell a Stock Token back to USDG',
      description: 'Through the same price guard. The USDG goes to spend.',
      href: '/sell',
      icon: 'sell',
      search: searchText('Sell a Stock Token back to USDG', 'sell-back holdings guard usdg'),
    },
    {
      kind: 'page',
      key: 'action-site',
      label: 'About Sleeve',
      description: 'How a payday splits, the proof, and the questions people ask.',
      href: '/',
      icon: 'external',
      search: searchText('About Sleeve', 'site landing how it works questions'),
    },
  ];
  if (!signedIn) return always;
  const owner: CommandItem[] = [
    {
      kind: 'command',
      key: 'action-receive',
      command: 'receive',
      label: 'Receive USDG',
      description: 'Show your payment address with its QR code.',
      icon: 'receive',
      search: searchText('Receive USDG', 'payment address qr deposit get paid'),
    },
    {
      kind: 'command',
      key: 'action-copy',
      command: 'copy-address',
      label: 'Copy payment address',
      description: 'Puts your full payment address on the clipboard.',
      icon: 'copy',
      search: searchText('Copy payment address', 'clipboard address'),
    },
  ];
  return [...owner, ...always];
}

function tickerItems(): TickerItem[] {
  return LAUNCH_TICKERS.map((ticker) => ({
    kind: 'ticker',
    key: `ticker-${ticker.symbol}`,
    label: ticker.symbol,
    description: ticker.name,
    href: `/holdings#holding-${ticker.symbol}`,
    tickerId: ticker.id,
    search: searchText(ticker.symbol, ticker.name, 'Stock Token'),
  }));
}

function numberItems(id: bigint): [DetailsItem, CheckItem] {
  const number = `#${id.toString()}`;
  return [
    {
      kind: 'details',
      key: `details-${id.toString()}`,
      label: `Open ${number}`,
      description: 'Its details and proof.',
      href: `/receipts/${id.toString()}`,
      receiptId: id,
      search: '',
    },
    {
      kind: 'check',
      key: `check-${id.toString()}`,
      label: `Check ${number} on the public page`,
      description: 'Recomputes it from public chain data.',
      href: `/verify/${id.toString()}`,
      receiptId: id,
      search: '',
    },
  ];
}

/** Every word of the query appears somewhere in the item's text. */
function matches(item: PaletteItem, words: readonly string[]): boolean {
  return words.every((word) => item.search.includes(word));
}

/** Items whose label starts with the query come first; the rest keep their order. */
function rank(items: readonly PaletteItem[], query: string): PaletteItem[] {
  const lead = items.filter((item) => item.label.toLowerCase().startsWith(query));
  return [...lead, ...items.filter((item) => !lead.includes(item))];
}

export interface PaletteInput {
  query: string;
  pages: readonly NavItem[];
  signedIn: boolean;
}

/** The groups to show for a query, empty groups left out. An empty query shows everything. */
export function paletteGroups({ query, pages, signedIn }: PaletteInput): PaletteGroup[] {
  const trimmed = query.trim().toLowerCase();
  const number = paletteNumber(trimmed);
  const words = trimmed.split(/\s+/).filter((word) => word !== '');
  const groups: PaletteGroup[] = [];
  if (number !== null) groups.push({ key: 'number', label: `Action #${number.toString()}`, items: numberItems(number) });
  const filter = (items: readonly PaletteItem[]): PaletteItem[] =>
    words.length === 0 ? [...items] : rank(items.filter((item) => matches(item, words)), trimmed);
  groups.push({ key: 'pages', label: 'Pages', items: filter(pageItems(pages)) });
  groups.push({ key: 'actions', label: 'Actions', items: filter(actionItems(signedIn)) });
  groups.push({ key: 'tokens', label: 'Stock Tokens', items: filter(tickerItems()) });
  return groups.filter((group) => group.items.length > 0);
}

/** The groups' items in the order the arrow keys walk them. */
export function flattenGroups(groups: readonly PaletteGroup[]): PaletteItem[] {
  return groups.flatMap((group) => group.items);
}
