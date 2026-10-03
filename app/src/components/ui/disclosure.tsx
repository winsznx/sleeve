import { DISCLOSURE } from '@sleeve/core';
import type { JSX } from 'react';

import { CopyButton } from './copy-field';
import { cx } from './cx';
import { formatIsoDate } from './format-time';

/** The Issuer Website the text was copied from (docs/disclosure/README.md). */
const ISSUER_WEBSITE = DISCLOSURE.sources[1];

/** Where receipts link to: a receipt's disclosure hash points at this block (docs/DESIGN.md 12.4). */
export const DISCLOSURE_ANCHOR = 'issuer-disclosure';

export interface DisclosureProps {
  /**
   * The issuer's text as served, one string per paragraph: disclosureParagraphs(await readDisclosureText()) from
   * @/lib/disclosure in a server component. That helper checks the bytes against the pinned hash, so the text shown
   * is always the text the receipts hash. Never retype it.
   */
  paragraphs: readonly string[];
  headingLevel?: 2 | 3;
  /** The anchor id. Keep the default so receipt links land here. */
  id?: string;
  className?: string;
}

/**
 * The issuer's status and risk disclosure, word for word (PRD 10, docs/DESIGN.md 12.6): retrieval date and source,
 * the full keccak256 hash the module stores, then the text one paragraph per line of the file. Nothing inside the
 * text is bolded, linked, edited or cut short.
 */
export function Disclosure({ paragraphs, headingLevel = 2, id = DISCLOSURE_ANCHOR, className }: DisclosureProps): JSX.Element {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const titleId = `${id}-title`;
  return (
    <section id={id} aria-labelledby={titleId} className={cx('min-w-0 rounded-panel bg-surface-muted p-card', className)}>
      <Heading id={titleId} className="text-h3 text-ink">
        Issuer disclosure
      </Heading>
      <p className="mt-1 text-body-s text-ink-secondary">
        Copied word for word from{' '}
        <a href={ISSUER_WEBSITE} className="text-link underline underline-offset-4 hover:text-link-hover">
          docs.robinhood.com/rhj
        </a>
        , retrieved {formatIsoDate(DISCLOSURE.retrievedOn)}.
      </p>
      <div className="mt-3 flex items-start gap-1">
        <p className="min-w-0 flex-1 py-2.5 text-body-s text-ink-secondary">
          <span className="block">keccak256 of the text</span>
          <span className="block break-all font-mono text-mono-s">{DISCLOSURE.keccak256}</span>
        </p>
        <CopyButton value={DISCLOSURE.keccak256} label="Copy disclosure hash" className="mt-1.5" />
      </div>
      <div className="mt-4 max-w-reading space-y-3 text-body-s text-ink">
        {paragraphs.map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
      </div>
    </section>
  );
}
