'use client';

import { formatBps } from '@sleeve/core';
import { useId, type ChangeEvent, type ComponentPropsWithRef, type JSX, type ReactNode } from 'react';

import { cx } from './cx';

/** Basis points as a percent with two places, so the readout keeps its width while the thumb moves. */
export function formatBpsValue(bps: number): string {
  return formatBps(bps, { minFractionDigits: 2 });
}

export interface SliderProps
  extends Omit<
    ComponentPropsWithRef<'input'>,
    'type' | 'value' | 'defaultValue' | 'onChange' | 'min' | 'max' | 'step' | 'size' | 'children'
  > {
  label: ReactNode;
  value: number;
  onValueChange: (value: number) => void;
  min: number;
  max: number;
  /** Default 1. */
  step?: number;
  /** How the value reads on screen and to a screen reader. Default: basis points as a percent. */
  formatValue?: (value: number) => string;
  hint?: ReactNode;
}

/**
 * A native range input: arrow keys, Page Up, Page Down, Home and End come from the browser, and the green comes
 * from accent-color in tokens.css. The current value sits beside the label and is the input's aria-valuetext,
 * so it is announced once. The input is 44 px tall so the thumb is easy to hit.
 */
export function Slider({
  label,
  value,
  onValueChange,
  min,
  max,
  step = 1,
  formatValue = formatBpsValue,
  hint,
  id,
  className,
  ...rest
}: SliderProps): JSX.Element {
  const generated = useId();
  const inputId = id ?? generated;
  const hintId = `${inputId}-hint`;
  const shown = formatValue(value);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    onValueChange(Number(event.target.value));
  }

  return (
    <div className={cx('flex min-w-0 flex-col', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={inputId} className="text-body-s font-semibold text-ink">
          {label}
        </label>
        <span aria-hidden="true" className="text-body font-semibold tabular-nums text-ink">
          {shown}
        </span>
      </div>
      <input
        {...rest}
        id={inputId}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={handleChange}
        aria-valuetext={shown}
        aria-describedby={hint === undefined ? rest['aria-describedby'] : hintId}
        className="h-touch w-full cursor-pointer disabled:cursor-not-allowed disabled:opacity-disabled"
      />
      <div aria-hidden="true" className="flex justify-between text-body-s tabular-nums text-ink-muted">
        <span>{formatValue(min)}</span>
        <span>{formatValue(max)}</span>
      </div>
      {hint === undefined ? null : (
        <div id={hintId} className="mt-2 text-body-s text-ink-muted">
          {hint}
        </div>
      )}
    </div>
  );
}
