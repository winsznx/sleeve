import type { JSX } from 'react';

import { cx } from './cx';

/**
 * A picture made from an address, so a payer who sends again looks the same every time and two payers look apart
 * at a glance. It is a 5 by 5 pattern mirrored left to right, read from the address's hex digits, in two inks on a
 * neutral tile: no color, because color in Sleeve always means spend, equity or waiting. It is decorative; the
 * address beside it says who it is.
 */

const GRID = 5;
const HALF = Math.ceil(GRID / 2);

export type IdenticonCell = { x: number; y: number; strong: boolean };

/** The filled cells for a hex string such as an address: digits a to f draw a strong cell, 6 to 9 a soft one. */
export function identiconCells(hex: string): IdenticonCell[] {
  const digits = hex.replace(/^0x/i, '').toLowerCase();
  const cells: IdenticonCell[] = [];
  for (let y = 0; y < GRID; y += 1) {
    for (let x = 0; x < HALF; x += 1) {
      const digit = Number.parseInt(digits[(y * HALF + x) * 2 + 1] ?? '0', 16);
      if (Number.isNaN(digit) || digit < 6) continue;
      const strong = digit >= 10;
      cells.push({ x, y, strong });
      if (x !== GRID - 1 - x) cells.push({ x: GRID - 1 - x, y, strong });
    }
  }
  return cells.length === 0 ? [{ x: 2, y: 2, strong: true }] : cells;
}

const SIZE = {
  xs: 'size-4 rounded-[5px]',
  sm: 'size-6 rounded-[7px]',
  md: 'size-avatar rounded-[11px]',
  lg: 'size-icon-tile rounded-[13px]',
} as const;

export type IdenticonSize = keyof typeof SIZE;

export interface IdenticonProps {
  /** The address, or any hex string, it is drawn from. */
  value: string;
  size?: IdenticonSize;
  className?: string;
}

export function Identicon({ value, size = 'md', className }: IdenticonProps): JSX.Element {
  return (
    <span
      aria-hidden="true"
      data-identicon={value.toLowerCase()}
      className={cx('inline-grid shrink-0 place-items-center border border-border bg-surface-muted text-ink', SIZE[size], className)}
    >
      <svg viewBox="0 0 7 7" className="size-[72%]" shapeRendering="crispEdges">
        {identiconCells(value).map((cell) => (
          <rect
            key={`${cell.x}-${cell.y}`}
            x={cell.x + 1}
            y={cell.y + 1}
            width={1}
            height={1}
            fill="currentColor"
            fillOpacity={cell.strong ? 1 : 0.38}
          />
        ))}
      </svg>
    </span>
  );
}
