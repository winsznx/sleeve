import {
  CALENDAR_VERSION,
  sessionIsOpen,
  sessionOpenedAt,
  type SessionReason,
  type SessionType,
} from '@sleeve/core';

import type { CalendarReading } from './evidence';

/**
 * The market session at a receipt. The calendar version a receipt records is the library version in the high 16 bits
 * and the count of timelocked writes in the low 16 (SessionCalendarExtension.version()). With no write in force, the
 * packages/core port of the library gives the answer and the deployed extension is a second opinion. Once a write is
 * in force the port no longer covers the schedule, so the extension's answer stands alone: a write can only change
 * instants after it executes (D-017), so the extension read today answers for a past timestamp as it did then.
 */

export interface SessionAtReceipt {
  open: boolean;
  reason: SessionReason;
  /** When the open stretch began, or null while closed. */
  openedAt: bigint | null;
  /** Which calendar answered. */
  authority: 'port' | 'extension';
  /** The extension's answer beside the port's, when the port answered and the extension was read. */
  extensionAgrees: boolean | null;
}

export type SessionResult = { ok: true; value: SessionAtReceipt } | { ok: false; error: string };

export function calendarLibraryVersion(version: number): number {
  return version >>> 16;
}

export function calendarWrites(version: number): number {
  return version & 0xffff;
}

/** The calendar version in force at the receipt: the version now less one per write after the receipt. */
export function calendarVersionAt(reading: CalendarReading): number {
  return reading.versionNow - reading.writesAfter;
}

export function sessionAtReceipt(
  timestamp: bigint,
  sessionType: SessionType,
  versionAtReceipt: number,
  reading: CalendarReading,
): SessionResult {
  const portApplies = calendarLibraryVersion(versionAtReceipt) === CALENDAR_VERSION && calendarWrites(versionAtReceipt) === 0;
  const extension = reading.session;
  if (!portApplies) {
    if (extension === null) return { ok: false, error: 'the calendar extension was not read' };
    if (!extension.ok) return { ok: false, error: `sessionState on the calendar extension failed: ${extension.error}` };
    const { open, reason, openedAt } = extension.value;
    return { ok: true, value: { open, reason, openedAt: open ? openedAt : null, authority: 'extension', extensionAgrees: null } };
  }
  const answer = sessionIsOpen(timestamp, sessionType);
  const openedAt = answer.open ? sessionOpenedAt(timestamp, sessionType) : null;
  let extensionAgrees: boolean | null = null;
  if (extension !== null && extension.ok) {
    const other = extension.value;
    extensionAgrees =
      other.open === answer.open && other.reason === answer.reason && (!answer.open || other.openedAt === openedAt);
  }
  return {
    ok: true,
    value: { open: answer.open, reason: answer.reason, openedAt, authority: 'port', extensionAgrees },
  };
}
