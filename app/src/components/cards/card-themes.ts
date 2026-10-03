import type { CardColorKey, CardLayerKey } from './card-palette';

/**
 * The card colorways (docs/design/inspiration.md 6.4), every one built from the palette. The owner picks the look;
 * the words never change. A ticket sits on a backdrop: the face carries the statement, the stub under the
 * perforation stays white on every colorway so the split's apricot and green and the amounts keep their colors
 * (DESIGN.md 2.5: no spend figure on green, no equity figure on apricot). No colorway is keyed to a fund's or a
 * company's own colors (D-023).
 */

export const CARD_THEMES = ['paper', 'mint', 'stage', 'deep'] as const;
export type CardTheme = (typeof CARD_THEMES)[number];
export const DEFAULT_CARD_THEME: CardTheme = 'paper';

export type CardBackground = { color: CardColorKey } | { layers: CardLayerKey };

export interface CardThemeLook {
  label: string;
  /** One line for the picker, what the colorway looks like. */
  description: string;
  backdrop: CardBackground;
  face: CardBackground;
  /** Fine engraved arcs over the face, the metal card look of the deep colorway. */
  arcs: boolean;
  ticketEdge: CardColorKey | null;
  ticketShadow: boolean;
  /** The perforation's notches show the backdrop, so they need it to be one flat color. */
  notch: CardColorKey | null;
  faceInk: CardColorKey;
  faceSecondary: CardColorKey;
  /** The equity half of the split mark beside the wordmark. */
  markEquity: CardColorKey;
  /** The ticker's knockout label: black is selection and identity in Sleeve (DESIGN.md 1). */
  knockout: { background: CardColorKey; ink: CardColorKey };
  check: { background: CardColorKey; ink: CardColorKey };
  /** The swatch drawn in the picker. */
  swatch: CardBackground;
}

export const CARD_THEME_LOOKS: Record<CardTheme, CardThemeLook> = {
  paper: {
    label: 'Paper',
    description: 'White ticket on the app grey',
    backdrop: { color: 'shell' },
    face: { color: 'surface' },
    arcs: false,
    ticketEdge: 'border',
    ticketShadow: false,
    notch: 'shell',
    faceInk: 'ink',
    faceSecondary: 'inkSecondary',
    markEquity: 'equity',
    knockout: { background: 'brand', ink: 'onBrand' },
    check: { background: 'equity', ink: 'onAccent' },
    swatch: { color: 'surface' },
  },
  mint: {
    label: 'Mint',
    description: 'Mint wash, the equity side',
    backdrop: { color: 'canvas' },
    face: { layers: 'hero' },
    arcs: false,
    ticketEdge: 'accentBorder',
    ticketShadow: true,
    notch: 'canvas',
    faceInk: 'ink',
    faceSecondary: 'inkSecondary',
    markEquity: 'equity',
    knockout: { background: 'brand', ink: 'onBrand' },
    check: { background: 'equity', ink: 'onAccent' },
    swatch: { layers: 'hero' },
  },
  stage: {
    label: 'Stage',
    description: 'White ticket on the green stage',
    backdrop: { layers: 'stage' },
    face: { color: 'surface' },
    arcs: false,
    ticketEdge: null,
    ticketShadow: true,
    notch: null,
    faceInk: 'ink',
    faceSecondary: 'inkSecondary',
    markEquity: 'equity',
    knockout: { background: 'brand', ink: 'onBrand' },
    check: { background: 'equity', ink: 'onAccent' },
    swatch: { layers: 'stage' },
  },
  deep: {
    label: 'Deep',
    description: 'Deep green with engraved lines',
    backdrop: { color: 'canvas' },
    face: { layers: 'accentDeep' },
    arcs: true,
    ticketEdge: null,
    ticketShadow: true,
    notch: 'canvas',
    faceInk: 'onAccent',
    faceSecondary: 'onAccent',
    markEquity: 'accentBorder',
    knockout: { background: 'surface', ink: 'ink' },
    check: { background: 'surface', ink: 'equityText' },
    swatch: { layers: 'accentDeep' },
  },
};

export function isCardTheme(value: string): value is CardTheme {
  return (CARD_THEMES as readonly string[]).includes(value);
}
