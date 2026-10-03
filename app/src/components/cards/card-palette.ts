/**
 * The design tokens a card or OpenGraph image paints with, by role. tokens.css stays the single source: in the page
 * the art reads each token as var(--token), and on the server, where Satori cannot read custom properties,
 * server/design-tokens.ts resolves the same names from tokens.css. No color is written here or anywhere else in the
 * card code.
 */

export const CARD_COLOR_TOKENS = {
  canvas: '--color-canvas',
  surface: '--color-surface',
  surfaceMuted: '--color-surface-muted',
  surfaceStrong: '--color-surface-strong',
  shell: '--color-shell',
  border: '--color-border',
  borderStrong: '--color-border-strong',
  ink: '--color-ink',
  inkSecondary: '--color-ink-secondary',
  inkMuted: '--color-ink-muted',
  inkInverse: '--color-ink-inverse',
  brand: '--color-brand',
  onBrand: '--color-on-brand',
  onAccent: '--color-on-accent',
  accentStrong: '--color-accent-strong',
  accentBorder: '--color-accent-border',
  spend: '--color-spend',
  spendText: '--color-spend-text',
  spendSoft: '--color-spend-soft',
  spendSurface: '--color-spend-surface',
  spendBorder: '--color-spend-border',
  equity: '--color-equity',
  equityText: '--color-equity-text',
  equitySoft: '--color-equity-soft',
  equitySurface: '--color-equity-surface',
  equityBorder: '--color-equity-border',
  waiting: '--color-waiting',
  waitingText: '--color-waiting-text',
  waitingSoft: '--color-waiting-soft',
  infoSoft: '--color-info-soft',
  infoText: '--color-info-text',
  glassDeep: '--glass-deep',
  glassDeepBorder: '--glass-deep-border',
  glassLight: '--glass-light',
  glassLightBorder: '--glass-light-border',
  shadowCard: '--shadow-card',
  shadowFloating: '--shadow-floating',
  patternWaiting: '--pattern-waiting',
} as const;

/** Backgrounds that may stack several layers. The page paints the token as is; the server splits the layers. */
export const CARD_LAYER_TOKENS = {
  hero: '--gradient-hero',
  apricot: '--gradient-apricot',
  stage: '--gradient-stage',
  accentDeep: '--gradient-accent-deep',
  feature: '--gradient-feature',
  artNeutral: '--gradient-art-neutral',
  panelSoft: '--gradient-panel-soft',
} as const;

export type CardColorKey = keyof typeof CARD_COLOR_TOKENS;
export type CardLayerKey = keyof typeof CARD_LAYER_TOKENS;

export interface CardPalette {
  color: Record<CardColorKey, string>;
  /** Top layer first, as CSS lists them. */
  layers: Record<CardLayerKey, readonly string[]>;
}

function mapTokens<K extends string, V>(tokens: Record<K, string>, toValue: (token: string) => V): Record<K, V> {
  const keys = Object.keys(tokens) as K[];
  return Object.fromEntries(keys.map((key) => [key, toValue(tokens[key])])) as Record<K, V>;
}

/** The palette for art drawn in the page, where the browser resolves every token itself. */
export const DOM_PALETTE: CardPalette = {
  color: mapTokens(CARD_COLOR_TOKENS, (token) => `var(${token})`),
  layers: mapTokens(CARD_LAYER_TOKENS, (token) => [`var(${token})`]),
};

/** Builds a palette from a resolver that turns a token name into its value. */
export function paletteFrom(resolve: (token: string) => string, splitLayers: (value: string) => string[]): CardPalette {
  return {
    color: mapTokens(CARD_COLOR_TOKENS, resolve),
    layers: mapTokens(CARD_LAYER_TOKENS, (token) => splitLayers(resolve(token))),
  };
}
