import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { resolveTheme, THEME_BOOT_SCRIPT, THEME_STORAGE_KEY } from '@/styles/theme';

import { DEFAULT_SETTINGS, parseSettings, SETTINGS_STORAGE_KEY, useSettings } from './settings';

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe('parseSettings', () => {
  it('falls back to the defaults, previews on and the system theme, for nothing or for junk', () => {
    expect(parseSettings(null, null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('not json', 'purple')).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.previewsEnabled).toBe(true);
    expect(DEFAULT_SETTINGS.theme).toBe('system');
  });

  it('keeps each valid field and defaults the rest one by one', () => {
    const parsed = parseSettings(JSON.stringify({ previewsEnabled: false, notificationTypes: { released: false, 'buy-filled': 'no' } }), 'dark');
    expect(parsed.previewsEnabled).toBe(false);
    expect(parsed.theme).toBe('dark');
    expect(parsed.notificationTypes.released).toBe(false);
    expect(parsed.notificationTypes['buy-filled']).toBe(true);
  });
});

describe('useSettings', () => {
  it('saves a change in this browser and applies the theme at once', () => {
    const { result } = renderHook(() => useSettings());
    act(() => {
      result.current.setPreviewsEnabled(false);
    });
    expect(result.current.previewsEnabled).toBe(false);
    expect(JSON.parse(window.localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{}')).toMatchObject({ previewsEnabled: false });

    act(() => {
      result.current.setTheme('dark');
    });
    expect(result.current.theme).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');

    act(() => {
      result.current.setTheme('system');
    });
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();

    act(() => {
      result.current.setNotificationType('payment-arrived', false);
    });
    expect(result.current.notificationTypes['payment-arrived']).toBe(false);
    expect(result.current.notificationTypes['payment-split']).toBe(true);
  });
});

describe('the theme', () => {
  it('follows the system unless the owner chose one', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
  });

  it('boots from the saved choice before React runs', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    new Function(THEME_BOOT_SCRIPT)();
    expect(document.documentElement.dataset.theme).toBe('dark');
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    new Function(THEME_BOOT_SCRIPT)();
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
