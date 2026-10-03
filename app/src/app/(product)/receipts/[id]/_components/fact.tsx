import type { JSX, ReactNode } from 'react';

import { cx } from '@/components/ui/cx';

/**
 * One fact in a receipt panel: a quiet term over its value and an optional line under it. Panels lay facts out in a
 * two-column grid from 640 px. A fact read from logs or the rule's history says "derived" after its term (PRD 10).
 */
export interface FactProps {
  term: ReactNode;
  children: ReactNode;
  note?: ReactNode;
  derived?: boolean;
  /** Machine values: IBM Plex Mono, wrapping anywhere. */
  mono?: boolean;
  className?: string;
}

export function Fact({ term, children, note, derived = false, mono = false, className }: FactProps): JSX.Element {
  return (
    <div className={cx('min-w-0', className)}>
      <dt className="text-body-s text-ink-secondary">
        {term}
        {derived ? <span className="text-ink-muted"> (derived)</span> : null}
      </dt>
      <dd className={cx('mt-0.5 text-body-s text-ink', mono ? 'break-all font-mono text-mono-s' : 'break-words')}>{children}</dd>
      {note === undefined ? null : <dd className="mt-1 text-body-s text-ink-muted">{note}</dd>}
    </div>
  );
}

export function FactGrid({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return <dl className={cx('grid gap-x-8 gap-y-4 sm:grid-cols-2', className)}>{children}</dl>;
}

export interface PanelProps {
  id: string;
  title: ReactNode;
  /** h2 for the panels under the title, h3 for the cards inside the proof section. */
  headingLevel?: 2 | 3;
  /** Quiet words on the right of the title. */
  aside?: ReactNode;
  /** One line under the title. */
  intro?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** A details panel: a module with a text-h3 title, an optional line under it, then its content. */
export function ReceiptPanel({ id, title, headingLevel = 2, aside, intro, children, className }: PanelProps): JSX.Element {
  const titleId = `${id}-title`;
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <section id={id} aria-labelledby={titleId} className={cx('min-w-0 scroll-mt-6 rounded-module border border-border bg-surface p-card md:p-6', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Heading id={titleId} className="text-h3 text-ink">
          {title}
        </Heading>
        {aside === undefined ? null : <div className="text-body-s text-ink-muted">{aside}</div>}
      </div>
      {intro === undefined ? null : <p className="mt-1 max-w-reading text-body-s text-ink-secondary">{intro}</p>}
      {children}
    </section>
  );
}
