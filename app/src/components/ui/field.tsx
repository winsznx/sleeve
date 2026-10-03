'use client';

import { useCallback, useId, useRef, type ChangeEvent, type ComponentPropsWithRef, type JSX, type ReactNode } from 'react';

import { cx } from './cx';
import { Icon } from './icons';

/**
 * Text fields, the amount field, the select and the checkbox (docs/DESIGN.md 11.2). A field is a label above, the
 * control, a hint and an error below, wired with htmlFor and aria-describedby. Every control is 16 px so iOS
 * Safari never zooms into it, and sits on canvas, surface or surface-muted, where border-control reaches 3:1.
 */

interface FieldText {
  /** Shown above the control in sentence case. */
  label: ReactNode;
  /** One line of help below the control. */
  hint?: ReactNode;
  /** What to change, in plain words. Marks the control invalid while set. */
  error?: ReactNode;
}

interface FieldIds {
  inputId: string;
  hintId: string;
  errorId: string;
}

function useFieldIds(id: string | undefined): FieldIds {
  const generated = useId();
  const inputId = id ?? generated;
  return { inputId, hintId: `${inputId}-hint`, errorId: `${inputId}-error` };
}

function describedBy(ids: FieldIds, text: FieldText, ...extra: (string | undefined)[]): string | undefined {
  const parts = [
    text.hint === undefined ? undefined : ids.hintId,
    text.error === undefined ? undefined : ids.errorId,
    ...extra,
  ].filter((part): part is string => part !== undefined && part !== '');
  return parts.length === 0 ? undefined : parts.join(' ');
}

function FieldFrame({
  ids,
  text,
  className,
  children,
}: {
  ids: FieldIds;
  text: FieldText;
  className: string | undefined;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className={cx('flex min-w-0 flex-col', className)}>
      <label htmlFor={ids.inputId} className="mb-2 text-body-s font-semibold text-ink">
        {text.label}
      </label>
      {children}
      {text.hint === undefined ? null : (
        <div id={ids.hintId} className="mt-2 text-body-s text-ink-muted">
          {text.hint}
        </div>
      )}
      {text.error === undefined ? null : (
        <div id={ids.errorId} className="mt-2 flex items-start gap-1.5 text-body-s text-danger">
          <Icon name="alert" className="mt-0.5 size-4" />
          <div className="min-w-0">{text.error}</div>
        </div>
      )}
    </div>
  );
}

const CONTROL =
  'w-full min-h-control-lg rounded-control border bg-surface text-input text-ink transition-colors duration-fast ease-standard placeholder:text-ink-muted disabled:bg-surface-muted disabled:text-ink-secondary';

function borderTone(invalid: boolean): string {
  return invalid ? 'border-danger' : 'border-border-control hover:border-ink-secondary';
}

export interface InputProps extends FieldText, Omit<ComponentPropsWithRef<'input'>, 'size'> {}

export function Input({ label, hint, error, id, className, ...rest }: InputProps): JSX.Element {
  const ids = useFieldIds(id);
  const text = { label, hint, error };
  return (
    <FieldFrame ids={ids} text={text} className={className}>
      <input
        {...rest}
        id={ids.inputId}
        aria-invalid={error === undefined ? rest['aria-invalid'] : true}
        aria-describedby={describedBy(ids, text, rest['aria-describedby'])}
        className={cx(CONTROL, 'px-3.5', borderTone(error !== undefined))}
      />
    </FieldFrame>
  );
}

/**
 * What a person typed, cleaned for an amount field, or null to refuse the keystroke. Spaces go; a comma is
 * read as the decimal point unless a point is already there, in which case commas are grouping and go too.
 * Anything else that is not a digit, a second point, or more fraction digits than the token has, refuses the
 * change, so the field never rounds or reinterprets money silently.
 */
export function sanitizeAmount(text: string, decimals: number): string | null {
  let cleaned = text.replace(/\s+/g, '');
  cleaned = cleaned.includes('.') ? cleaned.replace(/,/g, '') : cleaned.replace(/,/g, '.');
  if (!/^[0-9]*\.?[0-9]*$/.test(cleaned)) return null;
  const point = cleaned.indexOf('.');
  if (point === -1) return cleaned;
  if (decimals === 0) return null;
  return cleaned.length - point - 1 > decimals ? null : cleaned;
}

export interface AmountInputProps
  extends FieldText,
    Omit<ComponentPropsWithRef<'input'>, 'value' | 'defaultValue' | 'onChange' | 'type' | 'inputMode' | 'size'> {
  /** The text in the field. Parse it with parseUsdg or parseStockToken from @sleeve/core. */
  value: string;
  onValueChange: (value: string) => void;
  /** Shown inside the field on the right, and read out after the label: "USDG", "SPY", "%". */
  unit: string;
  /** Most digits after the point: 6 for USDG, 18 for Stock Tokens. */
  decimals: number;
}

/** 11.2 amounts: decimal keypad, tabular figures, the unit inside the field on the right. */
export function AmountInput({
  label,
  hint,
  error,
  id,
  className,
  value,
  onValueChange,
  unit,
  decimals,
  disabled,
  ref,
  ...rest
}: AmountInputProps): JSX.Element {
  const ids = useFieldIds(id);
  const unitId = `${ids.inputId}-unit`;
  const text = { label, hint, error };
  const inner = useRef<HTMLInputElement | null>(null);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const next = sanitizeAmount(event.target.value, decimals);
    if (next !== null) onValueChange(next);
  }

  // One node, two refs: the frame focuses the field on click, and the caller may hold it too.
  const attach = useCallback(
    (node: HTMLInputElement | null) => {
      inner.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  return (
    <FieldFrame ids={ids} text={text} className={className}>
      {/* A click anywhere in the frame, the unit included, lands in the field. */}
      <div
        onClick={() => inner.current?.focus()}
        className={cx(
          'flex min-h-control-lg w-full cursor-text items-center rounded-control border bg-surface transition-colors duration-fast ease-standard focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus',
          borderTone(error !== undefined),
          disabled && 'cursor-not-allowed bg-surface-muted',
        )}
      >
        <input
          {...rest}
          ref={attach}
          id={ids.inputId}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          disabled={disabled}
          value={value}
          onChange={handleChange}
          aria-invalid={error === undefined ? rest['aria-invalid'] : true}
          aria-describedby={describedBy(ids, text, unitId, rest['aria-describedby'])}
          className="min-h-control-lg min-w-0 flex-1 rounded-control bg-transparent px-3.5 text-input tabular-nums text-ink placeholder:text-ink-muted focus-visible:outline-none disabled:text-ink-secondary"
        />
        <span id={unitId} className="shrink-0 pr-3.5 text-input text-ink-secondary">
          {unit}
        </span>
      </div>
    </FieldFrame>
  );
}

export interface SelectProps extends FieldText, Omit<ComponentPropsWithRef<'select'>, 'size' | 'multiple'> {
  /** option elements. */
  children: ReactNode;
}

/** A native select with the field look and a 12 px chevron, 12 px from the right edge. */
export function Select({ label, hint, error, id, className, children, ...rest }: SelectProps): JSX.Element {
  const ids = useFieldIds(id);
  const text = { label, hint, error };
  return (
    <FieldFrame ids={ids} text={text} className={className}>
      <div className="relative">
        <select
          {...rest}
          id={ids.inputId}
          aria-invalid={error === undefined ? rest['aria-invalid'] : true}
          aria-describedby={describedBy(ids, text, rest['aria-describedby'])}
          className={cx(CONTROL, 'cursor-pointer appearance-none pl-3.5 pr-10', borderTone(error !== undefined))}
        >
          {children}
        </select>
        <Icon
          name="chevronDown"
          className="pointer-events-none absolute right-3 top-1/2 size-3 -translate-y-1/2 text-ink-secondary"
        />
      </div>
    </FieldFrame>
  );
}

export interface CheckboxProps extends Omit<ComponentPropsWithRef<'input'>, 'type' | 'size'> {
  label: ReactNode;
  /** A second line under the label, in secondary ink. */
  description?: ReactNode;
}

/**
 * A native checkbox at 20 px, green from accent-color, on a row at least 44 px tall. The label toggles it too; the
 * description sits outside the label so the checkbox's name stays the label alone and the description is read
 * once, as its description.
 */
export function Checkbox({ label, description, id, className, ...rest }: CheckboxProps): JSX.Element {
  const generated = useId();
  const inputId = id ?? generated;
  const descriptionId = `${inputId}-description`;
  return (
    <div className={cx('flex min-h-touch items-start gap-3 py-2.5', className)}>
      <input
        {...rest}
        id={inputId}
        type="checkbox"
        aria-describedby={description === undefined ? rest['aria-describedby'] : descriptionId}
        className="mt-0.5 size-5 shrink-0 cursor-pointer disabled:cursor-not-allowed"
      />
      <div className="min-w-0 flex-1">
        <label htmlFor={inputId} className="block cursor-pointer text-body text-ink">
          {label}
        </label>
        {description === undefined ? null : (
          <div id={descriptionId} className="mt-0.5 text-body-s text-ink-secondary">
            {description}
          </div>
        )}
      </div>
    </div>
  );
}
