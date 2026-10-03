'use client';

import Form from 'next/form';
import { useId, type JSX } from 'react';

import { buttonClasses } from '@/components/ui/button-styles';
import { cx } from '@/components/ui/cx';

import { VERIFY_PATH } from './site-map';

/**
 * Check a split from the menu: the receipt number goes to the verify page as ?id=, which opens that receipt's check.
 * A plain GET form, so it works before the page's script has loaded; next/form makes it a client navigation after.
 */
export function SplitCheckForm({ className }: { className?: string }): JSX.Element {
  const inputId = useId();
  const hintId = useId();
  return (
    <Form action={VERIFY_PATH} className={cx('min-w-0', className)}>
      <label htmlFor={inputId} className="block text-body-s font-semibold text-ink">
        Receipt number
      </label>
      <p id={hintId} className="mt-1 text-body-s text-ink-secondary">
        Every buy, wait and release has one. The check reads the chain again and recomputes it.
      </p>
      <div className="mt-2.5 flex gap-2">
        <input
          id={inputId}
          name="id"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          required
          placeholder="455"
          aria-describedby={hintId}
          className="min-h-control-lg w-full min-w-0 rounded-control border border-border-control bg-surface px-3.5 font-mono text-input text-ink placeholder:text-ink-muted hover:border-ink-secondary"
        />
        <button type="submit" className={buttonClasses({ variant: 'secondary', size: 'lg', className: 'shrink-0' })}>
          Check
        </button>
      </div>
    </Form>
  );
}
