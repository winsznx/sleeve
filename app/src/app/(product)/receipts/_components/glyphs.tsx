import type { JSX, ReactNode } from 'react';

import { cx } from '@/components/ui/cx';

/**
 * Line glyphs the kit's icon set (components/ui/icons.tsx) does not carry yet, drawn the same way: a 20 px grid,
 * 1.5 px stroke, round caps and joins, currentColor, hidden from assistive technology. The control around a glyph
 * carries its name. Receipts, sell and verify share them.
 */

export type GlyphName = 'arrowDown' | 'arrowRight' | 'refresh' | 'pool' | 'calendar' | 'cross';

const PATHS: Record<GlyphName, ReactNode> = {
  arrowDown: <path d="M10 3.75v12.5M4.75 11 10 16.25 15.25 11" />,
  arrowRight: <path d="M3.75 10h12.5M11 4.75 16.25 10 11 15.25" />,
  refresh: (
    <>
      <path d="M16.25 10A6.25 6.25 0 1 1 14.75 6" />
      <path d="M14.75 2.75V6H11.5" />
    </>
  ),
  pool: (
    <>
      <ellipse cx="10" cy="5.75" rx="6.25" ry="2.5" />
      <path d="M3.75 5.75v8.5c0 1.38 2.8 2.5 6.25 2.5s6.25-1.12 6.25-2.5v-8.5" />
      <path d="M3.75 10c0 1.38 2.8 2.5 6.25 2.5s6.25-1.12 6.25-2.5" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.25" y="4.25" width="13.5" height="12.5" rx="2" />
      <path d="M3.25 8.25h13.5M7 2.75v3M13 2.75v3" />
    </>
  ),
  cross: <path d="m6 6 8 8M14 6l-8 8" />,
};

export function Glyph({ name, className }: { name: GlyphName; className?: string }): JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={cx('size-icon shrink-0', className)}
    >
      {PATHS[name]}
    </svg>
  );
}
