import type { JSX, ReactNode } from 'react';

import { cx } from './cx';

const FRAME = 'flex flex-col items-center rounded-panel border border-dashed border-border px-4 py-10 text-center md:px-8 md:py-16';

export interface EmptyStateProps {
  title: ReactNode;
  /** One line on what to do next. An empty screen is an invitation to act, never a mood. */
  children?: ReactNode;
  /** One action: a button, a link, or the payment address with a copy button. */
  action?: ReactNode;
  headingLevel?: 2 | 3;
  className?: string;
}

/** closeout's empty state (docs/DESIGN.md 11.8): a dashed panel, a title, one line, one action. */
export function EmptyState({ title, children, action, headingLevel = 2, className }: EmptyStateProps): JSX.Element {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <div className={cx(FRAME, 'gap-3', className)}>
      <Heading className="text-h3 text-ink">{title}</Heading>
      {children === undefined ? null : <div className="max-w-reading text-body text-ink-secondary">{children}</div>}
      {action === undefined ? null : <div className="mt-1 flex w-full max-w-reading flex-col items-center">{action}</div>}
    </div>
  );
}

/**
 * closeout's loading panel for a whole view whose layout is not known yet (11.9). It names what loads. Use
 * skeletons when the layout is known.
 */
export function LoadingState({ label, className }: { label: string; className?: string }): JSX.Element {
  return (
    <div role="status" aria-live="polite" className={cx(FRAME, 'justify-center text-body text-ink-muted', className)}>
      {label}
    </div>
  );
}
