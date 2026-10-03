import type { JSX } from 'react';

import { cx } from '@/components/ui/cx';

import { tokenLabel, type TokenKey } from './registry';
import {
  TOKEN_CUTOUT_CLASS,
  TOKEN_ICON_RADIUS_CLASS,
  TOKEN_ICON_SIZE_CLASS,
  TokenIcon,
  type TokenIconSize,
  type TokenIconSurface,
} from './token-icon';

/** Sizes a stack or pair accepts. 16 px icons are too small to overlap and stay legible. */
export type TokenStackSize = Exclude<TokenIconSize, 'xs'>;

/** Each icon after the first slides under its neighbour by about 30 percent of its width. */
const OVERLAP_CLASS: Record<TokenStackSize, string> = {
  sm: '-ml-1.5',
  md: '-ml-2',
  lg: '-ml-2.5',
  xl: '-ml-3',
  '2xl': '-ml-4',
};

const COUNT_TEXT_CLASS: Record<TokenStackSize, string> = {
  sm: 'text-[10px] leading-none',
  md: 'text-[11px] leading-none',
  lg: 'text-micro',
  xl: 'text-label',
  '2xl': 'text-label',
};

export interface TokenStackProps {
  tokens: readonly TokenKey[];
  size?: TokenStackSize;
  /** The surface under the stack, which the cutout rings are drawn in. */
  surface?: TokenIconSurface;
  /** How many icons to draw before the rest collapse into a "+N" count. Two at least. */
  max?: number;
  /** Overrides the accessible name. The default lists every token, the hidden ones included. */
  label?: string;
  /** Hide the stack from assistive technology when adjacent text already names the tokens. */
  decorative?: boolean;
  className?: string;
}

/**
 * Overlapping token icons for a sleeve's tickers or a route. The first token sits on top, every icon wears a cutout
 * ring in the surface color, and tokens past max collapse into a count disc laid on top, never into a letter. The
 * group carries one accessible name; the icons inside are decorative.
 */
export function TokenStack({
  tokens,
  size = 'md',
  surface = 'surface',
  max = 4,
  label,
  decorative = false,
  className,
}: TokenStackProps): JSX.Element | null {
  if (tokens.length === 0) return null;
  const limit = Math.max(2, Math.floor(max));
  const shown = tokens.length > limit ? tokens.slice(0, limit - 1) : tokens;
  const hidden = tokens.length - shown.length;
  const name = label ?? listLabel(tokens);

  return (
    <span
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative ? true : undefined}
      className={cx('isolate inline-flex shrink-0 items-center', className)}
    >
      {shown.map((token, index) => (
        <span
          key={`${token}-${index}`}
          className={cx('relative inline-flex', index > 0 && OVERLAP_CLASS[size])}
          style={{ zIndex: shown.length - index }}
        >
          <TokenIcon token={token} size={size} cutout={surface} decorative />
        </span>
      ))}
      {hidden > 0 ? (
        <span
          aria-hidden="true"
          data-testid="token-stack-count"
          style={{ zIndex: shown.length + 1 }}
          className={cx(
            'relative inline-grid place-items-center bg-surface-strong font-semibold tabular-nums text-ink-secondary',
            OVERLAP_CLASS[size],
            TOKEN_ICON_SIZE_CLASS[size],
            TOKEN_ICON_RADIUS_CLASS.disc[size],
            TOKEN_CUTOUT_CLASS[surface],
            COUNT_TEXT_CLASS[size],
          )}
        >
          +{hidden}
        </span>
      ) : null}
    </span>
  );
}

export interface TokenPairProps extends Omit<TokenStackProps, 'tokens' | 'max'> {
  /** The token paid in, drawn on top. */
  from: TokenKey;
  /** The token received. */
  to: TokenKey;
}

/** Two overlapping icons for one movement, USDG into a Stock Token for a buy or the reverse for a sell-back. */
export function TokenPair({ from, to, label, ...rest }: TokenPairProps): JSX.Element | null {
  return <TokenStack tokens={[from, to]} max={2} label={label ?? `${tokenLabel(from)} to ${tokenLabel(to)}`} {...rest} />;
}

/** One name per token, joined: "USDG", "USDG and SPY Stock Token", "SPY Stock Token, QQQ Stock Token and ETH". */
function listLabel(tokens: readonly TokenKey[]): string {
  const names = tokens.map(tokenLabel);
  if (names.length === 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;
}
