import Link from 'next/link';
import type { JSX, ReactNode } from 'react';

import { cx } from './cx';
import { Icon } from './icons';

export interface PageHeaderProps {
  /** The page's h1. One per page. */
  title: ReactNode;
  /** One or two sentences in secondary ink, at most the reading measure. */
  description?: ReactNode;
  /** A way back up for nested pages, such as a receipt back to the receipt list. */
  back?: { href: string; label: string };
  /** Buttons for the page's actions. They sit under the title on a phone and to its right from 768. */
  actions?: ReactNode;
  className?: string;
}

/** closeout's page heading: title, a quiet line under it, actions on the right on wide screens. */
export function PageHeader({ title, description, back, actions, className }: PageHeaderProps): JSX.Element {
  return (
    <header className={cx('mb-6 md:mb-7', className)}>
      {back === undefined ? null : (
        <Link
          href={back.href}
          className="-ml-1 mb-1 inline-flex min-h-touch items-center gap-1 rounded-control pr-2 text-body-s text-ink-secondary transition-colors duration-fast ease-standard hover:text-ink"
        >
          <Icon name="chevronLeft" className="size-4" />
          {back.label}
        </Link>
      )}
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-6">
        <div className="min-w-0">
          <h1 className="break-words text-h1 text-ink">{title}</h1>
          {description === undefined ? null : <div className="mt-2 max-w-reading text-body text-ink-secondary">{description}</div>}
        </div>
        {actions === undefined ? null : <div className="flex shrink-0 flex-wrap items-center gap-2.5">{actions}</div>}
      </div>
    </header>
  );
}
