import { useCallback, useSyncExternalStore } from 'react';

import {
  DARK_QUERY,
  parseThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemePreference,
} from '@/styles/theme';

export { THEME_PREFERENCES, type ResolvedTheme, type ThemePreference } from '@/styles/theme';

/**
 * The owner's display preferences: transaction previews, the theme and which notifications to show. They are
 * per-viewer conveniences kept in this browser's localStorage, never on chain. When storage is missing or refuses a
 * write, a choice lasts until the tab closes and every reader still gets a complete set of values.
 *
 * The theme has its own key (styles/theme.ts), which the root layout's boot script reads before first paint.
 */

export const SETTINGS_STORAGE_KEY = 'sleeve:settings';

export const NOTIFICATION_TYPES = [
  'payment-arrived',
  'payment-split',
  'buy-filled',
  'buy-waiting',
  'buy-settled',
  'sell-filled',
  'released',
  'rule-changed',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface Settings {
  /** Show the preview card before the signature prompt. On by default. */
  previewsEnabled: boolean;
  theme: ThemePreference;
  notificationTypes: Readonly<Record<NotificationType, boolean>>;
}

function allNotificationTypes(enabled: boolean): Record<NotificationType, boolean> {
  return Object.fromEntries(NOTIFICATION_TYPES.map((type) => [type, enabled])) as Record<NotificationType, boolean>;
}

export const DEFAULT_SETTINGS: Settings = {
  previewsEnabled: true,
  theme: 'system',
  notificationTypes: allNotificationTypes(true),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads the stored settings and theme field by field, so a missing or malformed field falls back to its default
 * alone.
 */
export function parseSettings(raw: string | null, rawTheme: string | null): Settings {
  let stored: unknown = null;
  if (raw !== null) {
    try {
      stored = JSON.parse(raw);
    } catch {
      stored = null;
    }
  }
  const record = isRecord(stored) ? stored : {};
  const types = isRecord(record.notificationTypes) ? record.notificationTypes : {};
  const notificationTypes = allNotificationTypes(true);
  for (const type of NOTIFICATION_TYPES) {
    const value = types[type];
    if (typeof value === 'boolean') notificationTypes[type] = value;
  }
  return {
    previewsEnabled:
      typeof record.previewsEnabled === 'boolean' ? record.previewsEnabled : DEFAULT_SETTINGS.previewsEnabled,
    theme: parseThemePreference(rawTheme),
    notificationTypes,
  };
}

let current: Settings | null = null;
const listeners = new Set<() => void>();

function load(): Settings {
  try {
    return parseSettings(
      window.localStorage.getItem(SETTINGS_STORAGE_KEY),
      window.localStorage.getItem(THEME_STORAGE_KEY),
    );
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function notify(): void {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent): void {
  if (event.key !== null && event.key !== SETTINGS_STORAGE_KEY && event.key !== THEME_STORAGE_KEY) return;
  current = load();
  notify();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener('storage', onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('storage', onStorage);
  };
}

function getSnapshot(): Settings {
  current ??= load();
  return current;
}

function getServerSnapshot(): Settings {
  return DEFAULT_SETTINGS;
}

/** Writes one key. False when the browser keeps no storage for the page; the change still applies in this tab. */
function persist(key: string, value: string | null): boolean {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** Applies a change in this tab and saves it. False when the browser did not keep it. */
function update(next: Settings): boolean {
  current = next;
  const themeSaved = persist(THEME_STORAGE_KEY, next.theme === 'system' ? null : next.theme);
  const restSaved = persist(
    SETTINGS_STORAGE_KEY,
    JSON.stringify({ previewsEnabled: next.previewsEnabled, notificationTypes: next.notificationTypes }),
  );
  notify();
  return themeSaved && restSaved;
}

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches;
}

/** The boot script keeps following the system and other tabs; a choice made here applies at once. */
function applyTheme(preference: ThemePreference): void {
  document.documentElement.dataset.theme = resolveTheme(preference, systemPrefersDark());
}

/** Each setter applies at once and returns false when this browser did not keep the change for next time. */
export interface UseSettings extends Settings {
  setPreviewsEnabled: (enabled: boolean) => boolean;
  setTheme: (theme: ThemePreference) => boolean;
  setNotificationType: (type: NotificationType, enabled: boolean) => boolean;
}

export function useSettings(): UseSettings {
  const settings = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setPreviewsEnabled = useCallback(
    (enabled: boolean) => update({ ...getSnapshot(), previewsEnabled: enabled }),
    [],
  );

  const setTheme = useCallback((theme: ThemePreference) => {
    const saved = update({ ...getSnapshot(), theme });
    applyTheme(theme);
    return saved;
  }, []);

  const setNotificationType = useCallback((type: NotificationType, enabled: boolean) => {
    const snapshot = getSnapshot();
    return update({ ...snapshot, notificationTypes: { ...snapshot.notificationTypes, [type]: enabled } });
  }, []);

  return { ...settings, setPreviewsEnabled, setTheme, setNotificationType };
}

function subscribeToSystemTheme(listener: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => undefined;
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}

function getSystemServerSnapshot(): null {
  return null;
}

/** The theme the page shows now, or null on the server and during hydration, when it cannot be known. */
export function useResolvedTheme(): ResolvedTheme | null {
  const { theme } = useSettings();
  const prefersDark = useSyncExternalStore(subscribeToSystemTheme, systemPrefersDark, getSystemServerSnapshot);
  return prefersDark === null ? null : resolveTheme(theme, prefersDark);
}
