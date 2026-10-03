import type { JSX } from 'react';

import { ButtonLink } from '@/components/ui/button';
import { Wordmark } from '@/components/ui/wordmark';

/** In-page sections the header links to. The ids live on the landing page's sections. */
export const LANDING_SECTIONS = {
  how: 'how-it-works',
  receipts: 'receipts',
  eligibility: 'who-can-use-it',
  holdings: 'what-you-hold',
} as const;

const NAV = [
  { href: `#${LANDING_SECTIONS.how}`, label: 'How it works' },
  { href: `#${LANDING_SECTIONS.receipts}`, label: 'Receipts' },
  { href: `#${LANDING_SECTIONS.eligibility}`, label: 'Who can use it' },
] as const;

/**
 * The marketing header, closeout's m-header: the wordmark, section links from 768 px, and one way into the app. The
 * wordmark is the largest brand on the page (docs/DESIGN.md 12.9). A skip link comes first for keyboard users.
 */
export function MarketingHeader(): JSX.Element {
  return (
    <header className="sticky top-0 z-header border-b border-border bg-chrome backdrop-blur-lg">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-gutter focus:top-3 focus:z-toast focus:rounded-pill focus:bg-brand focus:px-4 focus:py-2.5 focus:text-body-s focus:font-medium focus:text-on-brand"
      >
        Skip to content
      </a>
      <div className="mx-auto flex min-h-topbar w-full max-w-content items-center justify-between gap-4 px-gutter">
        <Wordmark href="/" />
        <nav aria-label="Main" className="flex items-center gap-6">
          <ul className="hidden items-center gap-6 text-body-s md:flex">
            {NAV.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  className="inline-flex min-h-touch items-center text-ink-secondary transition-colors duration-fast ease-standard hover:text-ink"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
          <ButtonLink href="/home" variant="secondary" size="sm">
            Open the app
          </ButtonLink>
        </nav>
      </div>
    </header>
  );
}
