import Link from 'next/link';
import type { JSX } from 'react';

import { SleeveLogo } from '@/generated/brand/sleeve-logo';
import { BRAND_NAME } from '@/lib/copy';

import { cx } from './cx';

export interface WordmarkProps {
  /** Makes the logo a link, usually home. */
  href?: string;
  /** Height in px; the brand kit's minimum for the horizontal lockup is 20. */
  height?: number;
  className?: string;
}

/**
 * Sleeve's horizontal lockup from the brand kit (D-037): the symbol and the lowercase wordmark, coloured for the theme
 * by sleeve-logo.css. It is the most prominent brand on every screen (docs/DESIGN.md 12.9); no Robinhood Chain mention
 * on the same screen is larger or heavier.
 */
export function Wordmark({ href, height = 24, className }: WordmarkProps): JSX.Element {
  const logo = <SleeveLogo variant="horizontal" height={height} title={BRAND_NAME} />;
  if (href === undefined) return <span className={cx('inline-flex shrink-0', className)}>{logo}</span>;
  return (
    <Link href={href} className={cx('inline-flex min-h-touch shrink-0 items-center rounded-control', className)}>
      {logo}
    </Link>
  );
}

/**
 * The brand symbol at 16 px, the kit's micro drawing: one account with the share set aside in its corner. It replaces
 * closeout's asterisk in an eyebrow pill and marks the rule wherever a split is named.
 */
export function SplitMark({ className }: { className?: string }): JSX.Element {
  return (
    <span aria-hidden="true" className={cx('inline-flex shrink-0', className)}>
      <SleeveLogo variant="symbol" height={16} />
    </span>
  );
}
