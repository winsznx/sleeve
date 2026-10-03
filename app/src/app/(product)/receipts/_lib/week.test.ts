import { describe, expect, it } from 'vitest';

import { createMockDataLayer, FIXTURE_NOW, SAMPLE_ACCOUNT, SAMPLE_WEEK_START } from '@/data/mock';

import { weekLabel, weekOptions, weekStartOf } from './week';

const at = (iso: string): bigint => BigInt(Date.parse(iso) / 1_000);

describe('weekStartOf', () => {
  it('finds the Monday the sample week card covers from the fixture clock', () => {
    expect(weekStartOf(FIXTURE_NOW.timestamp)).toBe(SAMPLE_WEEK_START);
  });

  it('keeps Sunday evening New York time in the week that began the Monday before', () => {
    // Sunday 27 September, 20:00 New York, is already Monday in UTC.
    expect(weekStartOf(at('2026-09-28T00:00:00Z'))).toBe(at('2026-09-21T04:00:00Z'));
  });

  it('starts a week exactly at Monday midnight New York time', () => {
    expect(weekStartOf(at('2026-09-28T04:00:00Z'))).toBe(at('2026-09-28T04:00:00Z'));
    expect(weekStartOf(at('2026-09-28T03:59:59Z'))).toBe(at('2026-09-21T04:00:00Z'));
  });

  it('moves to standard time after the November clock change', () => {
    expect(weekStartOf(at('2026-11-03T12:00:00Z'))).toBe(at('2026-11-02T05:00:00Z'));
    // Sunday 1 November, after the change at 06:00 UTC, still belongs to the daylight-time Monday.
    expect(weekStartOf(at('2026-11-01T12:00:00Z'))).toBe(at('2026-10-26T04:00:00Z'));
  });

  it('moves to daylight time after the March clock change', () => {
    expect(weekStartOf(at('2026-03-08T12:00:00Z'))).toBe(at('2026-03-02T05:00:00Z'));
    expect(weekStartOf(at('2026-03-09T04:00:00Z'))).toBe(at('2026-03-09T04:00:00Z'));
  });
});

describe('weekOptions', () => {
  it('offers the weeks with a payday or a buy, newest first, named by their Monday', async () => {
    const page = await createMockDataLayer().listReceipts({ account: SAMPLE_ACCOUNT, limit: 100 });
    expect(weekOptions(page.items)).toEqual([
      { weekStart: SAMPLE_WEEK_START, label: 'Week of 21 Sep 2026' },
      { weekStart: at('2026-09-14T04:00:00Z'), label: 'Week of 14 Sep 2026' },
    ]);
  });

  it('names a standard-time week by its Monday too', () => {
    expect(weekLabel(at('2026-11-02T05:00:00Z'))).toBe('Week of 2 Nov 2026');
  });
});
