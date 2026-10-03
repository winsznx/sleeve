import type { JSX } from 'react';

import { SiteLink } from '@/components/shell/site-link';
import { footerColumns } from '@/components/shell/site-map';
import { NetworkGlyph } from '@/components/token/glyphs';
import { Wordmark } from '@/components/ui/wordmark';
import { BRAND_NAME, BUILT_ON_LINE, DISCLAIMER } from '@/lib/copy';

/** The line of copy under the wordmark: PRD section 1's description, in plain words. */
export const FOOTER_LINE = 'A payment address that invests part of every payment. You set the split once.';

/**
 * Closeout's column footer (docs/design/closeout-landing-blueprint.md 10) for the marketing and public pages: the
 * wordmark with one line of copy and the network as words, then Product, Proof and Legal, then the disclaimer word
 * for word at readable contrast, never collapsed (docs/DESIGN.md 12.9). Two columns from 640 px, five from 1024.
 */
export function SiteFooter(): JSX.Element {
  const year = new Date().getUTCFullYear();
  return (
    <footer className="mt-auto border-t border-border bg-canvas">
      <div className="mx-auto w-full max-w-content px-gutter pb-10 pt-12 md:pt-16">
        <div className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]">
          <div className="flex flex-col items-start gap-3">
            <Wordmark href="/" />
            <p className="max-w-xs text-body-s text-ink-secondary">{FOOTER_LINE}</p>
            <p className="mt-1 inline-flex items-center gap-2 text-body-s text-ink-secondary">
              <NetworkGlyph className="size-4" />
              {BUILT_ON_LINE}
            </p>
          </div>
          {footerColumns().map((column) => (
            <nav key={column.heading} aria-label={column.heading}>
              <h2 className="text-body-s font-semibold text-ink">{column.heading}</h2>
              <ul className="mt-2">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <SiteLink
                      href={link.href}
                      className="inline-flex min-h-touch items-center text-body-s text-ink-secondary transition-colors duration-fast ease-standard hover:text-ink sm:min-h-9"
                    >
                      {link.label}
                    </SiteLink>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="mt-10 flex flex-col gap-3 border-t border-border pt-6 md:flex-row md:items-start md:justify-between md:gap-10">
          <p className="max-w-reading text-body-s text-ink-secondary">{DISCLAIMER}</p>
          <p className="shrink-0 text-body-s text-ink-secondary">
            © {year} {BRAND_NAME}
          </p>
        </div>
      </div>
    </footer>
  );
}
