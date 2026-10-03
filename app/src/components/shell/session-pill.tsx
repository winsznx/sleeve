'use client';

import { RULE_DEFAULTS } from '@sleeve/core';
import type { JSX } from 'react';

import { cx } from '@/components/ui/cx';
import { Icon } from '@/components/ui/icons';

import type { SessionTone } from './market-session';
import { MarketsPanel } from './markets-panel';
import { Popover } from './popover';
import { SessionMark } from './sample-tag';
import { followedTicker, useMarketSession, useOwnerRule } from './use-market-session';

/**
 * The live market session pill, shared by the marketing navbar and the app's top bar (docs/design/inspiration.md 5.2):
 * the state in a word and a countdown to the next open or close, from the SessionCalendar port. It opens the markets
 * panel. The countdown sits in the visible text; the accessible name says the same thing in full.
 */

const TONE: Record<SessionTone, string> = {
  open: 'bg-equity-soft text-equity hover:bg-equity-surface',
  closed: 'bg-waiting-soft text-waiting hover:bg-surface-muted',
  unknown: 'bg-surface-muted text-ink-secondary hover:bg-surface-strong',
};

const BASE =
  'inline-flex min-h-control-sm max-w-full items-center gap-2 rounded-pill px-3 text-body-s font-medium tabular-nums transition-colors duration-fast ease-standard';

/**
 * The visible text narrows with the room: "Closed" on a phone under 400 px, where the top bar also holds the bell,
 * Receive and the account, "Closed · 1d 6h" from 400 px, "Closed · opens in 1d 6h" from 640 px and "Market closed ·
 * opens in 1d 6h" from 1600 px, where the app's top bar has room for it beside the other chips. The accessible name
 * always says it in full.
 */
export function SessionPill({ className }: { className?: string }): JSX.Element {
  const ownerRule = useOwnerRule();
  const read = useMarketSession(followedTicker(ownerRule));

  if (read.status === 'pending') {
    return (
      <span
        aria-busy="true"
        className={cx('inline-flex h-control-sm w-24 shrink-0 items-center rounded-pill bg-skeleton min-[400px]:w-36', className)}
      >
        <span className="sr-only">Loading the market session</span>
      </span>
    );
  }
  if (read.status === 'error') {
    return (
      <button type="button" onClick={read.retry} className={cx(BASE, TONE.unknown, className)}>
        <Icon name="alert" className="size-4" />
        {read.retrying ? 'Checking the market' : 'Market status unavailable'}
      </button>
    );
  }

  const { words } = read;
  const suggestedRule = ownerRule === null || ownerRule.status === 'NONE';
  const rule = suggestedRule ? RULE_DEFAULTS : ownerRule;

  return (
    <Popover
      title="Market session"
      className={cx('min-w-0', className)}
      buttonLabel={`${words.sentence} Market details.`}
      buttonClassName={cx(BASE, TONE[words.tone])}
      button={
        <>
          <SessionMark tone={words.tone} />
          <span aria-hidden="true" className="truncate">
            <span className="hidden min-[1600px]:inline">{words.title}</span>
            <span className="min-[1600px]:hidden">{words.short}</span>
            {words.countdown === null ? null : (
              <span className="max-[399px]:hidden">
                {' '}
                <span className="opacity-70">·</span> <span className="hidden sm:inline">{words.countdown}</span>
                <span className="sm:hidden">{words.remaining}</span>
              </span>
            )}
          </span>
          <Icon name="chevronDown" className="size-3.5 opacity-80 max-[399px]:hidden" />
        </>
      }
      panelClassName="w-[26rem]"
    >
      <MarketsPanel
        snapshot={read.snapshot}
        market={read.market}
        now={read.now}
        view={read.view}
        words={words}
        rule={rule}
        suggestedRule={suggestedRule}
      />
    </Popover>
  );
}
