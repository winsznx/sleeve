import type { JSX } from 'react';

import { cx } from '@/components/ui/cx';
import { formatDuration, formatUtc } from '@/components/ui/format-time';
import { Icon, type IconName } from '@/components/ui/icons';

import { Glyph } from '../../_components/glyphs';
import { isoTime } from '../../_lib/register';
import type { SessionCheck, SessionModel } from '../receipt-panels';
import { Fact, FactGrid, ReceiptPanel } from './fact';

/**
 * The market calendar the guard read (PRD 7.4 step 4): what the session check said for this action, the block time
 * in New York where the US session is defined, the onchain calendar version, and how long the USDG waited when the
 * action is about a wait.
 */

const CHECK_LOOK: Record<SessionCheck, { surface: string; icon: IconName; tone: string }> = {
  open: { surface: 'border-accent-border bg-equity-surface', icon: 'check', tone: 'text-success' },
  closed: { surface: 'border-border bg-waiting-soft', icon: 'clock', tone: 'text-waiting' },
  skipped: { surface: 'border-border bg-warning-soft', icon: 'alert', tone: 'text-warning' },
  'not-reached': { surface: 'border-border bg-surface-muted', icon: 'info', tone: 'text-ink-secondary' },
  none: { surface: 'border-border bg-surface-muted', icon: 'info', tone: 'text-ink-secondary' },
};

export function SessionPanel({ model }: { model: SessionModel }): JSX.Element {
  const look = CHECK_LOOK[model.check];
  return (
    <ReceiptPanel id="action-session" title="Market session" headingLevel={3} aside="From the onchain calendar">
      <div className={cx('mt-4 flex items-start gap-3 rounded-row border p-4', look.surface)}>
        <Icon name={look.icon} className={cx('mt-px', look.tone)} />
        <p className="min-w-0 text-body-s text-ink">
          <span className="font-semibold">Session check. </span>
          {model.checkText}
        </p>
      </div>
      <FactGrid className="mt-5">
        <Fact term="Block time in New York">
          <span className="inline-flex items-center gap-1.5">
            <Glyph name="calendar" className="size-4 text-ink-muted" />
            {model.newYork}
          </span>
        </Fact>
        <Fact term="Session calendar" note={model.calendar}>
          <span className="font-mono text-mono-s">{model.calendarVersion}</span>
        </Fact>
        {model.waitingSince === null ? null : (
          <Fact term="Waiting since" note={model.waited === null || model.waited === 0n ? undefined : `Waited ${formatDuration(model.waited)} before this receipt.`}>
            <time dateTime={isoTime(model.waitingSince)}>{formatUtc(model.waitingSince)}</time>
          </Fact>
        )}
      </FactGrid>
    </ReceiptPanel>
  );
}
