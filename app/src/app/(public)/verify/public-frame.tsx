import { CHAIN_ID, CHAIN_NAME } from '@sleeve/core';
import Link from 'next/link';
import type { JSX, ReactNode } from 'react';

import { NetworkGlyph } from '@/components/token/glyphs';
import { ButtonLink } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { Icon } from '@/components/ui/icons';
import { Wordmark } from '@/components/ui/wordmark';

export interface PublicFrameProps {
  children: ReactNode;
  /** reading for forms and cards; form for a single wide column; content for the verifier's two-column result. */
  width?: 'reading' | 'form' | 'content';
  /** Marks the verify link as the current page on /verify itself. */
  current?: 'verify';
}

const WIDTH: Record<NonNullable<PublicFrameProps['width']>, string> = {
  reading: 'max-w-reading',
  form: 'max-w-form',
  content: 'max-w-content',
};

/**
 * The frame for pages anyone can open without an account: the verifier and the pages a person shared. A 68 px bar
 * carries the wordmark, the network the receipts live on and a way into the app (docs/design/closeout-product-
 * blueprint.md 15.10); the page sits in one centered column, and the root layout adds the disclaimer footer after it.
 */
export function PublicFrame({ children, width = 'reading', current }: PublicFrameProps): JSX.Element {
  return (
    <>
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex min-h-topbar w-full max-w-content items-center justify-between gap-3 px-gutter">
          <div className="flex min-w-0 items-center gap-4">
            <Wordmark href="/" />
            <span className="hidden items-center gap-1.5 rounded-pill border border-border px-2.5 py-1 text-label font-medium text-ink-secondary md:inline-flex">
              <NetworkGlyph className="size-4" />
              {CHAIN_NAME}, chain id {CHAIN_ID}
            </span>
          </div>
          <nav aria-label="Public pages" className="flex shrink-0 items-center gap-1 sm:gap-3">
            <Link
              href="/verify"
              aria-current={current === 'verify' ? 'page' : undefined}
              className={cx(
                'inline-flex min-h-touch items-center gap-1.5 rounded-control px-2 text-body-s transition-colors duration-fast ease-standard hover:text-ink',
                current === 'verify' ? 'font-semibold text-ink' : 'font-medium text-ink-secondary',
              )}
            >
              <Icon name="verify" className="hidden size-4 sm:block" />
              Check a split
            </Link>
            <ButtonLink href="/home" variant="secondary" size="sm">
              Open the app
            </ButtonLink>
          </nav>
        </div>
      </header>
      {/* At least a window tall, so the footer starts below the fold and a result that reads in the browser never
          pushes it out of view. */}
      <main
        id="main-content"
        className={cx('mx-auto min-h-[calc(100dvh-var(--sample-notice-height,0px))] w-full px-gutter pb-16 pt-6 md:pt-10', WIDTH[width])}
      >
        {children}
      </main>
    </>
  );
}
