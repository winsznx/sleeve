import Link from 'next/link';
import type { JSX, ReactNode } from 'react';

import { cx } from '@/components/ui/cx';
import { Wordmark } from '@/components/ui/wordmark';

export interface PublicFrameProps {
  children: ReactNode;
  /** reading for forms and cards; form for the verifier's field by field results. */
  width?: 'reading' | 'form';
  /** Marks the verify link as the current page on /verify itself. */
  current?: 'verify';
}

/**
 * The frame for pages anyone can open without an account: the card a person shared and the verifier. The wordmark
 * leads, the page sits in one centered column, and the root layout adds the disclaimer footer after it.
 */
export function PublicFrame({ children, width = 'reading', current }: PublicFrameProps): JSX.Element {
  return (
    <>
      <header className="border-b border-border">
        <div className="mx-auto flex min-h-topbar w-full max-w-content items-center justify-between gap-3 px-gutter">
          <Wordmark href="/" />
          <nav aria-label="Public pages">
            <Link
              href="/verify"
              aria-current={current === 'verify' ? 'page' : undefined}
              className={cx(
                'inline-flex min-h-touch items-center rounded-control px-1 text-body-s transition-colors duration-fast ease-standard hover:text-ink',
                current === 'verify' ? 'font-semibold text-ink' : 'font-medium text-ink-secondary',
              )}
            >
              Verify a receipt
            </Link>
          </nav>
        </div>
      </header>
      <main
        id="main-content"
        className={cx('mx-auto w-full px-gutter pb-16 pt-6 md:pt-10', width === 'form' ? 'max-w-form' : 'max-w-reading')}
      >
        {children}
      </main>
    </>
  );
}
