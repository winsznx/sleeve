import type { JSX, ReactNode } from 'react';

import { cx } from '@/components/ui/cx';
import { Icon, type IconName } from '@/components/ui/icons';
import { SplitMark } from '@/components/ui/wordmark';

/**
 * Pieces every landing section shares, after closeout's marketing furniture (docs/design/closeout-landing-blueprint.md
 * section 1.6): the container, the eyebrow pill, the section headings and the round icon tile.
 */

/** closeout's m-container: 1200 px wide with the page gutter. */
export const LANDING_CONTAINER = 'mx-auto w-full max-w-content px-gutter';

/**
 * A landing section's top: 104 px of space above from 768 px (64 px on a phone). A jump to the section skips that
 * space and lands its content 6rem down, clear of the sticky header and level with where scroll-mt-24 lands a card.
 */
export const LANDING_SECTION = 'pt-section scroll-mt-[calc(var(--space-24)_-_var(--layout-section))]';

export interface EyebrowProps {
  children: ReactNode;
  /** Replaces the split mark, for a pill that carries live state. */
  mark?: ReactNode;
  className?: string;
}

/**
 * The eyebrow pill with Sleeve's split mark in place of closeout's asterisk. Unlike closeout's nowrap pill it may wrap
 * on a narrow phone (blueprint defect 9).
 */
export function Eyebrow({ children, mark, className }: EyebrowProps): JSX.Element {
  return (
    <p
      className={cx(
        'inline-flex min-h-control-sm max-w-full items-center gap-2.5 rounded-pill border border-border bg-surface px-4 py-2 text-left text-body-s text-ink-secondary shadow-soft',
        className,
      )}
    >
      {mark ?? <SplitMark />}
      <span className="min-w-0">{children}</span>
    </p>
  );
}

export interface SectionProps {
  id: string;
  titleId: string;
  children: ReactNode;
  className?: string;
}

/** A landing section in the page container, spaced and anchored by LANDING_SECTION. */
export function LandingSection({ id, titleId, children, className }: SectionProps): JSX.Element {
  return (
    <section id={id} aria-labelledby={titleId} className={cx(LANDING_SECTION, className)}>
      <div className={LANDING_CONTAINER}>{children}</div>
    </section>
  );
}

export interface HeadingProps {
  titleId: string;
  /** closeout's pill above the heading: an Eyebrow naming the section, or one carrying live state. */
  eyebrow?: ReactNode;
  title: ReactNode;
  lead: ReactNode;
  className?: string;
}

/**
 * closeout's split heading (blueprint 1.6): the eyebrow, 28 px, then the title on the left and its lead on the right,
 * sharing a baseline from 768 px. On a phone the lead stacks under the title.
 */
export function SplitHeading({ titleId, eyebrow, title, lead, className }: HeadingProps): JSX.Element {
  return (
    <div className={cx('flex flex-col items-start gap-7', className)}>
      {eyebrow}
      <div className="grid w-full gap-4 md:grid-cols-[minmax(0,1.05fr)_minmax(0,0.85fr)] md:items-end md:gap-10">
        <h2 id={titleId} className="text-balance text-display-l text-ink">
          {title}
        </h2>
        <p className="max-w-[36rem] text-pretty text-body-l text-ink-secondary md:pb-1.5">{lead}</p>
      </div>
    </div>
  );
}

/** Eyebrow, title and lead centered in 780 px, 20 px apart. */
export function CenteredHeading({ titleId, eyebrow, title, lead, className }: HeadingProps): JSX.Element {
  return (
    <div className={cx('mx-auto flex max-w-[48.75rem] flex-col items-center gap-5 text-center', className)}>
      {eyebrow}
      <h2 id={titleId} className="text-balance text-display-l text-ink">
        {title}
      </h2>
      <p className="max-w-[40rem] text-pretty text-body-l text-ink-secondary">{lead}</p>
    </div>
  );
}

/**
 * One icon tile style for every card (blueprint defect 7): a white disc with a green line icon. 44 px on the three
 * cards, 52 px on the sleeve cards, as closeout's feature icon.
 */
export function IconDisc({ name, size = 'md', className }: { name: IconName; size?: 'md' | 'lg'; className?: string }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'grid shrink-0 place-items-center rounded-pill bg-surface text-accent',
        size === 'lg' ? 'size-[3.25rem]' : 'size-11',
        className,
      )}
    >
      <Icon name={name} />
    </span>
  );
}

export type SplitKind = 'spend' | 'equity' | 'waiting';

const DOT: Record<SplitKind, string> = {
  spend: 'bg-spend',
  equity: 'bg-equity',
  waiting: 'bg-waiting',
};

/** A 10 px dot in a part of the split's color, beside the word that names it. Solid, as legends are (DESIGN 12.1). */
export function SplitDot({ kind, className }: { kind: SplitKind; className?: string }): JSX.Element {
  return <span aria-hidden="true" className={cx('size-2.5 shrink-0 rounded-pill', DOT[kind], className)} />;
}
