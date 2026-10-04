import type { CSSProperties, JSX, ReactNode } from 'react';

import { encodeQr } from '@/components/ui/qr';
import { BRAND_ART, BRAND_MICRO_BELOW_PX, type BrandArt } from '@/generated/brand/brand-art';

import type { CardEnv } from './card-env';
import type { CardColorKey } from './card-palette';
import type { CardBackground } from './card-themes';
import type { CardLegendItem, CardRail, CardToken } from './card-view';

/**
 * The building blocks of every card and OpenGraph image. They obey both renderers: flexbox and absolute positioning
 * only, every element with more than one child is a flex box, every length goes through env.px, every color comes
 * from the palette, and nothing uses a hook, so Satori can call them as plain functions.
 */

export type Length = number | string;

/** A length for a CSS shorthand such as border, where a bare number is not read as pixels. */
export function cssLength(value: Length): string {
  return typeof value === 'number' ? `${value}px` : value;
}

/** "a b c d" padding from design pixels. */
export function pad(env: CardEnv, top: number, right: number = top, bottom: number = top, left: number = right): string {
  return [top, right, bottom, left].map((value) => cssLength(env.px(value))).join(' ');
}

/** Drops unset properties: Satori reads every key it is given and fails on an undefined value. */
export function css(style: CSSProperties): CSSProperties {
  return Object.fromEntries(Object.entries(style).filter(([, value]) => value !== undefined)) as CSSProperties;
}

export interface BoxProps {
  style?: CSSProperties;
  children?: ReactNode;
}

/** A flex box. Satori lays out nothing else, and the page draws it the same way. */
export function Box({ style, children }: BoxProps): JSX.Element {
  return <div style={css({ display: 'flex', ...style })}>{children}</div>;
}

export interface TextProps {
  env: CardEnv;
  size: number;
  color: string;
  weight?: 400 | 500 | 600;
  family?: 'sans' | 'mono';
  /** Letter spacing in em. */
  tracking?: number;
  leading?: number;
  style?: CSSProperties;
  children: string;
}

/** One run of text in one style. Runs never nest, because Satori would lay the pieces out as flex items. */
export function Text({
  env,
  size,
  color,
  weight = 500,
  family = 'sans',
  tracking,
  leading = 1.2,
  style,
  children,
}: TextProps): JSX.Element {
  return (
    <div
      style={css({
        display: 'flex',
        fontFamily: env.fonts[family],
        fontSize: env.px(size),
        fontWeight: weight,
        color,
        lineHeight: leading,
        letterSpacing: tracking === undefined ? undefined : `${tracking}em`,
        ...style,
      })}
    >
      {children}
    </div>
  );
}

export const FILL: CSSProperties = { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' };

/** Paints a background as absolute layers, bottom layer first, so the server can stack what CSS lists. */
export function Fill({ background, env }: { background: CardBackground; env: CardEnv }): JSX.Element {
  if ('color' in background) return <div style={{ ...FILL, backgroundColor: env.palette.color[background.color] }} />;
  const layers = [...env.palette.layers[background.layers]].reverse();
  // A wrapper rather than a fragment: Satori draws nothing for a fragment a component returns.
  return (
    <div style={{ ...FILL, display: 'flex' }}>
      {layers.map((layer, index) => (
        <div key={`${background.layers}-${index}`} style={{ ...FILL, backgroundImage: layer }} />
      ))}
    </div>
  );
}

/** The equity share waiting as USDG: amber stripes, the app's --pattern-waiting at the image's scale. */
export function Stripes({ env, height }: { env: CardEnv; height: number }): JSX.Element {
  const { px } = env;
  const soft = env.palette.color.waitingSoft;
  const amber = env.palette.color.waiting;
  if (env.stripes === 'css') {
    const band = cssLength(px(9));
    const period = cssLength(px(13));
    return (
      <div
        style={{
          ...FILL,
          backgroundImage: `repeating-linear-gradient(135deg, ${soft} 0, ${soft} ${band}, ${amber} ${band}, ${amber} ${period})`,
        }}
      />
    );
  }
  const period = 13;
  const width = 2400;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ position: 'absolute', top: 0, left: 0 }}>
      <defs>
        <pattern id="waiting-stripes" width={period} height={period} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width={period} height={period} style={{ fill: soft }} />
          <rect x={9} width={period - 9} height={period} style={{ fill: amber }} />
        </pattern>
      </defs>
      <rect width={width} height={height} style={{ fill: 'url(#waiting-stripes)' }} />
    </svg>
  );
}

/** A square of waiting stripes, the mark for USDG that waited for the market. */
export function StripeChip({ env, size }: { env: CardEnv; size: number }): JSX.Element {
  return (
    <Box
      style={{
        position: 'relative',
        width: env.px(size),
        height: env.px(size),
        flexShrink: 0,
        borderRadius: env.px(Math.round(size * 0.3)),
        overflow: 'hidden',
      }}
    >
      <Stripes env={env} height={size} />
    </Box>
  );
}

/**
 * One of the brand kit's drawings at a height, its pieces filled from the image's palette (D-037). Decorative: a card
 * is one labelled image, and its label carries the words.
 */
function BrandArtSvg({ env, art, height, base, share }: { env: CardEnv; art: BrandArt; height: number; base: string; share: string }): JSX.Element {
  const width = Math.round(height * art.ratio);
  return (
    <svg aria-hidden="true" width={width} height={height} viewBox={art.viewBox} style={{ width: env.px(width), height: env.px(height), flexShrink: 0 }}>
      {art.base === '' ? null : <path d={art.base} style={{ fill: base }} />}
      {art.share === '' ? null : <path d={art.share} style={{ fill: share }} />}
      {art.word === '' ? null : <path d={art.word} style={{ fill: base }} />}
    </svg>
  );
}

/** Sleeve's symbol from the brand kit: one account with the share set aside in its corner, ink and green. */
export function SplitMark({ env, size }: { env: CardEnv; size: number }): JSX.Element {
  const art = size < BRAND_MICRO_BELOW_PX ? BRAND_ART.micro : BRAND_ART.symbol;
  return <BrandArtSvg env={env} art={art} height={size} base={env.palette.color.ink} share={env.palette.color.equity} />;
}

/**
 * Sleeve's horizontal lockup from the brand kit, the most prominent brand on every image (DESIGN.md 12.9): the symbol
 * and the lowercase wordmark, `size` px tall. On a green face the share takes the mint step, so it does not vanish
 * into the face.
 */
export function Lockup({ env, size, color, equity }: { env: CardEnv; size: number; color: string; equity?: string }): JSX.Element {
  return <BrandArtSvg env={env} art={BRAND_ART.horizontal} height={size} base={color} share={equity ?? env.palette.color.equity} />;
}

/** Corner radius of a token at a size: closeout's rounded square for Stock Tokens, a disc for USDG. */
export function tokenRadius(token: Pick<CardToken, 'shape'>, size: number): number {
  return token.shape === 'tile' ? Math.round(size * 0.3) : Math.round(size / 2);
}

/** Two candles, the neutral Stock Token glyph (components/token/glyphs.tsx), for a token with no logo file. */
function StockGlyph({ env, size }: { env: CardEnv; size: number }): JSX.Element {
  const fill = env.palette.color.equity;
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" style={{ width: env.px(size), height: env.px(size) }}>
      <rect x="5.25" y="2.5" width="1.5" height="12" rx="0.75" style={{ fill }} />
      <rect x="3.5" y="5" width="5" height="7" rx="1.25" style={{ fill }} />
      <rect x="13.25" y="5.5" width="1.5" height="12" rx="0.75" style={{ fill }} />
      <rect x="11.5" y="8.5" width="5" height="6.5" rx="1.25" style={{ fill }} />
    </svg>
  );
}

/**
 * A token as TokenIcon draws it (docs/design/icon-system.md 4.3): the committed logo in its shape with a hairline so a
 * pale plate keeps its edge, "mark" artwork inset on a white plate, or the neutral glyph on the equity tile when the
 * manifest withholds the logo. Decorative: the symbol is always printed beside it.
 */
export function TokenMark({ env, token, size }: { env: CardEnv; token: CardToken; size: number }): JSX.Element {
  const { px } = env;
  const radius = px(tokenRadius(token, size));
  const hairline = `${cssLength(px(Math.max(1, Math.round(size / 48))))} solid ${env.palette.color.border}`;
  if (token.logo === null) {
    return (
      <Box
        style={{
          width: px(size),
          height: px(size),
          flexShrink: 0,
          borderRadius: radius,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: env.palette.color.equitySurface,
          border: `${cssLength(px(2))} solid ${env.palette.color.equityBorder}`,
        }}
      >
        <StockGlyph env={env} size={Math.round(size * 0.62)} />
      </Box>
    );
  }
  const inset = token.art === 'mark' ? Math.round(size * 0.19) : 0;
  const drawn = size - inset * 2;
  return (
    <Box
      style={{
        position: 'relative',
        width: px(size),
        height: px(size),
        flexShrink: 0,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius,
        overflow: 'hidden',
        backgroundColor: token.art === 'mark' ? env.palette.color.surface : undefined,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- Satori draws only plain img elements, and the page must match it. */}
      <img
        src={env.logo(token.logo)}
        alt=""
        width={drawn}
        height={drawn}
        style={{ width: px(drawn), height: px(drawn), borderRadius: token.art === 'mark' ? 0 : radius, objectFit: 'contain' }}
      />
      <div style={{ ...FILL, borderRadius: radius, border: hairline }} />
    </Box>
  );
}

/** A check in a disc: the guard's stamp. */
export function CheckBadge({ env, size, background, ink }: { env: CardEnv; size: number; background: string; ink: string }): JSX.Element {
  const { px } = env;
  const glyph = Math.round(size * 0.62);
  return (
    <Box
      style={{
        width: px(size),
        height: px(size),
        flexShrink: 0,
        borderRadius: px(size),
        backgroundColor: background,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg width={glyph} height={glyph} viewBox="0 0 20 20" style={{ width: px(glyph), height: px(glyph) }}>
        <path
          d="M4.25 10.5 8 14.25l7.75-8.5"
          style={{ fill: 'none', stroke: ink, strokeWidth: 2.25, strokeLinecap: 'round', strokeLinejoin: 'round' }}
        />
      </svg>
    </Box>
  );
}

/** An arrow pointing the way the money moved, in a tile on the seam between two panels (Uniswap's swap card). */
export function ArrowTile({ env, size, direction }: { env: CardEnv; size: number; direction: 'down' | 'right' }): JSX.Element {
  const { px } = env;
  const color = env.palette.color;
  const glyph = Math.round(size * 0.5);
  const path = direction === 'down' ? 'M10 3.5v13M4.75 11.25 10 16.5l5.25-5.25' : 'M3.5 10h13M11.25 4.75 16.5 10l-5.25 5.25';
  return (
    <Box
      style={{
        width: px(size),
        height: px(size),
        flexShrink: 0,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: px(Math.round(size * 0.32)),
        backgroundColor: color.surface,
        border: `${cssLength(px(Math.max(2, Math.round(size / 14))))} solid ${color.border}`,
      }}
    >
      <svg width={glyph} height={glyph} viewBox="0 0 20 20" style={{ width: px(glyph), height: px(glyph) }}>
        <path d={path} style={{ fill: 'none', stroke: color.ink, strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round' }} />
      </svg>
    </Box>
  );
}

const SEGMENT_COLOR: Record<CardLegendItem['kind'], { fill: CardColorKey; text: CardColorKey }> = {
  spend: { fill: 'spend', text: 'spendText' },
  equity: { fill: 'equity', text: 'equityText' },
};

export function legendColors(env: CardEnv, kind: CardLegendItem['kind']): { fill: string; text: string } {
  const keys = SEGMENT_COLOR[kind];
  return { fill: env.palette.color[keys.fill], text: env.palette.color[keys.text] };
}

/** A legend dot in a segment's color. */
export function Dot({ env, kind, size }: { env: CardEnv; kind: CardLegendItem['kind']; size: number }): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        width: env.px(size),
        height: env.px(size),
        flexShrink: 0,
        borderRadius: env.px(size),
        backgroundColor: legendColors(env, kind).fill,
      }}
    />
  );
}

export interface RailProps {
  env: CardEnv;
  rail: CardRail;
  height: number;
  gap: number;
  /** Pills for a rail that floats; square ends for one along a card's edge, which the card's corners round. */
  rounded: boolean;
  /** The narrowest a share may draw, so a 1 percent split stays visible. */
  minSegment: number;
}

/**
 * The split rail, Sleeve's signature (DESIGN.md 12.1): spend on the left in apricot, the equity share on the right
 * in green. A share that waited for the market before it bought leads with the waiting stripes.
 */
export function Rail({ env, rail, height, gap, rounded, minSegment }: RailProps): JSX.Element {
  const { px } = env;
  const radius = rounded ? px(height) : 0;
  const equityColor = env.palette.color.equity;
  const segment = (grow: number): CSSProperties => ({
    display: 'flex',
    position: 'relative',
    flexGrow: grow,
    flexBasis: 0,
    minWidth: px(minSegment),
    height: px(height),
    borderRadius: radius,
    overflow: 'hidden',
  });
  return (
    <Box style={{ width: '100%', height: px(height), gap: px(gap), flexShrink: 0 }}>
      {rail.spendBps > 0 ? <div style={{ ...segment(rail.spendBps), backgroundColor: env.palette.color.spend }} /> : null}
      {rail.equityBps > 0 && rail.waited ? (
        <div style={{ ...segment(rail.equityBps), gap: px(gap) }}>
          <div style={{ display: 'flex', position: 'relative', flexGrow: 1, flexBasis: 0, borderRadius: radius, overflow: 'hidden' }}>
            <Stripes env={env} height={height} />
          </div>
          <div style={{ display: 'flex', flexGrow: 1, flexBasis: 0, borderRadius: radius, backgroundColor: equityColor }} />
        </div>
      ) : null}
      {rail.equityBps > 0 && !rail.waited ? <div style={{ ...segment(rail.equityBps), backgroundColor: equityColor }} /> : null}
    </Box>
  );
}

/** One modules-per-side QR symbol with its quiet zone, ink on white, never inverted (components/ui/qr-code.tsx). */
export function QrMark({ env, value, size }: { env: CardEnv; value: string; size: number }): JSX.Element {
  const matrix = encodeQr(value, { errorLevel: 'M' });
  const quiet = 4;
  const extent = matrix.size + quiet * 2;
  const runs: string[] = [];
  for (let row = 0; row < matrix.size; row += 1) {
    let col = 0;
    while (col < matrix.size) {
      if (!matrix.modules[row * matrix.size + col]) {
        col += 1;
        continue;
      }
      const start = col;
      while (col < matrix.size && matrix.modules[row * matrix.size + col]) col += 1;
      runs.push(`M${start + quiet} ${row + quiet}h${col - start}v1h-${col - start}z`);
    }
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${extent} ${extent}`}
      shapeRendering="crispEdges"
      style={{ width: env.px(size), height: env.px(size), flexShrink: 0 }}
    >
      <rect width={extent} height={extent} style={{ fill: env.palette.color.surface }} />
      <path d={runs.join('')} style={{ fill: env.palette.color.ink }} />
    </svg>
  );
}

/** Fine concentric arcs engraved across the deep colorway's face (Ramp's and Mercury's metal cards). */
export function Arcs({ env, width, height }: { env: CardEnv; width: number; height: number }): JSX.Element {
  const cx = Math.round(width * 1.04);
  const cy = Math.round(height * 1.08);
  const radii: number[] = [];
  for (let radius = 18; radius < Math.hypot(width, height) * 1.1; radius += 18) radii.push(radius);
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ position: 'absolute', top: 0, left: 0, width: env.px(width), height: env.px(height) }}
    >
      {radii.map((radius) => (
        <circle
          key={radius}
          cx={cx}
          cy={cy}
          r={radius}
          style={{ fill: 'none', stroke: env.palette.color.onAccent, strokeOpacity: 0.09, strokeWidth: 1.5 }}
        />
      ))}
    </svg>
  );
}

/** The sample data line across the top of an image while the mock data layer runs. */
export function SampleStrip({ env, line, height, size }: { env: CardEnv; line: string; height: number; size: number }): JSX.Element {
  return (
    <Box
      style={{
        position: 'relative',
        width: '100%',
        height: env.px(height),
        flexShrink: 0,
        alignItems: 'center',
        justifyContent: 'center',
        gap: env.px(Math.round(size * 0.6)),
        backgroundColor: env.palette.color.infoSoft,
        borderBottom: `${cssLength(env.px(2))} solid ${env.palette.color.accentBorder}`,
      }}
    >
      <SplitMark env={env} size={Math.round(size * 0.9)} />
      <Text env={env} size={size} color={env.palette.color.infoText} weight={500}>
        {line}
      </Text>
    </Box>
  );
}

/** The sample data line as a note inside a narrow column, for images whose top edge a feed may cover. */
export function SampleNote({ env, line, size }: { env: CardEnv; line: string; size: number }): JSX.Element {
  return (
    <Box
      style={{
        alignItems: 'flex-start',
        gap: env.px(Math.round(size * 0.55)),
        padding: pad(env, Math.round(size * 0.6), Math.round(size * 0.8)),
        borderRadius: env.px(Math.round(size * 0.8)),
        backgroundColor: env.palette.color.infoSoft,
        border: `${cssLength(env.px(1))} solid ${env.palette.color.accentBorder}`,
        flexShrink: 0,
      }}
    >
      <Box style={{ paddingTop: env.px(Math.round(size * 0.42)) }}>
        <SplitMark env={env} size={Math.round(size * 0.9)} />
      </Box>
      <Text env={env} size={size} color={env.palette.color.infoText} weight={500} leading={1.35} style={{ flexShrink: 1 }}>
        {line}
      </Text>
    </Box>
  );
}
