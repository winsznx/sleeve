import { describe, expect, it } from 'vitest';

import { describeNotification } from '@/components/notifications/notification-words';

import { createMockDataLayer, SAMPLE_ACCOUNT, SAMPLE_RECEIPT_IDS } from './mock';
import { deriveNotifications, type SleeveNotification } from './notifications';
import type { ReceiptRecord } from './types';

async function sampleFeed(): Promise<SleeveNotification[]> {
  const layer = createMockDataLayer();
  const receipts: ReceiptRecord[] = [];
  let cursor: string | undefined;
  do {
    const page = await layer.listReceipts({ account: SAMPLE_ACCOUNT, cursor, limit: 50 });
    receipts.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return deriveNotifications({
    inbox: await layer.getInbox(SAMPLE_ACCOUNT),
    receipts,
    buckets: await layer.getBuckets(SAMPLE_ACCOUNT),
  });
}

function find(feed: readonly SleeveNotification[], id: string): SleeveNotification {
  const found = feed.find((notification) => notification.id === id);
  if (found === undefined) throw new Error(`no notification ${id}`);
  return found;
}

describe('deriveNotifications', () => {
  it('lists newest first, the later step of one action above the earlier one', async () => {
    const feed = await sampleFeed();
    for (let index = 1; index < feed.length; index += 1) {
      expect((feed[index - 1]?.at ?? 0n) >= (feed[index]?.at ?? 0n)).toBe(true);
    }
    const split = feed.findIndex((notification) => notification.id === `payment-split:${SAMPLE_RECEIPT_IDS.filledSpy}`);
    const filled = feed.findIndex((notification) => notification.id === `buy-filled:${SAMPLE_RECEIPT_IDS.filledSpy}`);
    expect(filled).toBeGreaterThanOrEqual(0);
    expect(filled).toBeLessThan(split);
  });

  it('turns a split that bought into the split and the buy, with the price against the reference', async () => {
    const feed = await sampleFeed();
    const split = describeNotification(find(feed, `payment-split:${SAMPLE_RECEIPT_IDS.filledSpy}`));
    expect(split.text).toMatch(/^1,200\.00 USDG split: .+ stayed spendable and .+ bought SPY\.$/);
    expect(split.href).toBe('/payments');
    const buy = describeNotification(find(feed, `buy-filled:${SAMPLE_RECEIPT_IDS.filledSpy}`));
    expect(buy.title).toBe('Bought SPY');
    expect(buy.text).toMatch(/USDG each\. Bought .+ (above|below) the market reference\.$/);
    expect(buy.href).toBe(`/receipts/${SAMPLE_RECEIPT_IDS.filledSpy}`);
    expect(buy.stockToken).toBe(true);
  });

  it('says why a buy waits, and leads to Home while the USDG still waits', async () => {
    const feed = await sampleFeed();
    const waiting = describeNotification(find(feed, `buy-waiting:${SAMPLE_RECEIPT_IDS.queuedSession}`));
    expect(waiting.text).toMatch(/waits as USDG to buy SPY, because the market was closed\.$/);
    expect(waiting.href).toBe('/home');
    expect(waiting.stockToken).toBe(false);
  });

  it('says the market reopened when a settled buy had waited for it', async () => {
    const feed = await sampleFeed();
    const settled = describeNotification(find(feed, `buy-settled:${SAMPLE_RECEIPT_IDS.settled}`));
    expect(settled.title).toBe('Market reopened');
    expect(settled.text).toMatch(/that waited since 19 Sep 2026 became .+ SPY/);
  });

  it('shows one sell once, with the totals of every lot it touched', async () => {
    const feed = await sampleFeed();
    const sells = feed.filter((notification) => notification.type === 'sell-filled');
    const sale = find(sells, `sell-filled:${SAMPLE_RECEIPT_IDS.sold}`);
    if (sale.event.type !== 'sell-filled') throw new Error('not a sell');
    expect(sale.event.records.map((record) => record.receipt.id)).toEqual([SAMPLE_RECEIPT_IDS.sold, SAMPLE_RECEIPT_IDS.partSold]);
    expect(describeNotification(sale).text).toMatch(/^0\.13 QQQ became .+ USDG, which went to spend\. Sold .+ below the market reference\.$/);
  });

  it('marks the first split under a new rule version as a rule change', async () => {
    const feed = await sampleFeed();
    const changes = feed.filter((notification) => notification.type === 'rule-changed');
    expect(changes).toHaveLength(1);
    const change = describeNotification(changes[0] as SleeveNotification);
    expect(change.text).toBe('Your new rule took effect: 10% of each payment buys SPY and the rest stays spendable.');
    expect(change.href).toBe('/rule');
  });

  it('lists every payment that arrived, and says when one is not split yet', async () => {
    const layer = createMockDataLayer();
    const inbox = await layer.getInbox(SAMPLE_ACCOUNT);
    const feed = deriveNotifications({ inbox, receipts: [], buckets: undefined });
    expect(feed.map((notification) => notification.type)).toEqual(inbox.map(() => 'payment-arrived'));
    const unsorted = inbox.find((item) => item.state !== 'SORTED');
    if (unsorted === undefined) throw new Error('the sample has an unsorted payment');
    expect(describeNotification(find(feed, `payment-arrived:${unsorted.id}`)).text).toMatch(
      /arrived from 0x.+\. It stays spendable until your rule splits it\.$/,
    );
  });
});
