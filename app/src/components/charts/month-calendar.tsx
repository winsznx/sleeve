import type { JSX, ReactNode } from 'react';

import { IconButton } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';

import styles from './charts.module.css';

/**
 * A month of days, Monday first. Days the market stays closed wear the neutral hatch, today is the solid black
 * pill, the day the market next opens carries a green ring, and each payday leaves a dot under its date: green when
 * it bought, amber stripes while it waits, apricot when all of it stayed spendable. The marks are decoration; each
 * cell names its day in words for assistive technology.
 */

export type PaydayMark = 'bought' | 'waiting' | 'spend';

export interface CalendarCell {
  key: string;
  /** Day of the month, or null for a cell outside the month. */
  date: number | null;
  closed: boolean;
  today: boolean;
  reopens: boolean;
  marks: readonly PaydayMark[];
  /** The day in words: "Saturday 26 September, today, market closed, 1 payday that waits to buy". */
  description: string;
}

export interface MonthCalendarProps {
  /** "September 2026" */
  title: string;
  /** Rows of seven, Monday to Sunday. */
  weeks: readonly (readonly CalendarCell[])[];
  onPrevious?: () => void;
  onNext?: () => void;
  footer?: ReactNode;
  className?: string;
}

const WEEKDAYS = [
  { short: 'M', long: 'Monday' },
  { short: 'T', long: 'Tuesday' },
  { short: 'W', long: 'Wednesday' },
  { short: 'T', long: 'Thursday' },
  { short: 'F', long: 'Friday' },
  { short: 'S', long: 'Saturday' },
  { short: 'S', long: 'Sunday' },
] as const;

const MARK: Record<PaydayMark, string> = {
  bought: 'bg-equity',
  waiting: cx(styles.waiting, 'ring-1 ring-inset ring-waiting'),
  spend: 'bg-spend',
};

function Day({ cell }: { cell: CalendarCell }): JSX.Element {
  if (cell.date === null) return <span aria-hidden="true" className="block aspect-square rounded-row" />;
  return (
    <span
      className={cx(
        'relative flex aspect-square flex-col items-center justify-center rounded-row text-body-s tabular-nums',
        cell.today ? 'bg-brand font-semibold text-on-brand' : cell.closed ? cx(styles.closedDay, 'text-ink-secondary') : 'bg-surface-muted text-ink',
        cell.reopens && !cell.today && 'ring-2 ring-inset ring-equity',
      )}
    >
      <span aria-hidden="true">{cell.date}</span>
      {cell.marks.length === 0 ? null : (
        <span aria-hidden="true" className="absolute bottom-[14%] flex gap-0.5">
          {cell.marks.slice(0, 3).map((mark, index) => (
            <span key={index} className={cx('size-1.5 rounded-pill', MARK[mark], cell.today && 'ring-1 ring-on-brand')} />
          ))}
        </span>
      )}
      <span className="sr-only">{cell.description}</span>
    </span>
  );
}

export function MonthCalendar({ title, weeks, onPrevious, onNext, footer, className }: MonthCalendarProps): JSX.Element {
  return (
    <div className={cx('flex min-w-0 flex-col', className)}>
      <div className="flex items-center justify-between gap-2">
        <IconButton icon="chevronLeft" label="Previous month" onClick={onPrevious} disabled={onPrevious === undefined} className="rounded-pill border border-border" />
        <p aria-live="polite" className="text-body font-semibold text-ink">
          {title}
        </p>
        <IconButton icon="chevronRight" label="Next month" onClick={onNext} disabled={onNext === undefined} className="rounded-pill border border-border" />
      </div>
      <table className="mt-3 w-full table-fixed border-separate border-spacing-1">
        <caption className="sr-only">{title}</caption>
        <thead>
          <tr>
            {WEEKDAYS.map((weekday) => (
              <th key={weekday.long} scope="col" className="pb-1 text-label font-medium text-ink-muted">
                <abbr title={weekday.long} className="no-underline">
                  {weekday.short}
                </abbr>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, index) => (
            <tr key={index}>
              {week.map((cell) => (
                <td key={cell.key} className="p-0">
                  <Day cell={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {footer}
    </div>
  );
}
