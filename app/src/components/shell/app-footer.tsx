import Link from 'next/link';
import type { JSX } from 'react';

import { DISCLAIMER } from '@/lib/copy';

import { DISCLOSURE_PATH, VERIFY_PATH } from './site-map';

const LINK = 'inline-flex min-h-touch items-center text-ink-secondary transition-colors duration-fast ease-standard hover:text-ink';

/**
 * The app's footer line at the end of the workspace: the disclaimer word for word, never collapsed (docs/DESIGN.md
 * 12.9), with the issuer disclosure, the public check and the way back to the site. The column footer is for the
 * marketing and public pages.
 */
export function AppFooter(): JSX.Element {
  return (
    <footer className="mt-auto border-t border-border px-gutter py-5">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between lg:gap-8">
        <p className="max-w-reading text-body-s text-ink-secondary">{DISCLAIMER}</p>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-5 text-body-s">
          <a href={DISCLOSURE_PATH} className={LINK}>
            Issuer disclosure
          </a>
          <Link href={VERIFY_PATH} className={LINK}>
            Check a split
          </Link>
          <Link href="/" className={LINK}>
            About Sleeve
          </Link>
        </nav>
      </div>
    </footer>
  );
}
