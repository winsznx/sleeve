import { DISCLOSURE } from '@sleeve/core';
import type { JSX } from 'react';

import { CopyButton } from '@/components/ui/copy-field';
import { cx } from '@/components/ui/cx';
import { DISCLOSURE_ANCHOR } from '@/components/ui/disclosure';
import { formatIsoDate } from '@/components/ui/format-time';
import { Icon } from '@/components/ui/icons';
import { ISSUER_NAME } from '@/lib/copy';

/** The Issuer Website the text was copied from (docs/disclosure/README.md). */
const ISSUER_WEBSITE = DISCLOSURE.sources[1];

export interface IssuerDisclosureProps {
  /**
   * The issuer's text as served, one string per paragraph: disclosureParagraphs(await readDisclosureText()) from
   * @/lib/disclosure in a server component, which checks the bytes against the pinned hash first. Never retype it.
   */
  paragraphs: readonly string[];
  /** Where the served text file lives, so a reader can hash the exact bytes (DISCLOSURE_PUBLIC_PATH). */
  rawHref: string;
  headingLevel?: 2 | 3;
  className?: string;
}

/**
 * The issuer's status and risk disclosure, word for word (PRD 10, docs/DESIGN.md 12.6), as a document block: who
 * wrote it, where it was copied from and when, the keccak256 every receipt carries and the raw file it covers sit
 * above the text, two by two from 640 px, and in a side column beside it from 1280 px, where the text still gets a
 * full reading width. Nothing inside the text is bolded, linked, edited or cut. Receipts link here through
 * DISCLOSURE_ANCHOR.
 */
export function IssuerDisclosure({ paragraphs, rawHref, headingLevel = 2, className }: IssuerDisclosureProps): JSX.Element {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const titleId = `${DISCLOSURE_ANCHOR}-title`;
  return (
    <section
      id={DISCLOSURE_ANCHOR}
      aria-labelledby={titleId}
      className={cx('min-w-0 scroll-mt-6 overflow-hidden rounded-module border border-border bg-surface', className)}
    >
      <header className="flex items-start gap-3 border-b border-border bg-surface-muted px-card py-4 md:px-6">
        <span aria-hidden="true" className="grid size-icon-tile shrink-0 place-items-center rounded-row border border-border bg-surface text-ink-secondary">
          <Icon name="receipt" />
        </span>
        <div className="min-w-0">
          <Heading id={titleId} className="text-h3 text-ink">
            Issuer disclosure
          </Heading>
          <p className="mt-0.5 text-body-s text-ink-secondary">From {ISSUER_NAME}, shown word for word.</p>
        </div>
      </header>
      <div className="grid gap-6 p-card md:p-6 xl:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] xl:gap-10">
        <dl className="grid min-w-0 gap-4 text-body-s sm:grid-cols-2 xl:flex xl:flex-col xl:border-r xl:border-border xl:pr-6">
          <div>
            <dt className="text-ink-secondary">Copied from</dt>
            <dd className="mt-0.5">
              <a href={ISSUER_WEBSITE} className="font-medium text-link underline underline-offset-4 hover:text-link-hover">
                docs.robinhood.com/rhj
              </a>
            </dd>
          </div>
          <div>
            <dt className="text-ink-secondary">Retrieved</dt>
            <dd className="mt-0.5 text-ink">{formatIsoDate(DISCLOSURE.retrievedOn)}</dd>
          </div>
          <div>
            <dt className="text-ink-secondary">keccak256 of the text</dt>
            <dd className="mt-0.5 flex items-start gap-1">
              <span className="min-w-0 flex-1 break-all py-px font-mono text-mono-s text-ink">{DISCLOSURE.keccak256}</span>
              <CopyButton value={DISCLOSURE.keccak256} label="Copy disclosure hash" className="-my-3 -mr-2.5" />
            </dd>
            <dd className="mt-1 text-ink-muted">Every receipt carries this hash, and the verifier checks the text against it.</dd>
          </div>
          <div>
            <dt className="text-ink-secondary">The exact bytes</dt>
            <dd className="mt-0.5">
              <a href={rawHref} className="font-medium text-link underline underline-offset-4 hover:text-link-hover">
                rhj-disclosure.txt
              </a>
            </dd>
          </div>
        </dl>
        <div className="min-w-0 max-w-reading space-y-3 text-body-s text-ink">
          {paragraphs.map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </div>
      </div>
    </section>
  );
}
