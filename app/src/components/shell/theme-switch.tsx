'use client';

import type { JSX } from 'react';

import { SegmentedControl } from '@/components/ui/choice';
import { cx } from '@/components/ui/cx';
import { THEME_PREFERENCES, useResolvedTheme, useSettings, type ThemePreference } from '@/lib/settings';

import { NavIcon } from './glyphs';

/**
 * The theme controls (D-029). The top bar's toggle flips between light and dark and remembers the choice; Settings
 * and the phone's More sheet offer the full choice, with System as the default. The toggle draws both glyphs and
 * lets the data-theme attribute pick one, so it shows the right glyph before React knows the theme.
 */

const LABEL: Record<ThemePreference, string> = { system: 'System', light: 'Light', dark: 'Dark' };

export function ThemeToggle({ className }: { className?: string }): JSX.Element {
  const { setTheme } = useSettings();
  const resolved = useResolvedTheme();
  const next = resolved === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={resolved === null ? 'Switch theme' : `Switch to the ${next} theme`}
      title={resolved === null ? 'Switch theme' : `Switch to the ${next} theme`}
      className={cx(
        'inline-flex size-touch shrink-0 items-center justify-center rounded-pill text-ink-secondary transition-colors duration-fast ease-standard hover:bg-surface-muted hover:text-ink md:size-control-sm',
        className,
      )}
    >
      <NavIcon name="moon" className="[[data-theme=dark]_&]:hidden" />
      <NavIcon name="sun" className="hidden [[data-theme=dark]_&]:block" />
    </button>
  );
}

const OPTIONS = THEME_PREFERENCES.map((value) => ({ value, label: LABEL[value] }));

export function ThemeChoice({ className, legendHidden = false }: { className?: string; legendHidden?: boolean }): JSX.Element {
  const { theme, setTheme } = useSettings();
  return (
    <SegmentedControl
      legend="Theme"
      legendHidden={legendHidden}
      options={OPTIONS}
      value={theme}
      onChange={setTheme}
      hint="System follows your device's light or dark setting."
      className={className}
    />
  );
}
