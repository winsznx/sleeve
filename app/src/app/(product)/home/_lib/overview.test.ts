import type { Rule } from '@sleeve/core';
import { beforeAll, describe, expect, it } from 'vitest';

import { axisTicks } from '@/components/charts/stacked-bar-chart';
import { createMockDataLayer, NEXT_OPEN, SAMPLE_ACCOUNT } from '@/data/mock';
import type { BucketView, Holding, ReceiptRecord, SplitPreview } from '@/data/types';

import { lintText } from '../../../../../../scripts/copy-lint.mjs';
import { allocation, chartBars, monthCells, newYorkDay, paydayPoints, periodPoints, upNext } from './overview';

let receipts: ReceiptRecord[] = [];
let holdings: Holding[] = [];
let buckets: BucketView[] = [];
let rule: Rule;
let preview: SplitPreview;
let now = 0n;

beforeAll(async () => {
  const layer = createMockDataLayer();
  [receipts, holdings, buckets, rule, preview] = await Promise.all([
    layer.listReceipts({ account: SAMPLE_ACCOUNT, limit: 100 }).then((page) => page.items),
    layer.getHoldings(SAMPLE_ACCOUNT),
    layer.getBuckets(SAMPLE_ACCOUNT),
    layer.getRule(SAMPLE_ACCOUNT),
    layer.previewSplit(SAMPLE_ACCOUNT),
  ]);
  now = (await layer.getLedger(SAMPLE_ACCOUNT)).asOf.timestamp;
});

describe('paydays', () => {
  it('turns every split into a payday, oldest first, its parts adding up to what arrived', () => {
    const points = paydayPoints(receipts, true);
    expect(points.map((point) => point.id)).toEqual(['198', '212', '305', '388', '455', '560', '611', '642']);
    for (const point of points) expect(point.spend + point.bought + point.waiting).toBe(point.total);
  });

  it('counts a share that waited and then bought as bought, and one released as spendable', () => {
    const byId = new Map(paydayPoints(receipts, true).map((point) => [point.id, point]));
    expect(byId.get('388')).toMatchObject({ bought: 65_000_000n, waiting: 0n });
    expect(byId.get('198')).toMatchObject({ spend: 100_000_000n, bought: 0n, waiting: 0n });
    expect(byId.get('642')).toMatchObject({ waiting: 75_000_000n });
  });

  it('sums paydays by New York week from Monday', () => {
    const weeks = periodPoints(paydayPoints(receipts, true), 'week');
    expect(weeks.map((week) => week.paydays.length)).toEqual([4, 4]);
    expect(weeks[1]?.total).toBe(3_387_250_000n);
  });

  it('names each bar in words for assistive technology', () => {
    const bars = chartBars(periodPoints(paydayPoints(receipts, true), 'payday'), 'payday');
    expect(bars.at(-1)?.description).toBe(
      'Saturday 26 September: 750.00 USDG arrived. 675.00 USDG stayed spendable and 75.00 USDG waits to buy SPY.',
    );
    for (const bar of bars) expect(lintText(bar.description)).toEqual([]);
  });

  it('puts round ticks above the largest bar', () => {
    expect(axisTicks(1_200)).toEqual([0, 500, 1_000, 1_500]);
    expect(axisTicks(0)).toEqual([0, 1]);
  });
});

describe('the month', () => {
  it('lays September 2026 out from Monday, with closed days, today, the next open and the paydays', () => {
    const weeks = monthCells({ year: 2026, month: 8 }, paydayPoints(receipts, true), newYorkDay(now), newYorkDay(NEXT_OPEN));
    const cells = weeks.flat();
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(cells[0]?.date).toBeNull();
    expect(cells[1]?.date).toBe(1);
    const day = (date: number) => cells.find((cell) => cell.date === date);
    expect(day(7)).toMatchObject({ closed: true });
    expect(day(7)?.description).toBe('Monday 7 September, market holiday');
    expect(day(26)).toMatchObject({ today: true, closed: true, marks: ['waiting'] });
    expect(day(27)).toMatchObject({ reopens: true });
    expect(day(22)).toMatchObject({ closed: false, marks: ['bought'] });
  });
});

describe('the money at a glance', () => {
  it('divides the Stock Tokens by value, largest first', () => {
    const { total, slices } = allocation(holdings);
    expect(slices.map((slice) => slice.tickerId)).toEqual([0, 1]);
    expect(slices.reduce((sum, slice) => sum + slice.value, 0n)).toBe(total);
  });

  it('says what happens next to what is not sorted and what waits, in plain words', () => {
    const lines = upNext(preview, buckets, rule, () => NEXT_OPEN);
    expect(lines.map((line) => line.text)).toEqual([
      '165.80 USDG not sorted yet splits next: 149.22 USDG stays spendable and 16.58 USDG waits to buy SPY.',
      '75.00 USDG buys SPY after the market opens, Sun 27 Sep, 20:00 New York time.',
    ]);
    for (const line of lines) expect(lintText(line.text)).toEqual([]);
    expect(upNext({ ...preview, unsorted: 0n }, [], rule, () => null).map((line) => line.text)).toEqual([
      'Nothing is pending. Your next payment splits by your rule: 90% stays spendable and 10% buys SPY.',
    ]);
  });
});
