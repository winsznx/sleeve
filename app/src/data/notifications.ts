import type { Address } from '@sleeve/core';
import { useMemo } from 'react';

import type { NotificationType } from '@/lib/settings';

import { useBuckets, useInbox, useReceipts } from './hooks';
import type { BucketView, InboxItem, ReceiptRecord } from './types';

/**
 * What happened to the owner's money, as a feed (D-029): a payment arrived, it split, a buy filled or waits, the
 * market reopened and a waiting buy settled, a sell filled, waiting USDG moved to spend, a new rule took effect. Each
 * event is derived from the data layer's own reads (the inbox, the receipts and the buckets) and carries the records
 * it came from, so the feed says nothing the records do not and works the same on the mock and on chain data.
 * components/notifications turns events into words; read state is the viewer's and lives there too.
 */

export type NotificationEvent =
  | { type: 'payment-arrived'; item: InboxItem }
  | { type: 'payment-split'; record: ReceiptRecord }
  | { type: 'buy-filled'; record: ReceiptRecord }
  /** stillWaiting: the ticker's bucket holds USDG now, so the item leads to where it can be released. */
  | { type: 'buy-waiting'; record: ReceiptRecord; stillWaiting: boolean }
  /** afterReopen: the USDG had waited for the market, which a session wait inside the same stretch shows. */
  | { type: 'buy-settled'; record: ReceiptRecord; afterReopen: boolean }
  /** One sell writes a receipt per lot it touches, oldest lot first; the feed shows the sell once. */
  | { type: 'sell-filled'; records: readonly [ReceiptRecord, ...ReceiptRecord[]] }
  | { type: 'released'; record: ReceiptRecord }
  /** The first split under a new rule version, after a split under an earlier one. */
  | { type: 'rule-changed'; record: ReceiptRecord };

export interface SleeveNotification {
  /** Stable across reads, so read state survives a refresh: the kind and the record it came from. */
  id: string;
  type: NotificationType;
  /** Unix seconds of the record. */
  at: bigint;
  event: NotificationEvent;
}

/** Later steps of one action sort above earlier ones at the same second: the split above the payment. */
const STEP: Record<NotificationType, number> = {
  'rule-changed': 0,
  'payment-arrived': 1,
  'payment-split': 2,
  'buy-filled': 3,
  'buy-waiting': 3,
  'buy-settled': 3,
  'sell-filled': 3,
  released: 3,
};

const SPLIT_STATUSES: ReadonlySet<string> = new Set(['FILLED', 'QUEUED', 'REFUSED_TICKER', 'REFUSED_ACCOUNT']);

function byReceiptId(a: ReceiptRecord, b: ReceiptRecord): number {
  return a.receipt.id < b.receipt.id ? -1 : a.receipt.id > b.receipt.id ? 1 : 0;
}

function fromReceipt(event: Exclude<NotificationEvent, { type: 'payment-arrived' | 'sell-filled' }>): SleeveNotification {
  const id = event.type === 'rule-changed' ? event.record.receipt.ruleVersion : event.record.receipt.id;
  return { id: `${event.type}:${id}`, type: event.type, at: event.record.receipt.timestamp, event };
}

/** A settled buy waited for the market when a session wait of the same ticker falls inside its wait. */
function waitedForMarket(record: ReceiptRecord, receipts: readonly ReceiptRecord[]): boolean {
  const r = record.receipt;
  return receipts.some(
    (other) =>
      other.receipt.status === 'QUEUED' &&
      other.receipt.reason === 'SESSION' &&
      other.receipt.tickerId === r.tickerId &&
      other.receipt.timestamp >= r.queuedSince &&
      other.receipt.timestamp <= r.timestamp,
  );
}

export interface NotificationSources {
  inbox: readonly InboxItem[];
  /** In any order; the data layer lists them newest first. */
  receipts: readonly ReceiptRecord[];
  /** Undefined while the read is pending: waiting buys then lead to their receipt. */
  buckets: readonly BucketView[] | undefined;
}

/** Every event the records support, newest first. */
export function deriveNotifications({ inbox, receipts, buckets }: NotificationSources): SleeveNotification[] {
  const items: SleeveNotification[] = inbox.map((item) => ({
    id: `payment-arrived:${item.id}`,
    type: 'payment-arrived',
    at: item.timestamp,
    event: { type: 'payment-arrived', item },
  }));
  const waitingTickers = new Set((buckets ?? []).filter((bucket) => bucket.amount > 0n).map((bucket) => bucket.tickerId));
  const sells = new Map<string, ReceiptRecord[]>();

  for (const record of receipts) {
    const r = record.receipt;
    if (SPLIT_STATUSES.has(r.status)) items.push(fromReceipt({ type: 'payment-split', record }));
    switch (r.status) {
      case 'FILLED':
        items.push(fromReceipt({ type: 'buy-filled', record }));
        break;
      case 'QUEUED':
        // A 0 percent rule queues nothing: the split says all of it stayed spendable.
        if (r.usdgQueued > 0n) {
          items.push(fromReceipt({ type: 'buy-waiting', record, stillWaiting: waitingTickers.has(r.tickerId) }));
        }
        break;
      case 'SETTLED':
        items.push(fromReceipt({ type: 'buy-settled', record, afterReopen: waitedForMarket(record, receipts) }));
        break;
      case 'RELEASED':
        items.push(fromReceipt({ type: 'released', record }));
        break;
      case 'PART_SOLD':
      case 'SOLD': {
        const key = `${record.derived.txHash}:${r.tickerId}`;
        sells.set(key, [...(sells.get(key) ?? []), record]);
        break;
      }
      default:
        break;
    }
  }

  for (const group of sells.values()) {
    const [first, ...rest] = [...group].sort(byReceiptId);
    if (first === undefined) continue;
    items.push({
      id: `sell-filled:${first.receipt.id}`,
      type: 'sell-filled',
      at: first.receipt.timestamp,
      event: { type: 'sell-filled', records: [first, ...rest] },
    });
  }

  const splits = receipts.filter((record) => SPLIT_STATUSES.has(record.receipt.status)).sort(byReceiptId);
  splits.forEach((record, index) => {
    const previous = index === 0 ? undefined : splits[index - 1];
    if (previous !== undefined && previous.receipt.ruleVersion !== record.receipt.ruleVersion) {
      items.push(fromReceipt({ type: 'rule-changed', record }));
    }
  });

  return items.sort((a, b) => {
    if (a.at !== b.at) return a.at > b.at ? -1 : 1;
    if (STEP[a.type] !== STEP[b.type]) return STEP[b.type] - STEP[a.type];
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
}

export interface NotificationsRead {
  /** Undefined until the inbox and the first page of receipts have loaded. */
  items: SleeveNotification[] | undefined;
  isError: boolean;
  /** Older receipts exist beyond the pages loaded so far. */
  hasMore: boolean;
  loadMore: () => void;
  loadingMore: boolean;
}

/** The feed for an account, from the data layer's existing reads. An undefined account waits. */
export function useNotifications(account: Address | undefined): NotificationsRead {
  const inbox = useInbox(account);
  const receipts = useReceipts({ account });
  const buckets = useBuckets(account);
  const pages = receipts.data?.pages;

  const items = useMemo(() => {
    if (inbox.data === undefined || pages === undefined) return undefined;
    return deriveNotifications({
      inbox: inbox.data,
      receipts: pages.flatMap((page) => page.items),
      buckets: buckets.data,
    });
  }, [inbox.data, pages, buckets.data]);

  const { fetchNextPage } = receipts;
  return {
    items,
    isError: inbox.isError || receipts.isError,
    hasMore: receipts.hasNextPage,
    loadMore: () => {
      void fetchNextPage();
    },
    loadingMore: receipts.isFetchingNextPage,
  };
}
