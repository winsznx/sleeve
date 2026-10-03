'use client';

import { useId, type JSX, type ReactNode } from 'react';

import { cx } from '@/components/ui/cx';

/**
 * One on or off preference: its name and what it does on the left, a switch on the right (WAI-ARIA switch). On is the
 * black pill, as every selected state is (docs/DESIGN.md 11.5); off keeps a 3 to 1 outline. The whole row is at least
 * 44 px tall and the label toggles it too.
 */

export interface SettingSwitchProps {
  label: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}

export function SettingSwitch({ label, description, checked, onChange, className }: SettingSwitchProps): JSX.Element {
  const id = useId();
  const labelId = `${id}-label`;
  const descriptionId = `${id}-description`;
  return (
    <div className={cx('flex min-h-touch items-start justify-between gap-4 py-3', className)}>
      <div className="min-w-0 flex-1">
        <label id={labelId} htmlFor={id} className="block cursor-pointer text-body font-medium text-ink">
          {label}
        </label>
        {description === undefined ? null : (
          <p id={descriptionId} className="mt-0.5 text-body-s text-ink-secondary">
            {description}
          </p>
        )}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={description === undefined ? undefined : descriptionId}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative mt-0.5 inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-pill border p-0.5 transition-colors duration-fast ease-standard',
          checked ? 'border-brand bg-brand' : 'border-border-control bg-surface',
        )}
      >
        <span
          aria-hidden="true"
          className={cx(
            'size-5 rounded-pill transition-transform duration-fast ease-standard motion-reduce:transition-none',
            checked ? 'translate-x-5 bg-on-brand' : 'translate-x-0 bg-ink-muted',
          )}
        />
      </button>
    </div>
  );
}
