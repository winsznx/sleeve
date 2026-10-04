'use client';

import type { Address } from '@sleeve/core';
import Link from 'next/link';
import type { JSX } from 'react';

import { NavIcon } from '@/components/shell/glyphs';
import { Popover } from '@/components/shell/popover';
import { useSleeveOff } from '@/components/sleeve/sleeve-off';

import { NotificationRow, NotificationSkeleton } from './notification-list';
import { useNotificationFeed } from './use-notification-feed';

/**
 * The top bar's bell (D-029): the unread count on the bell, and a panel of the latest notifications, anchored under
 * the bell from 768 px and a bottom sheet below. Opening a row marks it read and closes the panel; Mark all read
 * clears the count. The whole list lives on /notifications.
 */

/** Rows the panel shows; the rest are one link away. */
const PANEL_ROWS = 6;

function countLabel(unread: number): string {
  return unread > 9 ? '9+' : String(unread);
}

export function NotificationBell({ account, className }: { account: Address; className?: string }): JSX.Element {
  const feed = useNotificationFeed(account);
  const sleeveOff = useSleeveOff(account);
  const unread = feed.unread;
  return (
    <Popover
      title="Notifications"
      className={className}
      buttonLabel={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
      buttonClassName="relative inline-flex size-touch shrink-0 items-center justify-center rounded-pill text-ink-secondary transition-colors duration-fast ease-standard hover:bg-surface-muted hover:text-ink aria-expanded:bg-surface-muted aria-expanded:text-ink md:size-control-sm"
      button={
        <>
          <NavIcon name="bell" />
          {unread > 0 ? (
            <span
              aria-hidden="true"
              className="absolute right-0.5 top-0.5 grid h-[1.125rem] min-w-[1.125rem] place-items-center rounded-pill bg-accent px-1 text-micro font-semibold tabular-nums text-on-accent ring-2 ring-canvas md:-right-0.5 md:-top-0.5"
            >
              {countLabel(unread)}
            </span>
          ) : null}
        </>
      }
      panelClassName="w-[25rem] max-w-[calc(100vw-2rem)]"
    >
      {(close) => (
        <div className="min-w-0 max-md:-mx-card">
          <div className="flex min-h-touch items-center justify-between gap-3 px-4 max-md:-mt-1 md:sticky md:top-0 md:z-sticky md:border-b md:border-border md:bg-surface md:py-1.5">
            <h2 className="hidden text-body font-semibold text-ink md:block">Notifications</h2>
            <p className="text-body-s text-ink-secondary md:hidden">{unread > 0 ? `${unread} unread` : 'All read'}</p>
            <button
              type="button"
              onClick={feed.markAllRead}
              disabled={unread === 0}
              className="inline-flex min-h-touch items-center rounded-control px-2 text-body-s font-medium text-link transition-colors duration-fast ease-standard hover:text-link-hover disabled:cursor-default disabled:text-ink-muted md:min-h-control-sm"
            >
              Mark all read
            </button>
          </div>
          {feed.items === undefined ? (
            feed.isError ? (
              <p className="px-4 py-6 text-body-s text-ink-secondary">Notifications did not load. Open the full list to try again.</p>
            ) : (
              <NotificationSkeleton announce={false} />
            )
          ) : feed.items.length === 0 ? (
            <p className="px-4 py-6 text-body-s text-ink-secondary">
              Nothing yet. When a payment arrives, it shows here with what it became.
            </p>
          ) : (
            <ul aria-label="Latest notifications" className="max-md:border-t max-md:border-border">
              {feed.items.slice(0, PANEL_ROWS).map((notification) => (
                <NotificationRow
                  key={notification.id}
                  notification={notification}
                  unread={!feed.isRead(notification)}
                  onOpen={(opened) => {
                    feed.markRead(opened);
                    close();
                  }}
                  dense
                  sleeveOff={sleeveOff}
                />
              ))}
            </ul>
          )}
          <div className="border-t border-border px-4 py-1.5 md:sticky md:bottom-0 md:z-sticky md:bg-surface">
            <Link
              href="/notifications"
              onClick={close}
              className="inline-flex min-h-touch items-center text-body-s font-medium text-link underline underline-offset-4 transition-colors duration-fast ease-standard hover:text-link-hover md:min-h-control-sm"
            >
              See all notifications
            </Link>
          </div>
        </div>
      )}
    </Popover>
  );
}
