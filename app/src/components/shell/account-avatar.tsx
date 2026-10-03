import type { Address } from '@sleeve/core';
import type { JSX } from 'react';

import { cx } from '@/components/ui/cx';

const SIZE = {
  sm: 'size-6 rounded-[7px]',
  md: 'size-avatar rounded-control',
} as const;

/** dark is closeout's black workspace tile; light sits on dark or busy backgrounds. */
const TONE = {
  dark: 'bg-brand text-on-brand',
  light: 'bg-surface-strong text-ink',
} as const;

const GRID = 5;
const HALF = Math.ceil(GRID / 2);

/**
 * The cells of a 5 by 5 pattern, mirrored left to right, read from the address's first fifteen hex digits: a cell is
 * filled when its digit is 8 or more. Never empty: an all-clear pattern fills the centre.
 */
export function avatarCells(address: Address): { x: number; y: number }[] {
  const digits = address.slice(2, 2 + GRID * HALF);
  const cells: { x: number; y: number }[] = [];
  for (let y = 0; y < GRID; y += 1) {
    for (let x = 0; x < HALF; x += 1) {
      const digit = Number.parseInt(digits[y * HALF + x] ?? '0', 16);
      if (Number.isNaN(digit) || digit < 8) continue;
      cells.push({ x, y });
      if (x !== GRID - 1 - x) cells.push({ x: GRID - 1 - x, y });
    }
  }
  return cells.length === 0 ? [{ x: 2, y: 2 }] : cells;
}

/**
 * The account's avatar: closeout's black workspace tile (product.css .workspace-avatar) with a small mirrored pattern
 * drawn from the payment address, so two accounts on one device look different at a glance and nothing reads as a
 * count. It is decorative; the address beside it, or the control's name, says whose account it is.
 */
export function AccountAvatar({
  address,
  size = 'md',
  tone = 'dark',
  className,
}: {
  address: Address;
  size?: keyof typeof SIZE;
  tone?: keyof typeof TONE;
  className?: string;
}): JSX.Element {
  return (
    <span aria-hidden="true" className={cx('inline-grid shrink-0 place-items-center', SIZE[size], TONE[tone], className)}>
      <svg viewBox="0 0 7 7" className="size-[78%]" shapeRendering="crispEdges">
        {avatarCells(address).map((cell) => (
          <rect key={`${cell.x}-${cell.y}`} x={cell.x + 1} y={cell.y + 1} width={1} height={1} fill="currentColor" />
        ))}
      </svg>
    </span>
  );
}
