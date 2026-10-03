'use client';

import type { Address } from '@sleeve/core';
import Link from 'next/link';
import type { JSX } from 'react';

import { NotificationRow, NotificationSkeleton } from '@/components/notifications/notification-list';
import { useNotificationFeed } from '@/components/notifications/use-notification-feed';
import { Button } from '@/components/ui/button';
import { buttonClasses } from '@/components/ui/button-styles';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { useSession } from '@/data/hooks';

/**
 * Every notification the bell holds, newest first (D-029), with Mark all read and the older pages of the record
 * behind them. Which kinds show is set in Settings.
 */

const LINK = 'font-medium text-link underline underline-offset-4 transition-colors duration-fast ease-standard hover:text-link-hover';

function Feed({ account }: { account: Address }): JSX.Element {
  const feed = useNotificationFeed(account);
  const items = feed.items;

  let body: JSX.Element;
  if (items === undefined) {
    body = feed.isError ? (
      <EmptyState title="Notifications did not load">Reload the page to read them again. Nothing about your money changed.</EmptyState>
    ) : (
      <div className="overflow-hidden rounded-panel border border-border bg-surface">
        <NotificationSkeleton rows={5} />
      </div>
    );
  } else if (items.length === 0) {
    body = (
      <EmptyState title="Nothing yet" action={<Link href="/home" className={LINK}>Find your payment address on Home</Link>}>
        When a payment arrives at your address, it shows here with what it became.
      </EmptyState>
    );
  } else {
    body = (
      <>
        <ul aria-label="Notifications" className="overflow-hidden rounded-panel border border-border bg-surface">
          {items.map((notification) => (
            <NotificationRow
              key={notification.id}
              notification={notification}
              unread={!feed.isRead(notification)}
              onOpen={feed.markRead}
            />
          ))}
        </ul>
        {feed.hasMore ? (
          <Button variant="secondary" className="mt-4" onClick={feed.loadMore} busy={feed.loadingMore} busyLabel="Loading older">
            Show older
          </Button>
        ) : null}
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Notifications"
        description={
          <>
            What happened to your money, newest first. Choose what shows in{' '}
            <Link href="/settings" className={LINK}>
              Settings
            </Link>
            .
          </>
        }
        actions={
          <Button variant="secondary" size="sm" onClick={feed.markAllRead} disabled={feed.unread === 0}>
            Mark all read
          </Button>
        }
      />
      <p aria-live="polite" className="sr-only">
        {feed.items === undefined ? '' : `${feed.unread} unread`}
      </p>
      {body}
    </>
  );
}

export function NotificationsScreen(): JSX.Element {
  const session = useSession();
  const account = session.data?.account;
  if (account !== undefined) {
    return (
      <div className="max-w-form">
        <Feed account={account} />
      </div>
    );
  }
  return (
    <div className="max-w-form">
      <PageHeader title="Notifications" description="What happened to your money, newest first." />
      {session.isPending ? (
        <div className="overflow-hidden rounded-panel border border-border bg-surface">
          <NotificationSkeleton rows={5} />
        </div>
      ) : (
        <EmptyState
          title="Sign in to see your notifications"
          action={
            <Link href="/onboard" prefetch={false} className={buttonClasses({ size: 'sm' })}>
              Sign in
            </Link>
          }
        >
          They list each payment that reaches your address and what it became.
        </EmptyState>
      )}
    </div>
  );
}
