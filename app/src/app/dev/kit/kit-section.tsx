import type { JSX, ReactNode } from 'react';

import { cx } from '@/components/ui/cx';

export interface KitSectionProps {
  id: string;
  title: string;
  /** What the section shows and where its rules live in docs/DESIGN.md. */
  description?: ReactNode;
  children: ReactNode;
}

/** One group of components on the kit page. */
export function KitSection({ id, title, description, children }: KitSectionProps): JSX.Element {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-6 border-t border-border py-10">
      <h2 id={`${id}-title`} className="text-h2 text-ink">
        {title}
      </h2>
      {description === undefined ? null : <p className="mt-1 max-w-reading text-body-s text-ink-secondary">{description}</p>}
      <div className="mt-6 flex flex-col gap-8">{children}</div>
    </section>
  );
}

export interface KitExampleProps {
  /** The state shown, in plain words. */
  label: string;
  children: ReactNode;
  className?: string;
}

/** One component in one state, with its label above. */
export function KitExample({ label, children, className }: KitExampleProps): JSX.Element {
  return (
    <div className={cx('min-w-0', className)}>
      <p className="mb-2 text-label font-medium text-ink-muted">{label}</p>
      {children}
    </div>
  );
}

/** Examples side by side from 768, stacked below. */
export function KitGrid({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return <div className={cx('grid gap-8 md:grid-cols-2', className)}>{children}</div>;
}
