import Link from 'next/link';
import type { JSX } from 'react';

import { ReceiptLead, LEAD_WIDTH_CLASS } from '@/app/(product)/receipts/_components/receipt-lead';
import { StatusChip, WaitReasonChip } from '@/app/(product)/receipts/_components/status-chip';
import { actionCount, actionLabel, actionNumber, actionSource } from '@/app/(product)/receipts/_lib/outcome';
import {
  formatUtcClock,
  groupByUtcDay,
  isoTime,
  rowAmount,
  rowLead,
  rowOutcome,
  type RowOutcome,
} from '@/app/(product)/receipts/_lib/register';
import { SplitRail, splitPartsOf, type SplitParts } from '@/components/sleeve/split-rail';
import { TokenIcon } from '@/components/token/token-icon';
import { Amount } from '@/components/ui/amount';
import { cx } from '@/components/ui/cx';
import { Skeleton, SkeletonGroup } from '@/components/ui/skeleton';
import type { ReceiptRecord } from '@/data/types';

/**
 * The history register (docs/design/closeout-product-blueprint.md 6.2 and 15.5): one ruled panel, a column header
 * on wide screens, actions grouped under the UTC day they happened, newest first. Each row leads with the move as
 * token icons, then what happened in plain words with who paid or which lot it drew from, its status chip, its
 * time, and the amount with what it became and a thin split rail.
 *
 * From 1024 px the row is four columns. Below, it collapses the way closeout's directory rows do: the name and the
 * amount share the first line, and the status, what the amount became and the rail run along a second line under
 * the name. The second line is one wrapper that turns into `display: contents` at 1024 px, so its parts become grid
 * items there and each element is rendered once.
 */

const COLUMNS = 'lg:grid-cols-[minmax(0,1fr)_11rem_6rem_minmax(13rem,auto)]';

const OUTCOME_TONE: Record<RowOutcome['tone'], string> = {
  equity: 'text-equity',
  waiting: 'text-waiting',
  spend: 'text-spend',
  plain: 'text-ink-secondary',
};

/** A rail says something in a row only when the payday split into more than one part. */
function splitsInRow(parts: SplitParts | null): parts is SplitParts {
  return parts !== null && [parts.spend, parts.equity, parts.waiting].filter((part) => part > 0n).length > 1;
}

function HistoryRow({ record }: { record: ReceiptRecord }): JSX.Element {
  const { receipt } = record;
  const id = receipt.id.toString();
  const lead = rowLead(receipt);
  const outcome = rowOutcome(record);
  const parts = splitPartsOf(receipt);
  const source = actionSource(record);
  const clock = formatUtcClock(receipt.timestamp);
  const amount = rowAmount(record);
  const dateTime = isoTime(receipt.timestamp);

  return (
    <li
      data-action={id}
      className={cx(
        'relative grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 border-t border-border px-4 py-3.5 transition-colors duration-fast ease-standard first:border-t-0 hover:bg-surface-muted md:px-5 lg:gap-x-5 lg:gap-y-0 lg:py-3',
        COLUMNS,
      )}
    >
      <div className="flex min-w-0 items-center gap-3 lg:col-start-1 lg:row-span-3 lg:row-start-1">
        <span className={cx('flex shrink-0 lg:hidden', LEAD_WIDTH_CLASS.md)}>
          <ReceiptLead lead={lead} size="md" />
        </span>
        <span className={cx('hidden shrink-0 lg:flex', LEAD_WIDTH_CLASS.lg)}>
          <ReceiptLead lead={lead} size="lg" />
        </span>
        <div className="min-w-0">
          <p className="break-words text-body font-medium text-ink">
            <Link
              href={`/receipts/${id}`}
              className="after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-focus"
            >
              {actionLabel(record)}
              <span className="sr-only">, number {id}</span>
            </Link>
          </p>
          <p className="mt-0.5 break-words text-body-s text-ink-muted">
            {source === null ? null : <span>{source}, </span>}
            <span className="font-mono text-mono-s tabular-nums">{actionNumber(receipt.id)}</span>
            <span className="lg:hidden">
              , <time dateTime={dateTime}>{clock}</time>
            </span>
          </p>
        </div>
      </div>

      <p className="col-start-2 row-start-1 text-right text-body font-semibold text-ink lg:col-start-4 lg:self-end">
        <Amount value={amount.value} unit={amount.unit} />
      </p>

      <div className="col-span-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 pl-[3.25rem] lg:contents">
        <span className="flex flex-wrap items-center gap-1.5 lg:col-start-2 lg:row-span-3 lg:row-start-1 lg:flex-col lg:items-start lg:justify-center lg:gap-1">
          <StatusChip status={receipt.status} />
          {receipt.status === 'QUEUED' ? <WaitReasonChip reason={receipt.reason} /> : null}
        </span>
        <span
          className={cx(
            'flex min-w-0 items-center gap-1.5 text-body-s lg:col-start-4 lg:row-start-2 lg:mt-0.5 lg:justify-end',
            OUTCOME_TONE[outcome.tone],
          )}
        >
          {outcome.token === null ? null : <TokenIcon token={outcome.token} size="xs" decorative />}
          <span className="tabular-nums">{outcome.text}</span>
        </span>
        {splitsInRow(parts) ? (
          <SplitRail parts={parts} size="row" className="ml-auto w-20 lg:col-start-4 lg:row-start-3 lg:mt-2 lg:w-24 lg:self-start lg:justify-self-end" />
        ) : null}
      </div>

      <p className="hidden text-body-s tabular-nums text-ink-secondary lg:col-start-3 lg:row-span-3 lg:row-start-1 lg:block lg:self-center">
        <time dateTime={dateTime}>{clock}</time>
      </p>
    </li>
  );
}

function ColumnHeader(): JSX.Element {
  return (
    <div
      aria-hidden="true"
      className={cx(
        'hidden gap-x-5 border-b border-border bg-surface-muted px-5 py-2.5 text-label font-medium text-ink-secondary lg:grid',
        COLUMNS,
      )}
    >
      <span className="pl-[4.375rem]">What happened</span>
      <span>Status</span>
      <span>Time, UTC</span>
      <span className="text-right">Amount</span>
    </div>
  );
}

export interface HistoryRegisterProps {
  records: readonly ReceiptRecord[];
}

export function HistoryRegister({ records }: HistoryRegisterProps): JSX.Element {
  const groups = groupByUtcDay(records);
  return (
    <section aria-label="Actions" className="min-w-0 overflow-hidden rounded-panel border border-border bg-surface">
      <ColumnHeader />
      {groups.map((group, index) => {
        const headingId = `history-day-${group.key}`;
        return (
          <section key={group.key} aria-labelledby={headingId}>
            <div
              className={cx(
                'flex items-baseline justify-between gap-3 bg-surface-muted px-4 pb-1.5 pt-2.5 md:px-5',
                index > 0 && 'border-t border-border',
              )}
            >
              <h2 id={headingId} className="text-label font-semibold text-ink">
                <time dateTime={group.key}>{group.label}</time>
              </h2>
              <span className="text-label tabular-nums text-ink-secondary">{actionCount(group.records.length)}</span>
            </div>
            <ul aria-labelledby={headingId} className="border-t border-border">
              {group.records.map((record) => (
                <HistoryRow key={record.receipt.id.toString()} record={record} />
              ))}
            </ul>
          </section>
        );
      })}
    </section>
  );
}

/** The register's shape while it loads: the header, one day strip and six 72 px rows. */
export function HistoryRegisterSkeleton(): JSX.Element {
  return (
    <SkeletonGroup label="Loading your history" className="overflow-hidden rounded-panel border border-border bg-surface">
      <div className="hidden border-b border-border bg-surface-muted px-5 py-3 lg:block">
        <Skeleton className="h-3 w-40" />
      </div>
      <div className="flex justify-between bg-surface-muted px-4 py-2.5 md:px-5">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-3 w-16" />
      </div>
      {[0, 1, 2, 3, 4, 5].map((row) => (
        <div key={row} className="flex min-h-[4.5rem] items-center gap-3 border-t border-border px-4 md:px-5">
          <Skeleton className="size-avatar shrink-0 rounded-pill" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-4 w-36 max-w-full" />
            <Skeleton className="mt-2 h-3.5 w-24" />
          </div>
          <div className="flex flex-col items-end">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-2 h-3.5 w-20" />
          </div>
        </div>
      ))}
    </SkeletonGroup>
  );
}
