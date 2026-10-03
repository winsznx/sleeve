import type { JSX, ReactNode } from 'react';

import { cx } from './cx';

/**
 * Line icons on a 20 px grid: 1.5 px stroke, round caps and joins, currentColor (docs/DESIGN.md 11.12). Every
 * glyph is decorative, so the svg is hidden from assistive technology; a control that shows only an icon names
 * itself with aria-label. There is deliberately no feather, quill, lock, shield or fingerprint shape.
 */
export const ICON_NAMES = [
  'home',
  'inbox',
  'receipt',
  'rule',
  'sell',
  'verify',
  'receive',
  'more',
  'close',
  'copy',
  'check',
  'share',
  'chevronLeft',
  'chevronRight',
  'chevronDown',
  'external',
  'alert',
  'info',
  'clock',
  'key',
  'wallet',
  'arrowRight',
  'arrowDown',
  'pause',
  'play',
  'pin',
  'split',
  'send',
  'calendar',
  'help',
  'chart',
] as const;

export type IconName = (typeof ICON_NAMES)[number];

const GLYPHS: Record<IconName, ReactNode> = {
  home: (
    <>
      <path d="M2.75 9.25 10 3l7.25 6.25" />
      <path d="M4.75 7.75v8.5a1 1 0 0 0 1 1h2.5v-4.5h3.5v4.5h2.5a1 1 0 0 0 1-1v-8.5" />
    </>
  ),
  inbox: (
    <>
      <path d="M2.75 11.25 4.6 4.4a1.5 1.5 0 0 1 1.45-1.15h7.9a1.5 1.5 0 0 1 1.45 1.15l1.85 6.85v4.5a1.5 1.5 0 0 1-1.5 1.5H4.25a1.5 1.5 0 0 1-1.5-1.5Z" />
      <path d="M2.75 11.25H7l1 2h4l1-2h4.25" />
    </>
  ),
  receipt: (
    <>
      <path d="M4.75 2.75h10.5v14.5l-2.1-1.4-1.75 1.4L10 15.85l-1.4 1.4-1.75-1.4-2.1 1.4Z" />
      <path d="M7.5 6.75h5M7.5 9.75h5M7.5 12.75h3" />
    </>
  ),
  rule: (
    <>
      <path d="M3 6.5h7M14 6.5h3M3 13.5h3M10 13.5h7" />
      <circle cx="12" cy="6.5" r="2" />
      <circle cx="8" cy="13.5" r="2" />
    </>
  ),
  sell: (
    <>
      <path d="M3.75 7h11.5M12 3.75 15.25 7 12 10.25" />
      <path d="M16.25 13H4.75M8 9.75 4.75 13 8 16.25" />
    </>
  ),
  verify: (
    <>
      <circle cx="10" cy="10" r="7.25" />
      <path d="m7 10.25 2 2 4-4.25" />
    </>
  ),
  receive: (
    <>
      <path d="M10 2.75v9M6.5 8.25 10 11.75l3.5-3.5" />
      <path d="M3.75 13.25v2a1.5 1.5 0 0 0 1.5 1.5h9.5a1.5 1.5 0 0 0 1.5-1.5v-2" />
    </>
  ),
  more: (
    <>
      <circle cx="4.5" cy="10" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="10" cy="10" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="10" r="1.25" fill="currentColor" stroke="none" />
    </>
  ),
  close: <path d="m5 5 10 10M15 5 5 15" />,
  copy: (
    <>
      <rect x="7" y="7" width="10.25" height="10.25" rx="2" />
      <path d="M13 7V4.75a2 2 0 0 0-2-2H4.75a2 2 0 0 0-2 2V11a2 2 0 0 0 2 2H7" />
    </>
  ),
  check: <path d="M4.25 10.5 8 14.25l7.75-8.5" />,
  share: (
    <>
      <path d="M10 2.75v9.5M6.5 6.25 10 2.75l3.5 3.5" />
      <path d="M6.25 9.25h-1.5a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h10.5a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1h-1.5" />
    </>
  ),
  chevronLeft: <path d="M12.5 4.5 7 10l5.5 5.5" />,
  chevronRight: <path d="M7.5 4.5 13 10l-5.5 5.5" />,
  chevronDown: <path d="m5 7.5 5 5 5-5" />,
  external: <path d="M6.5 13.5 13.5 6.5M8 6.5h5.5V12" />,
  alert: (
    <>
      <circle cx="10" cy="10" r="7.25" />
      <path d="M10 6.25v4.5M10 13.6v.15" />
    </>
  ),
  info: (
    <>
      <circle cx="10" cy="10" r="7.25" />
      <path d="M10 9.25v4.5M10 6.4v.15" />
    </>
  ),
  clock: (
    <>
      <circle cx="10" cy="10" r="7.25" />
      <path d="M10 6v4.25l2.75 1.75" />
    </>
  ),
  /** A key on its side: the passkey that signs for the account. */
  key: (
    <>
      <circle cx="6.75" cy="10" r="3.5" />
      <path d="M10.25 10h7M14.75 10v2.75M17.25 10v2" />
    </>
  ),
  /** A wallet with its clasp: a wallet the owner already has. */
  wallet: (
    <>
      <path d="M15.25 6.25V4.75a1.5 1.5 0 0 0-1.5-1.5h-8.5a2.5 2.5 0 0 0 0 5" />
      <path d="M2.75 5.75v9a2 2 0 0 0 2 2h10.5a1.5 1.5 0 0 0 1.5-1.5v-5.5a1.5 1.5 0 0 0-1.5-1.5H5.25a2.5 2.5 0 0 1-2.5-2.5Z" />
      <path d="M13.25 12.25h.1" />
    </>
  ),
  arrowRight: <path d="M3.75 10h12.5M11.75 5.5 16.25 10l-4.5 4.5" />,
  arrowDown: <path d="M10 3.75v12.5M5.5 11.75 10 16.25l4.5-4.5" />,
  pause: <path d="M7.25 4.75v10.5M12.75 4.75v10.5" />,
  play: <path d="M6.25 4.4v11.2a.6.6 0 0 0 .9.52l9.3-5.6a.6.6 0 0 0 0-1.04l-9.3-5.6a.6.6 0 0 0-.9.52Z" />,
  /** A map pin: where someone lives, for the eligibility step. */
  pin: (
    <>
      <path d="M10 17.25s-5.25-4.6-5.25-8.75a5.25 5.25 0 0 1 10.5 0c0 4.15-5.25 8.75-5.25 8.75Z" />
      <circle cx="10" cy="8.5" r="1.75" />
    </>
  ),
  /** One line that forks in two: a payment splitting by the rule. */
  split: (
    <>
      <path d="M2.75 10h5.5" />
      <path d="M8.25 10c2.5 0 3-4.25 5.75-4.25h3.25M8.25 10c2.5 0 3 4.25 5.75 4.25h3.25" />
    </>
  ),
  /** Receive turned around: USDG leaving the account for an outside address. */
  send: (
    <>
      <path d="M10 11.75v-9M6.5 6.25 10 2.75l3.5 3.5" />
      <path d="M3.75 13.25v2a1.5 1.5 0 0 0 1.5 1.5h9.5a1.5 1.5 0 0 0 1.5-1.5v-2" />
    </>
  ),
  calendar: (
    <>
      <rect x="2.75" y="4.25" width="14.5" height="13" rx="2" />
      <path d="M2.75 8.25h14.5M6.75 2.75v3M13.25 2.75v3" />
    </>
  ),
  help: (
    <>
      <circle cx="10" cy="10" r="7.25" />
      <path d="M7.9 7.75a2.15 2.15 0 0 1 4.2.6c0 1.45-2.1 1.9-2.1 3.15M10 13.9v.1" />
    </>
  ),
  /** Bars on a baseline: paydays over time. */
  chart: (
    <>
      <path d="M2.75 16.75h14.5" />
      <path d="M5.25 13.75v-4M9.25 13.75v-8M13.25 13.75V8.5" />
    </>
  ),
};

export interface IconProps {
  name: IconName;
  /** Sizing and color. Defaults to size-icon (20 px) in the current text color. */
  className?: string;
}

export function Icon({ name, className }: IconProps): JSX.Element {
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
      {GLYPHS[name]}
    </svg>
  );
}
