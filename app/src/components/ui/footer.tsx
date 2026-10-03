import type { JSX, ReactNode } from 'react';

import { DISCLAIMER } from '@/lib/copy';

import { cx } from './cx';

export interface FooterProps {
  /** Optional links above the disclaimer, such as the issuer disclosure or the verifier. */
  children?: ReactNode;
  className?: string;
}

/**
 * The page footer (docs/DESIGN.md 12.9). The non-affiliation disclaimer is printed word for word and is never
 * collapsed. The root layout renders this once for every page through SiteFooter, so screens never add another.
 */
export function Footer({ children, className }: FooterProps): JSX.Element {
  return (
    <footer className={cx('border-t border-border bg-canvas', className)}>
      <div className="mx-auto w-full max-w-content px-gutter py-8">
        {children === undefined ? null : <div className="mb-4 flex flex-wrap gap-x-5 gap-y-2 text-body-s">{children}</div>}
        <p className="max-w-reading text-body-s text-ink-secondary">{DISCLAIMER}</p>
      </div>
    </footer>
  );
}
