import type { Reason, Status } from '@sleeve/core';
import type { JSX, ReactNode } from 'react';

import { REASON_LABEL, type BadgeTone } from '@/components/ui/badge';
import { cx } from '@/components/ui/cx';
import { Icon } from '@/components/ui/icons';

import { STATUS_WORDS, statusTone } from '../_lib/outcome';
import { Glyph } from './glyphs';

/**
 * An action's status as a chip in plain words ("Bought", "Waiting", "Moved to spend"), in the tone of its onchain
 * status (docs/DESIGN.md 12.3), with a small glyph that repeats the word as a shape. Color and glyph never work
 * alone: the word is always there. The onchain status names stay in the proof section.
 */

const TONE: Record<BadgeTone, string> = {
  equity: 'bg-equity-soft text-equity',
  waiting: 'bg-waiting-soft text-waiting',
  danger: 'bg-danger-soft text-danger',
  neutral: 'bg-surface-strong text-ink-secondary',
  success: 'bg-success-soft text-success',
  info: 'bg-info-soft text-info',
};

const CHIP = 'inline-flex items-center gap-1 whitespace-nowrap rounded-control border border-border py-0.5 pl-1.5 pr-2 text-label font-medium';

function statusGlyph(status: Status): ReactNode {
  switch (status) {
    case 'FILLED':
    case 'SETTLED':
      return <Icon name="check" className="size-3.5" />;
    case 'QUEUED':
      return <Icon name="clock" className="size-3.5" />;
    case 'RELEASED':
      return <Glyph name="arrowRight" className="size-3.5" />;
    case 'SOLD':
    case 'PART_SOLD':
      return <Icon name="sell" className="size-3.5" />;
    case 'REFUSED_TICKER':
    case 'REFUSED_ACCOUNT':
      return <Glyph name="cross" className="size-3.5" />;
    case 'RECONCILED':
      return <Icon name="info" className="size-3.5" />;
  }
}

export function StatusChip({ status, className }: { status: Status; className?: string }): JSX.Element {
  return (
    <span data-status={status} className={cx(CHIP, TONE[statusTone(status)], className)}>
      {statusGlyph(status)}
      {STATUS_WORDS[status]}
    </span>
  );
}

/** Why an equity share waits, as a quiet chip beside the status. NONE never waits, so it draws nothing. */
export function WaitReasonChip({ reason, className }: { reason: Reason; className?: string }): JSX.Element | null {
  if (reason === 'NONE') return null;
  return (
    <span className={cx('inline-flex items-center whitespace-nowrap rounded-control border border-border bg-surface px-2 py-0.5 text-label font-medium text-waiting', className)}>
      {REASON_LABEL[reason]}
    </span>
  );
}
