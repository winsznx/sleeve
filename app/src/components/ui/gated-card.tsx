import type { JSX, ReactNode } from 'react';

import { GatedTag } from './badge';
import { cx } from './cx';

export interface GatedCardProps {
  /**
   * One sentence that names the feature and says it is not available yet, such as "Borrowing USDG against your
   * Stock Tokens is not available yet." The copy lint passes a feature name only in a string that says so.
   */
  children: ReactNode;
  className?: string;
}

/**
 * A feature that is not live (docs/DESIGN.md 12.8): borrow, the pay link, baskets, crews. A dashed card with the
 * gated tag and one sentence. No button, no numbers, never in navigation, never on the home screen as an action.
 */
export function GatedCard({ children, className }: GatedCardProps): JSX.Element {
  return (
    <div className={cx('rounded-module border border-dashed border-border-strong bg-surface-muted p-card', className)}>
      <GatedTag />
      <div className="mt-2 text-body-s text-ink-secondary">{children}</div>
    </div>
  );
}
