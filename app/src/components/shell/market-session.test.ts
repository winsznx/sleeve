import { describe, expect, it } from 'vitest';

import type { TickerMarket } from '@/data/types';

import { chainNow, sessionView, sessionWords } from './market-session';

/** Sat 26 Sep 2026 14:00 New York, the mock's clock: closed for the weekend. */
const SATURDAY = 1_790_445_600n;
/** Sun 27 Sep 2026 20:00 New York, when the 24/5 session reopens. */
const SUNDAY_OPEN = 1_790_553_600n;
/** Fri 2 Oct 2026 20:00 New York, when it closes again. */
const FRIDAY_CLOSE = 1_790_985_600n;

function market(session: TickerMarket['session']): TickerMarket {
  return {
    tickerId: 0,
    active: true,
    session,
    feed: { feed: '0x319724394D3A0e3669269846abE664Cd621f9f6A', roundId: 1n, answer: 77_232_000_000n, updatedAt: SATURDAY - 80_000n },
    uiMultiplier: 10n ** 18n,
    pendingMultiplier: null,
    paused: false,
    oraclePaused: false,
    poolPrice: null,
  };
}

const CLOSED_WEEKEND = market({ open: false, reason: 'WEEKEND', openedAt: null, nextOpenAt: SUNDAY_OPEN });

describe('chain time now', () => {
  it('moves the snapshot clock on by the whole seconds since it was read', () => {
    expect(chainNow(SATURDAY, 1_000, 1_000)).toBe(SATURDAY);
    expect(chainNow(SATURDAY, 1_000, 62_999)).toBe(SATURDAY + 61n);
  });

  it('never goes behind the snapshot when the wall clock reads earlier', () => {
    expect(chainNow(SATURDAY, 5_000, 1_000)).toBe(SATURDAY);
  });
});

describe('the session view', () => {
  it('counts down to the reopen while the snapshot and the calendar agree', () => {
    // #given the data layer says closed for the weekend at Saturday 14:00
    // #when nothing has moved since the snapshot
    const view = sessionView(CLOSED_WEEKEND, SATURDAY, SATURDAY);
    // #then the next change is the Sunday 20:00 reopen
    expect(view).toEqual({ state: 'closed', reason: 'WEEKEND', opensAt: SUNDAY_OPEN });
    expect(sessionWords(view, SATURDAY)).toMatchObject({
      tone: 'closed',
      title: 'Market closed',
      short: 'Closed',
      countdown: 'opens in 1d 6h',
      remaining: '1d 6h',
      when: 'Sun 27 Sep, 20:00',
      sentence: 'Market closed, opens Sunday 27 September at 20:00 New York time, in 1 day 6 hours.',
    });
  });

  it('carries the state across the reopen without waiting for a new snapshot', () => {
    const view = sessionView(CLOSED_WEEKEND, SATURDAY, SUNDAY_OPEN + 60n);
    expect(view).toEqual({ state: 'open', openedAt: SUNDAY_OPEN, closesAt: FRIDAY_CLOSE });
    expect(sessionWords(view, SUNDAY_OPEN + 60n).countdown).toBe('closes in 4d 23h');
  });

  it('believes the snapshot over the calendar when they disagree, and counts nothing down', () => {
    // #given a data layer that says open on a Saturday, as a calendar change the port lacks would
    const odd = market({ open: true, reason: 'OPEN', openedAt: SATURDAY - 600n, nextOpenAt: null });
    // #then the pill shows open with no close time to count to
    const view = sessionView(odd, SATURDAY, SATURDAY + 5n);
    expect(view).toEqual({ state: 'open', openedAt: SATURDAY - 600n, closesAt: null });
    expect(sessionWords(view, SATURDAY + 5n)).toMatchObject({ countdown: null, remaining: null, sentence: 'Market open.' });
  });

  it('names holidays and early closes, and says when hours are unknown', () => {
    // Thanksgiving 2026, 10:00 New York, and Fri 27 Nov 2026 18:00 New York after the early close
    const thanksgiving = 1_795_705_200n;
    const holiday = market({ open: false, reason: 'HOLIDAY', openedAt: null, nextOpenAt: null });
    expect(sessionWords(sessionView(holiday, thanksgiving, thanksgiving), thanksgiving).title).toBe('Closed for a holiday');
    const afterEarlyClose = 1_795_820_400n;
    const early = market({ open: false, reason: 'EARLY_CLOSE', openedAt: null, nextOpenAt: null });
    expect(sessionWords(sessionView(early, afterEarlyClose, afterEarlyClose), afterEarlyClose).title).toBe('Closed early today');
    const beyond = 1_830_315_600n;
    const unknown = market({ open: false, reason: 'OUT_OF_RANGE', openedAt: null, nextOpenAt: null });
    expect(sessionWords(sessionView(unknown, beyond, beyond), beyond)).toMatchObject({ tone: 'unknown', title: 'Market hours unknown' });
  });
});
