import type { Address } from '@sleeve/core';

import type { BucketWaitRecord } from '../store/store';
import type { WaitReason } from './settle';

/** bucket_waits.last_seen_at is written at most this often while nothing else about the wait changes. */
export const LAST_SEEN_WRITE_SECONDS = 300n;

export interface ObservedWait {
  account: Address;
  tickerId: number;
  reason: WaitReason;
  bucketSince: bigint;
  /** Chain time of the simulation. */
  now: bigint;
}

export interface WaitUpdate {
  row: BucketWaitRecord;
  /** False when only last_seen_at moved, and recently enough that the write can wait. */
  write: boolean;
}

/**
 * The bucket_waits row after a settle simulation returned `reason` (SPEC 10, audit A1-32): first_seen_at stays while
 * the reason and the bucket stay, and starts over when either changes. After five days on one reason the app asks
 * the owner to raise the cap, switch ticker or release (PRD 7.4).
 */
export function nextBucketWait(previous: BucketWaitRecord | undefined, observed: ObservedWait): WaitUpdate {
  const same =
    previous !== undefined && previous.reason === observed.reason && previous.bucketSince === observed.bucketSince;
  if (same) {
    const lastSeenAt = observed.now > previous.lastSeenAt ? observed.now : previous.lastSeenAt;
    return {
      row: { ...previous, lastSeenAt },
      write: lastSeenAt - previous.lastSeenAt >= LAST_SEEN_WRITE_SECONDS,
    };
  }
  return {
    row: {
      account: observed.account,
      tickerId: observed.tickerId,
      reason: observed.reason,
      bucketSince: observed.bucketSince,
      firstSeenAt: observed.now,
      lastSeenAt: observed.now,
    },
    write: true,
  };
}

/**
 * Remembers which skips were recorded, so a hold that lasts (a gas spike, a dust balance, an account the keeper does
 * not serve) writes one keeper_runs row when it starts or changes and then one an hour, not one per poll.
 */
export class SkipJournal {
  private readonly seen = new Map<string, { reason: string; at: number }>();

  constructor(
    private readonly intervalMs: number = 3_600_000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  shouldRecord(key: string, reason: string): boolean {
    const last = this.seen.get(key);
    const at = this.now();
    if (last !== undefined && last.reason === reason && at - last.at < this.intervalMs) return false;
    this.seen.set(key, { reason, at });
    return true;
  }

  clear(key: string): void {
    this.seen.delete(key);
  }
}
