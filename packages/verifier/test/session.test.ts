import { describe, expect, it } from 'vitest';

import type { CalendarReading } from '../src/evidence';
import { calendarLibraryVersion, calendarVersionAt, calendarWrites, sessionAtReceipt } from '../src/session';
import { MONDAY, MONDAY_OPENED, SATURDAY } from './support/fixtures';

function reading(overrides: Partial<CalendarReading> = {}): CalendarReading {
  return { versionNow: 65_536, writeCountNow: 0, writesAfter: 0, session: null, ...overrides };
}

describe('the calendar version', () => {
  it('splits into the library version and the write count', () => {
    expect(calendarLibraryVersion(65_538)).toBe(1);
    expect(calendarWrites(65_538)).toBe(2);
  });

  it('at a receipt is the version now less the writes since', () => {
    expect(calendarVersionAt(reading({ versionNow: 65_539, writeCountNow: 3, writesAfter: 2 }))).toBe(65_537);
  });
});

describe('the session at a receipt', () => {
  it('comes from the port with no write in force, and the deployed calendar is a second opinion', () => {
    // #given the extension agrees on a Monday
    const agreeing = reading({ session: { ok: true, value: { open: true, reason: 'OPEN', openedAt: MONDAY_OPENED } } });
    // #when
    const result = sessionAtReceipt(MONDAY, 'ALL_DAY', 65_536, agreeing);
    // #then
    expect(result).toEqual({ ok: true, value: { open: true, reason: 'OPEN', openedAt: MONDAY_OPENED, authority: 'port', extensionAgrees: true } });
  });

  it('flags a deployed calendar that disagrees', () => {
    const disagreeing = reading({ session: { ok: true, value: { open: true, reason: 'OPEN', openedAt: MONDAY_OPENED - 1n } } });
    const result = sessionAtReceipt(MONDAY, 'ALL_DAY', 65_536, disagreeing);
    expect(result.ok && result.value.extensionAgrees).toBe(false);
  });

  it('is closed on a Saturday by the port', () => {
    const result = sessionAtReceipt(SATURDAY, 'ALL_DAY', 65_536, reading());
    expect(result).toEqual({ ok: true, value: { open: false, reason: 'WEEKEND', openedAt: null, authority: 'port', extensionAgrees: null } });
  });

  it('comes from the deployed calendar once a write is in force', () => {
    const extension = reading({ session: { ok: true, value: { open: false, reason: 'HOLIDAY', openedAt: 0n } } });
    const result = sessionAtReceipt(MONDAY, 'ALL_DAY', 65_537, extension);
    expect(result).toEqual({ ok: true, value: { open: false, reason: 'HOLIDAY', openedAt: null, authority: 'extension', extensionAgrees: null } });
  });

  it('cannot answer without the deployed calendar once a write is in force', () => {
    expect(sessionAtReceipt(MONDAY, 'ALL_DAY', 65_537, reading()).ok).toBe(false);
    expect(sessionAtReceipt(MONDAY, 'ALL_DAY', 65_537, reading({ session: { ok: false, error: 'reverted' } })).ok).toBe(false);
  });

  it('does not use the port for another library version', () => {
    const extension = reading({ session: { ok: true, value: { open: true, reason: 'OPEN', openedAt: MONDAY_OPENED } } });
    const result = sessionAtReceipt(MONDAY, 'ALL_DAY', 2 << 16, extension);
    expect(result.ok && result.value.authority).toBe('extension');
  });
});
