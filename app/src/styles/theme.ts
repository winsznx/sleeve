/**
 * The theme switch's plumbing, with no React in it so the root layout (a server component) can inline the boot
 * script. The owner's choice lives in localStorage under THEME_STORAGE_KEY as "light" or "dark"; no entry means
 * follow the system. tokens.css holds both themes and keys the dark one off data-theme on <html>.
 */

export const THEME_STORAGE_KEY = 'sleeve:theme';

export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ResolvedTheme = Exclude<ThemePreference, 'system'>;

export const DARK_QUERY = '(prefers-color-scheme: dark)';

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value);
}

/** A stored value as a preference: anything but light or dark follows the system. */
export function parseThemePreference(stored: string | null): ThemePreference {
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (preference !== 'system') return preference;
  return systemPrefersDark ? 'dark' : 'light';
}

/**
 * Runs in <head> before first paint, so a dark page never flashes light. It mirrors parseThemePreference and
 * resolveTheme, then keeps data-theme in step with the system setting while the preference is system, and with a
 * choice made in another tab. Storage that throws leaves the system setting in charge.
 */
export const THEME_BOOT_SCRIPT = `(function(){var d=document.documentElement,k=${JSON.stringify(THEME_STORAGE_KEY)},m=window.matchMedia?window.matchMedia(${JSON.stringify(DARK_QUERY)}):null;function p(){try{var s=localStorage.getItem(k);return s==="light"||s==="dark"?s:"system"}catch(e){return"system"}}function a(){var t=p();d.dataset.theme=t==="system"?(m&&m.matches?"dark":"light"):t}a();if(m&&m.addEventListener)m.addEventListener("change",a);window.addEventListener("storage",function(e){if(e.key===null||e.key===k)a()})})();`;
