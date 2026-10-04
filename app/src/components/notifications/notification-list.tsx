'use client';

import Link from 'next/link';
import type { JSX } from 'react';

import { TickerIcon } from '@/components/token/ticker-icon';
import { TokenIcon } from '@/components/token/token-icon';
import { cx } from '@/components/ui/cx';
import { DebtSecurityLine } from '@/components/ui/debt-security-line';
import { formatUtc } from '@/components/ui/format-time';
import { Skeleton, SkeletonGroup } from '@/components/ui/skeleton';
import type { SleeveNotification } from '@/data/notifications';

import { describeNotification, type NotificationContext, type NotificationIcon } from './notification-words';

/**
 * Notification rows, for the bell's panel and the full page: the token the money became or stayed as, what happened
 * in one plain sentence, when, and a link to the screen that shows it. Unread rows carry a green dot and say so to
 * screen readers. A row that bought or sold a Stock Token carries the debt security line under its sentence.
 */

function RowIcon({ icon }: { icon: NotificationIcon }): JSX.Element {
  return icon.kind === 'usdg' ? <TokenIcon token="USDG" size="lg" decorative /> : <TickerIcon tickerId={icon.tickerId} size="lg" />;
}

export interface NotificationRowProps extends NotificationContext {
  notification: SleeveNotification;
  unread: boolean;
  /** Runs as the link is followed: mark the item read, close the panel. */
  onOpen: (notification: SleeveNotification) => void;
  /** The panel's rows sit closer to the edge than the page's. */
  dense?: boolean;
}

export function NotificationRow({ notification, unread, onOpen, dense = false, sleeveOff = false }: NotificationRowProps): JSX.Element {
  const view = describeNotification(notification, { sleeveOff });
  return (
    <li
      className={cx(
        'relative flex gap-3 border-t border-border transition-colors duration-fast ease-standard first:border-t-0 hover:bg-surface-muted',
        dense ? 'px-4 py-3' : 'px-4 py-3.5 md:px-5 md:py-4',
      )}
    >
      <div className="shrink-0 pt-0.5">
        <RowIcon icon={view.icon} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline justify-between gap-3">
          <Link
            href={view.href}
            onClick={() => onOpen(notification)}
            className={cx(
              'min-w-0 break-words text-body-s text-ink after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-focus',
              unread ? 'font-semibold' : 'font-medium',
            )}
          >
            {unread ? <span className="sr-only">Unread: </span> : null}
            {view.title}
          </Link>
          {unread ? <span aria-hidden="true" className="size-2 shrink-0 self-center rounded-pill bg-accent" /> : null}
        </p>
        <p className="mt-0.5 break-words text-body-s text-ink-secondary">{view.text}</p>
        {view.stockToken ? <DebtSecurityLine className="mt-0.5" /> : null}
        <time className="mt-1 block text-label text-ink-muted" dateTime={new Date(Number(notification.at) * 1_000).toISOString()}>
          {formatUtc(notification.at)}
        </time>
      </div>
    </li>
  );
}

/** Rows of placeholders. `announce` makes it a status that names what loads; the bell's panel stays quiet. */
export function NotificationSkeleton({ rows = 3, announce = true }: { rows?: number; announce?: boolean }): JSX.Element {
  const placeholders = (
    <ul aria-hidden="true">
        {Array.from({ length: rows }, (_, index) => (
          <li key={index} className="flex gap-3 border-t border-border px-4 py-3 first:border-t-0">
            <Skeleton className="size-avatar shrink-0 rounded-row" />
            <span className="flex min-w-0 flex-1 flex-col gap-2 pt-1">
              <Skeleton className="h-3.5 w-1/3" />
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3 w-1/2" />
            </span>
          </li>
        ))}
    </ul>
  );
  return announce ? <SkeletonGroup label="Loading notifications">{placeholders}</SkeletonGroup> : placeholders;
}
