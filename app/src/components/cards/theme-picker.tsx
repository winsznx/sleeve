'use client';

import { useId, type CSSProperties, type JSX } from 'react';

import { cx } from '@/components/ui/cx';

import { CARD_COLOR_TOKENS, CARD_LAYER_TOKENS } from './card-palette';
import { CARD_THEMES, CARD_THEME_LOOKS, type CardBackground, type CardTheme } from './card-themes';

/** A background straight from the tokens the colorway uses. */
function paint(background: CardBackground): CSSProperties {
  if ('color' in background) return { backgroundColor: `var(${CARD_COLOR_TOKENS[background.color]})` };
  return { backgroundImage: `var(${CARD_LAYER_TOKENS[background.layers]})` };
}

export interface ThemePickerProps {
  value: CardTheme;
  onChange: (theme: CardTheme) => void;
  className?: string;
}

/**
 * The colorway, as a row of small tickets drawn in each colorway's own tokens (Spotify's swatches above the share
 * card). Native radio inputs give the group its semantics and arrow-key movement; the name is always visible, so
 * color never works alone.
 */
export function ThemePicker({ value, onChange, className }: ThemePickerProps): JSX.Element {
  const name = useId();
  return (
    <fieldset className={cx('min-w-0', className)}>
      <legend className="mb-2 text-body-s font-semibold text-ink">Look</legend>
      <div className="grid grid-cols-4 gap-2.5">
        {CARD_THEMES.map((theme) => {
          const look = CARD_THEME_LOOKS[theme];
          const checked = theme === value;
          const edge = look.ticketEdge === null ? undefined : `1px solid var(${CARD_COLOR_TOKENS[look.ticketEdge]})`;
          return (
            <div key={theme} className="min-w-0">
              <label className="flex min-w-0 cursor-pointer flex-col items-center gap-1.5">
                <input
                  type="radio"
                  name={name}
                  value={theme}
                  checked={checked}
                  onChange={() => onChange(theme)}
                  aria-describedby={`${name}-${theme}`}
                  className="peer sr-only"
                />
                <span
                  aria-hidden="true"
                  style={paint(look.backdrop)}
                  className={cx(
                    'flex h-16 w-full items-center justify-center overflow-hidden rounded-row border transition-shadow duration-fast ease-standard',
                    'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus',
                    checked
                      ? 'border-brand ring-2 ring-brand ring-offset-2 ring-offset-surface'
                      : 'border-border-strong hover:border-ink-muted',
                  )}
                >
                  <span
                    style={{ border: edge }}
                    className={cx('flex h-11 w-3/5 flex-col overflow-hidden rounded-[7px] bg-surface', look.ticketShadow && 'shadow-soft')}
                  >
                    <span style={paint(look.face)} className="flex flex-1 items-start px-1 pt-1">
                      <span className="flex h-1 w-2.5 gap-px">
                        <span className="h-full w-2/3 rounded-pill bg-spend" />
                        <span
                          className="h-full w-1/3 rounded-pill"
                          style={{ backgroundColor: `var(${CARD_COLOR_TOKENS[look.markEquity]})` }}
                        />
                      </span>
                    </span>
                    <span className="h-2.5 border-t border-dashed border-border-strong bg-surface" />
                    <span className="flex h-1.5 gap-px bg-surface">
                      <span className="h-full w-4/5 bg-spend" />
                      <span className="h-full flex-1 bg-equity" />
                    </span>
                  </span>
                </span>
                <span className={cx('text-label', checked ? 'font-semibold text-ink' : 'font-medium text-ink-secondary')}>
                  {look.label}
                </span>
              </label>
              <span id={`${name}-${theme}`} className="sr-only">
                {look.description}
              </span>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
