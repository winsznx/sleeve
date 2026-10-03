import { tokenLogo, type LogoKey } from '@/components/token/registry';

import { DOM_PALETTE, type CardPalette } from './card-palette';

/**
 * Everything the card art needs from where it is drawn. The art itself is one pure component with inline styles
 * that both Satori (next/og) and the browser can lay out, so the preview in the page and the exported PNG come from
 * the same code (docs/design/inspiration.md section 9). The environment supplies what differs between the two:
 * colors, font family names, how a design pixel becomes a CSS length, and where a token logo is read from.
 */

/** The family names the server registers with next/og. In the page the art reads the next/font variables. */
export const CARD_FONT_FAMILY = { sans: 'Instrument Sans', mono: 'IBM Plex Mono' } as const;

export interface CardEnv {
  palette: CardPalette;
  fonts: { sans: string; mono: string };
  /** A length in design pixels of the image being drawn. */
  px: (value: number) => number | string;
  /** The image source for a token logo. */
  logo: (key: LogoKey) => string;
  /**
   * How the waiting stripes are painted. Browsers draw them as a repeating gradient; Satori draws repeating
   * gradients at an angle wrongly, so the server paints an SVG pattern of the same geometry.
   */
  stripes: 'css' | 'svg';
}

/** The CSS variable the preview frame sets: one design pixel of the image, as a share of the frame's width. */
export const CARD_UNIT_VAR = '--card-unit';

/**
 * The page's environment. Lengths scale with the preview frame through container query units, so the art stays
 * crisp text at any width with no measuring script.
 */
export const DOM_ENV: CardEnv = {
  palette: DOM_PALETTE,
  fonts: { sans: 'var(--font-sans)', mono: 'var(--font-mono)' },
  px: (value) => (value === 0 ? 0 : `calc(var(${CARD_UNIT_VAR}) * ${value})`),
  logo: (key) => tokenLogo(key).src,
  stripes: 'css',
};
