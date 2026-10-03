import type { JSX, ReactNode } from 'react';

import { cx } from '@/components/ui/cx';
import { Icon, ICON_NAMES, type IconName } from '@/components/ui/icons';

/**
 * The few line glyphs the navigation needs that components/ui/icons.tsx does not have, drawn the same way: a 20 px
 * grid, a 1.5 px stroke, round caps and joins, currentColor, hidden from assistive technology. No feather, lock,
 * shield or fingerprint (docs/DESIGN.md 11.12).
 */
const SHELL_GLYPHS = {
  /** Two stacked tiles, the Stock Token tile shape (docs/design/icon-system.md 4.2). */
  holdings: (
    <>
      <rect x="3" y="6.75" width="10.5" height="10.5" rx="2.5" />
      <path d="M6.75 3.25h7.5a2.5 2.5 0 0 1 2.5 2.5v7.5" />
    </>
  ),
  /** A clock face with a counterclockwise arrow: every action so far. */
  history: (
    <>
      <path d="M3.25 10a6.75 6.75 0 1 0 1.98-4.77" />
      <path d="M5.5 2.5 5.23 5.23 2.5 5" />
      <path d="M10 6.75V10l2.5 1.5" />
    </>
  ),
  /** A page with a check: a written review. */
  audit: (
    <>
      <path d="M5.25 2.75h6.5l3 3v11.5h-9.5Z" />
      <path d="M11.75 2.75v3h3" />
      <path d="m7.75 12 1.75 1.75 3-3.25" />
    </>
  ),
  /** Two posts, two rails and a brace: a field gate, something that must be passed. */
  gate: <path d="M4.25 3.25v13.5M15.75 3.25v13.5M4.25 6.75h11.5M4.25 13.25h11.5M4.25 13.25l11.5-6.5" />,
  menu: <path d="M3.5 6h13M3.5 10h13M3.5 14h13" />,
  /** A lens: find a page, a Stock Token or an action. */
  search: (
    <>
      <circle cx="8.75" cy="8.75" r="5.25" />
      <path d="m12.75 12.75 4 4" />
    </>
  ),
  /** Return key, for the palette's key hints. */
  enter: <path d="M15.75 4.75v5.5a2 2 0 0 1-2 2H4.75M7.75 9.25l-3 3 3 3" />,
} satisfies Record<string, ReactNode>;

export type ShellGlyphName = keyof typeof SHELL_GLYPHS;
export type NavIconName = IconName | ShellGlyphName;

function isIconName(name: NavIconName): name is IconName {
  return (ICON_NAMES as readonly string[]).includes(name);
}

/** Draws a shell glyph, or the matching icon from components/ui/icons.tsx. Decorative: the label names the item. */
export function NavIcon({ name, className }: { name: NavIconName; className?: string }): JSX.Element {
  if (isIconName(name)) return <Icon name={name} className={className} />;
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
      {SHELL_GLYPHS[name]}
    </svg>
  );
}
