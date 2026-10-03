import type { JSX } from 'react';

import { cx } from '@/components/ui/cx';

/**
 * Sleeve's two neutral marks, built like the line icons in components/ui/icons.tsx: a 20 px grid, currentColor,
 * hidden from assistive technology (the element around them carries the name). They stand in where the only
 * published mark is Robinhood's: the network, and the Stock Tokens whose issuer logo is the feather. Neither is a
 * letter badge and neither imitates a brand. docs/design/icon-system.md section 6 has the construction.
 */

export interface GlyphProps {
  className?: string;
}

export interface NetworkGlyphProps extends GlyphProps {
  /**
   * "compact" keeps two layers and a fixed 1.25 px stroke at any scale, for the 14 to 20 px chain badge and the
   * 16 px chip disc. The default is the three-layer 1.5 px glyph for 16 px and up on its own.
   */
  variant?: 'regular' | 'compact';
}

/** Two or three stacked layers: a network, with no feather, no chain links and no brand. */
export function NetworkGlyph({ className, variant = 'regular' }: NetworkGlyphProps): JSX.Element {
  const compact = variant === 'compact';
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={compact ? 1.25 : 1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={cx('shrink-0', className)}
    >
      {compact ? (
        <>
          <path d="M10 3.5 16.5 7 10 10.5 3.5 7Z" vectorEffect="non-scaling-stroke" />
          <path d="m3.5 11.5 6.5 3.5 6.5-3.5" vectorEffect="non-scaling-stroke" />
        </>
      ) : (
        <>
          <path d="M10 2.75 17.25 6.5 10 10.25 2.75 6.5Z" />
          <path d="m2.75 10 7.25 3.75L17.25 10" />
          <path d="m2.75 13.5 7.25 3.75 7.25-3.75" />
        </>
      )}
    </svg>
  );
}

/** Two candles: a traded instrument, with no direction and no company mark. Filled, so it holds at 9 px. */
export function StockTokenGlyph({ className }: GlyphProps): JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" focusable="false" className={cx('shrink-0', className)}>
      <rect x="5.25" y="2.5" width="1.5" height="12" rx="0.75" />
      <rect x="3.5" y="5" width="5" height="7" rx="1.25" />
      <rect x="13.25" y="5.5" width="1.5" height="12" rx="0.75" />
      <rect x="11.5" y="8.5" width="5" height="6.5" rx="1.25" />
    </svg>
  );
}
