'use client';

import { nextSessionTransition, type TickerId } from '@sleeve/core';
import { useState, type JSX } from 'react';

import styles from '@/components/charts/charts.module.css';
import { MonthCalendar } from '@/components/charts/month-calendar';
import { sessionTypeOf } from '@/components/shell/market-session';
import { useMarketSession } from '@/components/shell/use-market-session';
import { cx } from '@/components/ui/cx';
import { Icon } from '@/components/ui/icons';

import { monthCells, monthCovered, monthOfDay, monthTitle, newYorkDay, shiftMonth, type MonthRef, type PaydayPoint } from '../_lib/overview';
import { OverviewCard } from './overview-card';

export interface CalendarCardProps {
  points: readonly PaydayPoint[];
  /** The rule's ticker, whose session the card follows. Every launch ticker trades the same 24/5 week. */
  tickerId: TickerId;
  /** Chain time of the account read, used until the market snapshot arrives. */
  now: bigint;
}

/**
 * Paydays and market sessions on one month (D-029), from the session calendar port: closed days hatched, today
 * solid, the next reopen ringed in green, and a dot under every payday. Under it, the session now and the countdown
 * to its next change, the same words the session pill uses.
 */
export function CalendarCard({ points, tickerId, now }: CalendarCardProps): JSX.Element {
  const session = useMarketSession(tickerId);
  const chainNow = session.status === 'ready' ? session.now : now;
  const today = newYorkDay(chainNow);
  const [shown, setShown] = useState<MonthRef | null>(null);
  const month = shown ?? monthOfDay(today);

  let reopensAt: bigint | null = null;
  if (session.status === 'ready') {
    const view = session.view;
    if (view.state === 'closed') reopensAt = view.opensAt;
    else if (view.state === 'open' && view.closesAt !== null) {
      reopensAt = nextSessionTransition(view.closesAt, sessionTypeOf(tickerId))?.at ?? null;
    }
  }

  const previous = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);

  return (
    <OverviewCard title="Calendar" lede="Paydays and market sessions, New York time.">
      <MonthCalendar
        className="mx-auto w-full max-w-sm"
        title={monthTitle(month)}
        weeks={monthCells(month, points, today, reopensAt === null ? null : newYorkDay(reopensAt))}
        onPrevious={monthCovered(previous) ? () => setShown(previous) : undefined}
        onNext={monthCovered(next) ? () => setShown(next) : undefined}
      />
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-label text-ink-secondary">
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className={cx('size-3 rounded-[3px] border border-border', styles.closedDay)} />
          Market closed
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-3 rounded-[3px] ring-2 ring-inset ring-equity" />
          Opens next
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-1.5 rounded-pill bg-equity" />
          Payday
        </li>
      </ul>
      <div className="mt-auto pt-4">
        <div className="flex items-center gap-3 rounded-large border border-border p-3">
          <span
            aria-hidden="true"
            className={cx(
              'grid size-icon-tile shrink-0 place-items-center rounded-pill',
              session.status === 'ready' && session.view.state === 'open' ? 'bg-equity-soft text-equity' : 'bg-waiting-soft text-waiting',
            )}
          >
            <Icon name="clock" />
          </span>
          {session.status === 'ready' ? (
            <p className="min-w-0 text-body-s text-ink-secondary">
              <span className="block text-body font-semibold text-ink">{session.words.title}</span>
              {session.words.countdown === null ? (
                'Buys wait until the calendar shows a session.'
              ) : (
                <>
                  <span className="tabular-nums">{session.words.countdown}</span>
                  {session.words.when === null ? null : <span>, {session.words.when} New York time</span>}
                </>
              )}
            </p>
          ) : (
            <p className="text-body-s text-ink-secondary">{session.status === 'error' ? 'The market session did not load.' : 'Reading the market session'}</p>
          )}
        </div>
      </div>
    </OverviewCard>
  );
}
