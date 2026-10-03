import { CARD_THEMES, DEFAULT_CARD_THEME, isCardTheme, type CardTheme } from './card-themes';

/**
 * The image sizes and the look a person picks, and how both travel in an image address. The address carries the
 * look and two toggles, never content: the server reads the card itself, and a toggle can only leave off what the
 * owner chose to show (docs/design/inspiration.md section 9, abuse).
 */

export const CARD_FORMATS = {
  post: { width: 1080, height: 1350, label: 'Post', description: '1080 by 1350, for a feed or a chat' },
  wide: { width: 1200, height: 630, label: 'Wide', description: '1200 by 630, the size of a link preview' },
} as const;

export type CardFormat = keyof typeof CARD_FORMATS;
export const CARD_FORMAT_KEYS = Object.keys(CARD_FORMATS) as CardFormat[];
export const DEFAULT_CARD_FORMAT: CardFormat = 'post';

export function isCardFormat(value: string): value is CardFormat {
  return Object.hasOwn(CARD_FORMATS, value);
}

/**
 * Raised whenever the art changes, so link previews and browser caches fetch the new image (Linear's v parameter,
 * docs/design/inspiration.md 8.5).
 */
export const CARD_ART_VERSION = '2';

export interface CardLook {
  theme: CardTheme;
  /** Draw the amounts the card holds. Off leaves them off; on never adds any the owner did not show. */
  amounts: boolean;
  /** Draw the proof the card holds, under the same rule. */
  proof: boolean;
}

/** A card shows everything its owner chose to show until someone leaves a part off the image. */
export const DEFAULT_CARD_LOOK: CardLook = { theme: DEFAULT_CARD_THEME, amounts: true, proof: true };

/** Card ids are opaque (src/data/types.ts getCard). Anything outside this shape is not one, so it is never looked up. */
const CARD_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** "sample" names the route that draws sample cards (sample-card.ts), so it is never a card id. */
export function isCardId(value: string): boolean {
  return CARD_ID.test(value) && value !== 'sample';
}

/** Reads the look from an address. Unknown values fall back to the default, and "0" is the only value that hides. */
export function readCardLook(params: URLSearchParams): CardLook {
  const theme = params.get('theme') ?? '';
  return {
    theme: isCardTheme(theme) ? theme : DEFAULT_CARD_THEME,
    amounts: params.get('amounts') !== '0',
    proof: params.get('proof') !== '0',
  };
}

/** The query for a look, leaving out every default so the plain address stays the plain card. */
export function cardLookQuery(look: CardLook): URLSearchParams {
  const query = new URLSearchParams();
  if (look.theme !== DEFAULT_CARD_THEME) query.set('theme', look.theme);
  if (!look.amounts) query.set('amounts', '0');
  if (!look.proof) query.set('proof', '0');
  return query;
}

/** Adds the look, the download flag and the art version to a query, in that order. */
export function withLook(query: URLSearchParams, look: CardLook, download: boolean): URLSearchParams {
  for (const [key, value] of cardLookQuery(look)) query.set(key, value);
  if (download) query.set('download', '1');
  query.set('v', CARD_ART_VERSION);
  return query;
}

export interface CardImageRequest {
  cardId: string;
  format: CardFormat;
  look: CardLook;
  /** Ask the browser to save the file instead of showing it. */
  download?: boolean;
}

/** /api/card/r8KQm2xV4nPz/post?theme=mint&v=2 */
export function cardImagePath({ cardId, format, look, download = false }: CardImageRequest): string {
  const query = withLook(new URLSearchParams(), look, download);
  return `/api/card/${encodeURIComponent(cardId)}/${format}?${query.toString()}`;
}

export { CARD_THEMES, DEFAULT_CARD_THEME, type CardTheme };
