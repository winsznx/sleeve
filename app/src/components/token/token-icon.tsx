import { CHAIN_NAME } from '@sleeve/core';
import Image from 'next/image';
import type { JSX } from 'react';

import { cx } from '@/components/ui/cx';

import { NetworkGlyph, StockTokenGlyph } from './glyphs';
import { tokenLabel, tokenShape, tokenVisual, type TokenKey, type TokenShape, type TokenVisual } from './registry';

/**
 * Token icon sizes in px. Each comes from a container the owner already uses (docs/design/icon-system.md 4.1):
 * 16 inline in text, 20 the line-icon size, 24 compact rows, 34 closeout's provider tile and avatar, 42 closeout's
 * stat and float tiles, 52 closeout's feature icon.
 */
export const TOKEN_ICON_PX = { xs: 16, sm: 20, md: 24, lg: 34, xl: 42, '2xl': 52 } as const;

export type TokenIconSize = keyof typeof TOKEN_ICON_PX;
/** Sizes large enough to carry the chain badge. */
export type BadgedTokenIconSize = 'lg' | 'xl' | '2xl';
/** The surface under the icon. A cutout ring in that color separates overlapping icons and the badge. */
export type TokenIconSurface = 'surface' | 'muted';

export const TOKEN_ICON_SIZE_CLASS: Record<TokenIconSize, string> = {
  xs: 'size-4',
  sm: 'size-icon',
  md: 'size-6',
  lg: 'size-avatar',
  xl: 'size-icon-tile',
  '2xl': 'size-[52px]',
};

/**
 * Corner radius per shape and size. Stock Tokens sit in closeout's rounded-square tile at its ratio (11 px on 34,
 * 13 px on 42, marketing.css 676 and product.css 430), scaled to the other sizes; payment and gas tokens are discs,
 * a radius of half the size.
 */
export const TOKEN_ICON_RADIUS_CLASS: Record<TokenShape, Record<TokenIconSize, string>> = {
  tile: {
    xs: 'rounded-[5px]',
    sm: 'rounded-[6px]',
    md: 'rounded-[7px]',
    lg: 'rounded-[11px]',
    xl: 'rounded-[13px]',
    '2xl': 'rounded-[16px]',
  },
  disc: {
    xs: 'rounded-pill',
    sm: 'rounded-pill',
    md: 'rounded-pill',
    lg: 'rounded-pill',
    xl: 'rounded-pill',
    '2xl': 'rounded-pill',
  },
};

export const TOKEN_CUTOUT_CLASS: Record<TokenIconSurface, string> = {
  surface: 'ring-2 ring-surface',
  muted: 'ring-2 ring-surface-muted',
};

const BADGE_CLASS: Record<BadgedTokenIconSize, string> = { lg: 'size-3.5', xl: 'size-4', '2xl': 'size-5' };
const BADGE_GLYPH_CLASS: Record<BadgedTokenIconSize, string> = { lg: 'size-2.5', xl: 'size-3', '2xl': 'size-3.5' };

interface TokenIconBase {
  token: TokenKey;
  /** Hide the icon from assistive technology when text beside it already names the token. */
  decorative?: boolean;
  /** Draw a 2 px ring in the color of the surface underneath, for overlaps. Off by default. */
  cutout?: TokenIconSurface;
  /** Load eagerly, for icons in the first viewport. */
  priority?: boolean;
  /** Layout only (margin, grid placement). Never size or color: those come from the props. */
  className?: string;
}

/** The chain badge needs room, so only lg, xl and 2xl accept it; the types refuse it on smaller sizes. */
export type TokenIconProps = TokenIconBase &
  ({ size?: Exclude<TokenIconSize, BadgedTokenIconSize>; chain?: never } | { size: BadgedTokenIconSize; chain?: boolean });

/**
 * The one way a token is pictured anywhere in Sleeve. USDG and ETH are discs with their real logos. A Stock Token
 * is a rounded-square tile, the owner's equity shape; its issuer's only published mark is the Robinhood feather,
 * so the tile carries the neutral Stock Token glyph until an approved pin replaces it. Never a letter.
 */
export function TokenIcon(props: TokenIconProps): JSX.Element | null {
  const { token, decorative = false, cutout, priority = false, className } = props;
  const size = props.size ?? 'md';
  const visual = tokenVisual(token);
  if (visual === null) return null;
  const radius = TOKEN_ICON_RADIUS_CLASS[tokenShape(token)][size];
  const badgeSize = props.chain === true && props.size !== undefined ? props.size : null;
  const label = badgeSize === null ? tokenLabel(token) : `${tokenLabel(token)} on ${CHAIN_NAME}`;

  return (
    <span
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? true : undefined}
      data-token={token}
      className={cx(
        'relative inline-flex shrink-0 align-middle',
        TOKEN_ICON_SIZE_CLASS[size],
        radius,
        cutout === undefined ? undefined : TOKEN_CUTOUT_CLASS[cutout],
        className,
      )}
    >
      <TokenFace visual={visual} px={TOKEN_ICON_PX[size]} priority={priority} />
      {badgeSize === null ? null : <ChainBadge size={badgeSize} surface={cutout ?? 'surface'} />}
    </span>
  );
}

function TokenFace({ visual, px, priority }: { visual: TokenVisual; px: number; priority: boolean }): JSX.Element {
  if (visual.kind === 'stock-token-glyph') {
    return (
      <span className="absolute inset-0 grid place-items-center overflow-hidden rounded-[inherit] bg-equity-surface text-equity">
        <StockTokenGlyph className="size-[62%]" />
        <Edge tone="equity" />
      </span>
    );
  }
  const mark = visual.art === 'mark';
  return (
    <span className={cx('absolute inset-0 overflow-hidden rounded-[inherit]', mark && 'bg-surface')}>
      <span className={cx('absolute', mark ? 'inset-[19%]' : 'inset-0')}>
        <Image
          src={visual.src}
          alt=""
          fill
          sizes={`${px}px`}
          unoptimized
          priority={priority}
          draggable={false}
          className={mark ? 'object-contain' : 'object-cover'}
        />
      </span>
      <Edge tone="ink" />
    </span>
  );
}

/**
 * A 1 px inner hairline so a white plate or a pale tile keeps an edge on a white surface, the job closeout's 1 px
 * border does on its provider tile (marketing.css 680). Ink at 10 percent on logos, the equity border on the tile.
 */
function Edge({ tone }: { tone: 'ink' | 'equity' }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset',
        tone === 'ink' ? 'ring-ink/10' : 'ring-equity-border',
      )}
    />
  );
}

function ChainBadge({ size, surface }: { size: BadgedTokenIconSize; surface: TokenIconSurface }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'absolute -bottom-1 -right-1 grid place-items-center rounded-pill bg-ink text-ink-inverse',
        BADGE_CLASS[size],
        TOKEN_CUTOUT_CLASS[surface],
      )}
    >
      <NetworkGlyph variant="compact" className={BADGE_GLYPH_CLASS[size]} />
    </span>
  );
}
