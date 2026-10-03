import type { SessionReason } from '@sleeve/core';
import type { JSX, ReactNode } from 'react';

import { TokenIcon } from '@/components/token/token-icon';
import { tokenSymbol, type TokenKey } from '@/components/token/registry';
import { Button } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { formatNewYork } from '@/components/ui/format-time';
import type { SessionState } from '@/data/types';

/**
 * Small pieces the landing's live widgets share. They hold no state, so server sections and client islands both
 * render them.
 */

/** A token chip (docs/design/icon-system.md 4.7): the icon names nothing on its own, the symbol beside it does. */
export function TokenChip({ token, className }: { token: TokenKey; className?: string }): JSX.Element {
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill border border-border bg-surface py-1 pl-1.5 pr-3 text-label font-medium text-ink',
        className,
      )}
    >
      <TokenIcon token={token} size="sm" decorative />
      {tokenSymbol(token)}
    </span>
  );
}

const CLOSED_WORDS: Record<Exclude<SessionReason, 'OPEN'>, string> = {
  WEEKEND: 'Closed for the weekend',
  HOLIDAY: 'Closed for a market holiday',
  EARLY_CLOSE: 'Closed early today',
  OUTSIDE_HOURS: 'Closed outside session hours',
  NO_SESSION: 'No session for this ticker',
  OUT_OF_RANGE: 'Outside the calendar Sleeve carries',
};

/** Why the market is closed, in plain words, or "Open now". */
export function sessionWords(session: SessionState): string {
  return session.reason === 'OPEN' ? 'Open now' : CLOSED_WORDS[session.reason];
}

/** "Opens Sun 27 Sep, 20:00 New York time", or null while open or when no reopen is known. */
export function reopenWords(session: SessionState): string | null {
  if (session.open || session.nextOpenAt === null) return null;
  return `Opens ${formatNewYork(session.nextOpenAt)}`;
}

/**
 * A dot that carries real state: solid green while the session is open, the waiting stripes while buys wait for it
 * (docs/design/inspiration.md 5.2). It never pulses; the word beside it always carries the meaning.
 */
export function SessionDot({ open, className }: { open: boolean; className?: string }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={cx('size-2.5 shrink-0 rounded-pill', open ? 'bg-equity' : 'bg-waiting-stripes ring-1 ring-inset ring-waiting', className)}
    />
  );
}

/** The market state as a small pill: "Market open" or "Market closed", in the equity or waiting tone. */
export function SessionPill({ session, className }: { session: SessionState; className?: string }): JSX.Element {
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill px-2.5 py-1 text-label font-medium',
        session.open ? 'bg-equity-soft text-equity' : 'bg-waiting-soft text-waiting',
        className,
      )}
    >
      <SessionDot open={session.open} />
      {session.open ? 'Market open' : 'Market closed'}
    </span>
  );
}

export interface LoadErrorProps {
  /** What failed to load, as the start of a sentence: "The sample account". */
  what: string;
  retry: () => void;
  children?: ReactNode;
  className?: string;
}

/** A failed read says what is missing and offers another try. It never shows a number in place of the data. */
export function LoadError({ what, retry, children, className }: LoadErrorProps): JSX.Element {
  return (
    <div role="alert" className={cx('flex min-w-0 flex-col items-start gap-2 rounded-module border border-border bg-surface p-4 text-left', className)}>
      <p className="text-body-s font-semibold text-ink">{what} did not load.</p>
      <p className="text-body-s text-ink-secondary">{children ?? 'Nothing else on this page depends on it.'}</p>
      <Button variant="secondary" size="sm" onClick={retry} className="mt-1">
        Try again
      </Button>
    </div>
  );
}
