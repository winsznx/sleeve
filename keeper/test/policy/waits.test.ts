import { describe, expect, it } from 'vitest';

import { LAST_SEEN_WRITE_SECONDS, SkipJournal, nextBucketWait } from '../../src/policy/waits';
import type { BucketWaitRecord } from '../../src/store/store';

const ACCOUNT = '0xada0000000000000000000000000000000000001';
const SINCE = 1_791_068_000n;

const existing: BucketWaitRecord = {
  account: ACCOUNT,
  tickerId: 0,
  reason: 'PREMIUM',
  bucketSince: SINCE,
  firstSeenAt: SINCE + 100n,
  lastSeenAt: SINCE + 200n,
};

describe('nextBucketWait', () => {
  it('starts a row for a bucket it has not seen', () => {
    // #when
    const update = nextBucketWait(undefined, { account: ACCOUNT, tickerId: 0, reason: 'SESSION', bucketSince: SINCE, now: SINCE + 5n });
    // #then
    expect(update).toEqual({
      row: { account: ACCOUNT, tickerId: 0, reason: 'SESSION', bucketSince: SINCE, firstSeenAt: SINCE + 5n, lastSeenAt: SINCE + 5n },
      write: true,
    });
  });

  it('keeps first_seen_at while the reason and the bucket stay, writing last_seen_at every five minutes', () => {
    // #when
    const soon = nextBucketWait(existing, { account: ACCOUNT, tickerId: 0, reason: 'PREMIUM', bucketSince: SINCE, now: SINCE + 260n });
    const later = nextBucketWait(existing, {
      account: ACCOUNT,
      tickerId: 0,
      reason: 'PREMIUM',
      bucketSince: SINCE,
      now: SINCE + 200n + LAST_SEEN_WRITE_SECONDS,
    });
    // #then
    expect([soon.write, soon.row.firstSeenAt, later.write, later.row.lastSeenAt]).toEqual([
      false,
      SINCE + 100n,
      true,
      SINCE + 200n + LAST_SEEN_WRITE_SECONDS,
    ]);
  });

  it('starts first_seen_at over when the reason changes', () => {
    // #when
    const update = nextBucketWait(existing, { account: ACCOUNT, tickerId: 0, reason: 'SESSION', bucketSince: SINCE, now: SINCE + 900n });
    // #then
    expect([update.write, update.row.firstSeenAt, update.row.reason]).toEqual([true, SINCE + 900n, 'SESSION']);
  });

  it('starts first_seen_at over for a new bucket on the same ticker', () => {
    // #when
    const update = nextBucketWait(existing, { account: ACCOUNT, tickerId: 0, reason: 'PREMIUM', bucketSince: SINCE + 5_000n, now: SINCE + 5_000n });
    // #then
    expect([update.write, update.row.firstSeenAt]).toEqual([true, SINCE + 5_000n]);
  });

  it('never moves last_seen_at backwards', () => {
    // #when
    const update = nextBucketWait(existing, { account: ACCOUNT, tickerId: 0, reason: 'PREMIUM', bucketSince: SINCE, now: SINCE + 150n });
    // #then
    expect(update.row.lastSeenAt).toBe(SINCE + 200n);
  });
});

describe('SkipJournal', () => {
  it('records a hold when it starts, when its reason changes, and then hourly', () => {
    // #given
    let now = 0;
    const journal = new SkipJournal(3_600_000, () => now);
    // #when
    const answers = [journal.shouldRecord('SPLIT:a', 'GAS_CEILING')];
    now = 60_000;
    answers.push(journal.shouldRecord('SPLIT:a', 'GAS_CEILING'));
    answers.push(journal.shouldRecord('SPLIT:a', 'DUST'));
    now = 60_000 + 3_600_000;
    answers.push(journal.shouldRecord('SPLIT:a', 'DUST'));
    // #then
    expect(answers).toEqual([true, false, true, true]);
  });

  it('records again after a clear', () => {
    // #given
    const journal = new SkipJournal(3_600_000, () => 0);
    journal.shouldRecord('SPLIT:a', 'GAS_CEILING');
    // #when
    journal.clear('SPLIT:a');
    // #then
    expect(journal.shouldRecord('SPLIT:a', 'GAS_CEILING')).toBe(true);
  });
});
