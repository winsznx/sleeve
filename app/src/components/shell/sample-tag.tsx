import type { JSX } from 'react';

import { cx } from '@/components/ui/cx';
import { DATA_SOURCE } from '@/data/source';

import type { SessionTone } from './market-session';

/** "Sample data", beside any figure the chrome shows while the mock data layer runs. Nothing on the chain source. */
export function SampleTag({ className }: { className?: string }): JSX.Element | null {
  if (DATA_SOURCE !== 'mock') return null;
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center rounded-control bg-info-soft px-2 py-0.5 text-label font-medium text-info',
        className,
      )}
    >
      Sample data
    </span>
  );
}

const MARK: Record<SessionTone, string> = {
  open: 'bg-equity',
  closed: 'bg-waiting-stripes ring-1 ring-inset ring-waiting',
  unknown: 'bg-waiting-stripes ring-1 ring-inset ring-waiting',
};

/**
 * The session's status mark: a solid green dot while the market is open, the waiting stripes while it is closed,
 * because closed is when the equity share waits as USDG. It carries real state, so it is allowed; it never pulses,
 * and the word beside it always says the same thing.
 */
export function SessionMark({ tone, className }: { tone: SessionTone; className?: string }): JSX.Element {
  return <span aria-hidden="true" className={cx('inline-block size-2.5 shrink-0 rounded-pill', MARK[tone], className)} />;
}
