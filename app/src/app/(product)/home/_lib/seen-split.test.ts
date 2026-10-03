import type { Address } from '@sleeve/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isFirstShowing, rememberShown } from './seen-split';

const OWNER: Address = '0x3efEf72Ee9aF42fd90f193A1A64aC25384179b36';
const OWNER_LOWER_CASE: Address = '0x3efef72ee9af42fd90f193a1a64ac25384179b36';
const OTHER: Address = '0x9b2C3fA0E14d6a7E5f8B1C0d2E3F4a5B6c7D8e91';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('seen split', () => {
  it('treats a split as new until it is remembered, account by account', () => {
    expect(isFirstShowing(OWNER, 642n)).toBe(true);
    expect(rememberShown(OWNER, 642n)).toBe(true);
    expect(isFirstShowing(OWNER, 642n)).toBe(false);
    expect(isFirstShowing(OWNER_LOWER_CASE, 642n)).toBe(false);
    expect(isFirstShowing(OTHER, 642n)).toBe(true);
  });

  it('calls a newer split new and never steps back to an older one', () => {
    rememberShown(OWNER, 642n);
    expect(isFirstShowing(OWNER, 700n)).toBe(true);
    rememberShown(OWNER, 611n);
    expect(isFirstShowing(OWNER, 642n)).toBe(false);
  });

  it('starts over when what is stored is not a receipt id', () => {
    window.localStorage.setItem(`sleeve:home:last-split:${OWNER.toLowerCase()}`, 'not a number');
    expect(isFirstShowing(OWNER, 1n)).toBe(true);
  });

  it('keeps the split still when the browser refuses storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(isFirstShowing(OWNER, 642n)).toBe(false);
    expect(rememberShown(OWNER, 642n)).toBe(false);
  });
});
