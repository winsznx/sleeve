'use client';

import { useId, useRef, useState, type JSX, type KeyboardEvent, type ReactNode } from 'react';

import { cx } from './cx';

/**
 * Tabs switch sections of one page (docs/DESIGN.md 11.5): the WAI-ARIA tabs pattern with automatic activation.
 * Arrow keys move between tabs and select, Home and End jump to the ends, and only the selected tab is in the
 * tab order. Four tabs at most on a phone; beyond that use a Select.
 */

export interface TabItem<T extends string = string> {
  id: T;
  label: ReactNode;
  /** A count beside the label, such as receipts waiting. */
  badge?: ReactNode;
  panel: ReactNode;
}

export interface TabsProps<T extends string = string> {
  /** Names the tab list for screen readers. */
  label: string;
  items: readonly TabItem<T>[];
  /** Controlled selection. Leave it out and pass defaultValue to let Tabs keep its own. */
  value?: T;
  defaultValue?: T;
  onValueChange?: (id: T) => void;
  className?: string;
}

export function Tabs<T extends string = string>({
  label,
  items,
  value,
  defaultValue,
  onValueChange,
  className,
}: TabsProps<T>): JSX.Element {
  const baseId = useId();
  const [ownValue, setOwnValue] = useState<T | undefined>(defaultValue);
  const tabRefs = useRef(new Map<T, HTMLButtonElement>());
  const firstId = items[0]?.id;
  const requested = value ?? ownValue;
  const selected = items.some((item) => item.id === requested) ? requested : firstId;

  function select(id: T) {
    if (value === undefined) setOwnValue(id);
    onValueChange?.(id);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = items.length - 1;
    const target =
      event.key === 'ArrowRight'
        ? (index + 1) % items.length
        : event.key === 'ArrowLeft'
          ? (index - 1 + items.length) % items.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (target === null) return;
    event.preventDefault();
    const next = items[target];
    if (next === undefined) return;
    select(next.id);
    tabRefs.current.get(next.id)?.focus();
  }

  return (
    <div className={cx('min-w-0', className)}>
      <div role="tablist" aria-label={label} className="flex gap-5 border-b border-border">
        {items.map((item, index) => {
          const isSelected = item.id === selected;
          return (
            <button
              key={item.id}
              ref={(node) => {
                if (node === null) tabRefs.current.delete(item.id);
                else tabRefs.current.set(item.id, node);
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${item.id}`}
              aria-selected={isSelected}
              aria-controls={`${baseId}-panel-${item.id}`}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => select(item.id)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              className={cx(
                '-mb-px inline-flex min-h-touch items-center gap-2 border-b-2 text-body-s transition-colors duration-fast ease-standard',
                isSelected ? 'border-brand font-semibold text-ink' : 'border-transparent font-medium text-ink-secondary hover:text-ink',
              )}
            >
              {item.label}
              {item.badge}
            </button>
          );
        })}
      </div>
      {items.map((item) => (
        <div
          key={item.id}
          role="tabpanel"
          id={`${baseId}-panel-${item.id}`}
          aria-labelledby={`${baseId}-tab-${item.id}`}
          tabIndex={0}
          hidden={item.id !== selected}
          className="pt-4 focus-visible:outline-offset-4"
        >
          {item.panel}
        </div>
      ))}
    </div>
  );
}
