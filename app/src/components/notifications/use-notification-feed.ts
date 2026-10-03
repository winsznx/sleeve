'use client';

import type { Address } from '@sleeve/core';
import { useMemo } from 'react';

import { useNotifications, type SleeveNotification } from '@/data/notifications';
import { useSettings } from '@/lib/settings';

import { isRead, useReadState } from './read-state';

/**
 * The bell's feed for the signed-in owner: the derived notifications (data/notifications.ts) narrowed to the kinds
 * the owner keeps on in Settings, with this browser's read state.
 */

export interface NotificationFeed {
  /** Undefined until the first reads land. */
  items: SleeveNotification[] | undefined;
  unread: number;
  isError: boolean;
  isRead: (notification: SleeveNotification) => boolean;
  markRead: (notification: SleeveNotification) => void;
  markAllRead: () => void;
  hasMore: boolean;
  loadMore: () => void;
  loadingMore: boolean;
}

export function useNotificationFeed(account: Address | null): NotificationFeed {
  const read = useNotifications(account ?? undefined);
  const { notificationTypes } = useSettings();
  const { state, markRead, markAllRead } = useReadState(account);

  const items = useMemo(
    () => read.items?.filter((notification) => notificationTypes[notification.type]),
    [read.items, notificationTypes],
  );
  const unread = items?.reduce((count, notification) => (isRead(state, notification) ? count : count + 1), 0) ?? 0;

  return {
    items,
    unread,
    isError: read.isError,
    isRead: (notification) => isRead(state, notification),
    markRead,
    markAllRead: () => markAllRead(items ?? []),
    hasMore: read.hasMore,
    loadMore: read.loadMore,
    loadingMore: read.loadingMore,
  };
}
