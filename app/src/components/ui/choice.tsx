'use client';

import { useId, type ButtonHTMLAttributes, type JSX, type ReactNode } from 'react';

import { cx } from './cx';

/**
 * Pills (docs/DESIGN.md 11.5). SegmentedControl is an exclusive choice, built on native radio inputs so the
 * browser supplies the radio group semantics and arrow-key movement; FilterPill is a toggle that narrows a list.
 * Both look like closeout's filter pills: white with a hairline, black when selected. They wrap, never scroll.
 */

const PILL =
  'inline-flex min-h-control-sm items-center justify-center rounded-pill border px-4 text-body-s transition-colors duration-fast ease-standard';
const PILL_OFF = 'border-border bg-surface text-ink-secondary hover:border-border-strong hover:text-ink';
const PILL_ON = 'border-brand bg-brand font-medium text-on-brand';

export interface ChoiceOption<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  /** Names the group; read before each option. */
  legend: ReactNode;
  /** Hide the legend visually when a heading next to the control already says the same thing. */
  legendHidden?: boolean;
  options: readonly ChoiceOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** One line under the pills. */
  hint?: ReactNode;
  /** Form field name. Defaults to a generated one so groups never share arrow-key movement. */
  name?: string;
  disabled?: boolean;
  className?: string;
}

export function SegmentedControl<T extends string>({
  legend,
  legendHidden = false,
  options,
  value,
  onChange,
  hint,
  name,
  disabled = false,
  className,
}: SegmentedControlProps<T>): JSX.Element {
  const generated = useId();
  const groupName = name ?? generated;
  const hintId = `${generated}-hint`;
  return (
    <fieldset
      disabled={disabled}
      aria-describedby={hint === undefined ? undefined : hintId}
      className={cx('min-w-0', className)}
    >
      <legend className={cx('mb-2 text-body-s font-semibold text-ink', legendHidden && 'sr-only')}>{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const checked = option.value === value;
          return (
            <label key={option.value} className="relative inline-flex">
              <input
                type="radio"
                name={groupName}
                value={option.value}
                checked={checked}
                disabled={option.disabled}
                onChange={() => onChange(option.value)}
                className="peer sr-only"
              />
              <span
                className={cx(
                  PILL,
                  checked ? PILL_ON : PILL_OFF,
                  'cursor-pointer peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus peer-disabled:cursor-not-allowed peer-disabled:opacity-disabled',
                )}
              >
                {option.label}
              </span>
            </label>
          );
        })}
      </div>
      {hint === undefined ? null : (
        <div id={hintId} className="mt-2 text-body-s text-ink-muted">
          {hint}
        </div>
      )}
    </fieldset>
  );
}

export interface FilterPillProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-pressed'> {
  pressed: boolean;
}

/** A toggle pill for list filters: aria-pressed, black while on. Put a row of them in a flex-wrap container. */
export function FilterPill({ pressed, className, type = 'button', children, ...rest }: FilterPillProps): JSX.Element {
  return (
    <button
      {...rest}
      type={type}
      aria-pressed={pressed}
      className={cx(PILL, pressed ? PILL_ON : PILL_OFF, 'disabled:cursor-not-allowed disabled:opacity-disabled', className)}
    >
      {children}
    </button>
  );
}
