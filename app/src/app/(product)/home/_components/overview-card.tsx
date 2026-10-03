import { useId, type JSX, type ReactNode } from 'react';

import { cx } from '@/components/ui/cx';

export interface OverviewCardProps {
  title: ReactNode;
  /** A control or a quiet line on the right of the title: a period switch, a count, a link. */
  aside?: ReactNode;
  /** One line under the title. */
  lede?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}

/**
 * One card of the overview (D-029): the reference's large-radius panel with its title row, in Sleeve's surface and
 * hairline. Every card fills its grid cell, so cards that share a row end level and no column is left half empty.
 */
export function OverviewCard({ title, aside, lede, children, className, id }: OverviewCardProps): JSX.Element {
  const headingId = useId();
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={cx('flex min-w-0 scroll-mt-24 flex-col rounded-card border border-border bg-surface p-4 sm:p-5 xl:p-6', className)}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h2 id={headingId} className="text-h2 text-ink">
            {title}
          </h2>
          {lede === undefined ? null : <div className="mt-1 text-body-s text-ink-secondary">{lede}</div>}
        </div>
        {aside === undefined ? null : <div className="flex shrink-0 flex-wrap items-center gap-2">{aside}</div>}
      </div>
      <div className="mt-4 flex min-w-0 flex-1 flex-col">{children}</div>
    </section>
  );
}
