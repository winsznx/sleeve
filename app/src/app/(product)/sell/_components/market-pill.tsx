import type { JSX } from 'react';

import { cx } from '@/components/ui/cx';

import type { MarketState } from '../sell-text';

/**
 * The live market for the token a sell would move: open in green, closed in amber, paused in red, each with its
 * word. Color never works alone; the dot only repeats what the label says.
 */

/** A closed market's mark is striped, as everywhere Sleeve draws money waiting on the session. */
const LOOK: Record<MarketState['tone'], { pill: string; dot: string }> = {
  open: { pill: 'bg-success-soft text-success', dot: 'bg-success' },
  closed: { pill: 'bg-waiting-soft text-waiting', dot: 'bg-waiting-stripes' },
  paused: { pill: 'bg-danger-soft text-danger', dot: 'bg-danger' },
};

export function MarketPill({ state, className }: { state: MarketState; className?: string }): JSX.Element {
  const look = LOOK[state.tone];
  return (
    <span
      title={state.detail ?? undefined}
      className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill px-2.5 py-1 text-label font-semibold', look.pill, className)}
    >
      <span aria-hidden="true" className={cx('size-2.5 rounded-pill', look.dot)} />
      {state.label}
    </span>
  );
}
