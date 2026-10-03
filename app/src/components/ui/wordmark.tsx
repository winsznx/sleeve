import Link from 'next/link';
import type { JSX } from 'react';

import { BRAND_NAME } from '@/lib/copy';

import { cx } from './cx';

export interface WordmarkProps {
  /** Makes the wordmark a link, usually home. */
  href?: string;
  className?: string;
}

/**
 * The word "Sleeve" in text-h2 ink (docs/DESIGN.md 12.9). It is the most prominent brand on every screen; no
 * Robinhood Chain mention on the same screen is larger or heavier. Sleeve has no logo yet.
 */
export function Wordmark({ href, className }: WordmarkProps): JSX.Element {
  if (href === undefined) return <span className={cx('text-h2 text-ink', className)}>{BRAND_NAME}</span>;
  return (
    <Link href={href} className={cx('inline-flex min-h-touch items-center rounded-control text-h2 text-ink', className)}>
      {BRAND_NAME}
    </Link>
  );
}

/** The 14 by 6 px split mark that replaces closeout's asterisk in an eyebrow pill: spend in ink, equity in green. */
export function SplitMark({ className }: { className?: string }): JSX.Element {
  return (
    <span aria-hidden="true" className={cx('inline-flex h-1.5 w-3.5 shrink-0 gap-px', className)}>
      <span className="h-full w-2/3 rounded-pill bg-spend" />
      <span className="h-full w-1/3 rounded-pill bg-equity" />
    </span>
  );
}
