import type { Address } from '@sleeve/core';

/**
 * Which payment split this browser last showed as an account's latest payment. Home grows the equity segment
 * once, when a new split first appears (docs/DESIGN.md 10), so it needs to remember across visits. This is a
 * per-viewer convenience: when storage is missing or refuses, the split simply does not move.
 */

const KEY_PREFIX = 'sleeve:home:last-split:';
const RECEIPT_ID = /^\d+$/;

function keyFor(account: Address): string {
  return `${KEY_PREFIX}${account.toLowerCase()}`;
}

function lastShown(storage: Storage, account: Address): bigint | null {
  const stored = storage.getItem(keyFor(account));
  return stored !== null && RECEIPT_ID.test(stored) ? BigInt(stored) : null;
}

/** True the first time this browser shows the split as the account's latest payment. */
export function isFirstShowing(account: Address, receiptId: bigint): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const shown = lastShown(window.localStorage, account);
    return shown === null || shown < receiptId;
  } catch {
    return false;
  }
}

/** Records the split as shown. Returns false when the browser keeps no storage for the page. */
export function rememberShown(account: Address, receiptId: bigint): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const storage = window.localStorage;
    const shown = lastShown(storage, account);
    if (shown === null || shown < receiptId) storage.setItem(keyFor(account), receiptId.toString());
    return true;
  } catch {
    return false;
  }
}
