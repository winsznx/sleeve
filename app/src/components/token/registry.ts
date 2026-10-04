import manifest from '../../../public/assets/icons-manifest.json';

/**
 * What the UI may show for each token, read from public/assets/icons-manifest.json. scripts/sync-icons.ts writes
 * that file and is the only thing that should; docs/design/icon-system.md explains the rules behind it.
 *
 * Two kinds of entry exist. An icon is a real logo, downloaded, checksummed and served from /assets/tokens. A
 * withheld entry is an asset whose every published mark is banned; it shows the neutral Stock Token glyph. The Stock
 * Tokens were withheld, since their issuer serves the Robinhood feather, until D-023 pinned a mark of what each one
 * tracks, so the list is empty today. Nothing ever falls back to a letter badge.
 */

/** Tokens with a real logo file. */
export type LogoKey = keyof typeof manifest.icons;
/** Tokens shown with the neutral Stock Token glyph until an approved pin replaces the banned mark. */
export type WithheldKey = keyof typeof manifest.withheld;
export type TokenKey = LogoKey | WithheldKey;

/** "disc" artwork is its own full circle; "mark" artwork sits inset on a white plate. */
export type TokenArt = 'disc' | 'mark';
/** The container: Stock Tokens sit in a rounded-square tile, payment and gas tokens in a disc (icon-system.md 4.2). */
export type TokenShape = 'tile' | 'disc';

export interface TokenLogo {
  kind: 'logo';
  src: string;
  width: number;
  height: number;
  art: TokenArt;
}

export interface TokenGlyph {
  kind: 'stock-token-glyph';
}

export type TokenVisual = TokenLogo | TokenGlyph;

interface Entry {
  symbol: string;
  name: string;
  kind: string;
}

function artOf(key: string, value: string): TokenArt {
  if (value === 'disc' || value === 'mark') return value;
  throw new Error(`icons-manifest.json: ${key} has art "${value}". Run scripts/sync-icons.ts again.`);
}

const LOGOS = new Map<string, TokenLogo>(
  Object.entries(manifest.icons).map(([key, icon]) => [
    key,
    { kind: 'logo', src: icon.localPath, width: icon.width, height: icon.height, art: artOf(key, icon.art) },
  ]),
);

// Typed as a record so an empty withheld list, the state once every logo is pinned, still reads as entries.
const WITHHELD: Record<string, Entry> = manifest.withheld;
const ENTRIES = new Map<string, Entry>([...Object.entries(manifest.icons), ...Object.entries(WITHHELD)]);

export function isTokenKey(value: string): value is TokenKey {
  return ENTRIES.has(value);
}

/** Every token the manifest knows: the logos first, then any withheld entries, in sync order. */
export const TOKEN_KEYS: readonly TokenKey[] = [...ENTRIES.keys()].filter(isTokenKey);

/**
 * The picture for a token. Throws outside production when the key has no entry, which only a cast or a stale
 * manifest can cause; production renders nothing rather than inventing a mark.
 */
export function tokenVisual(key: TokenKey): TokenVisual | null {
  const logo = LOGOS.get(key);
  if (logo !== undefined) return logo;
  if (ENTRIES.has(key)) return { kind: 'stock-token-glyph' };
  if (process.env.NODE_ENV !== 'production') {
    throw new Error(`No icon entry for "${key}". Add it to scripts/sync-icons.ts and run the sync.`);
  }
  return null;
}

export function tokenShape(key: TokenKey): TokenShape {
  return ENTRIES.get(key)?.kind === 'stock-token' ? 'tile' : 'disc';
}

/** The ticker or currency code, as the manifest records it. */
export function tokenSymbol(key: TokenKey): string {
  return ENTRIES.get(key)?.symbol ?? key;
}

/** The accessible name: "SPY Stock Token", "USDG", "ETH". */
export function tokenLabel(key: TokenKey): string {
  const entry = ENTRIES.get(key);
  if (entry === undefined) return key;
  return entry.kind === 'stock-token' ? `${entry.symbol} Stock Token` : entry.symbol;
}

/**
 * The logo file for server-drawn images (OpenGraph, exported cards), which cannot use the component. Absolute
 * URLs come from joining src to the site origin; withheld tokens have no file and draw StockTokenGlyph instead.
 */
export function tokenLogo(key: LogoKey): TokenLogo {
  const logo = LOGOS.get(key);
  if (logo === undefined) throw new Error(`No logo file for "${key}".`);
  return logo;
}
