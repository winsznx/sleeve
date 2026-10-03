'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, useTransition, type FormEvent, type JSX } from 'react';

import { Button } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { Icon } from '@/components/ui/icons';

import { readReceiptIdInput } from './receipt-id-input';

export const NOT_A_RECEIPT_NUMBER = 'Enter a receipt number in digits, such as 455.';

export interface VerifyFormProps {
  /** What was submitted without JavaScript, shown again so it can be fixed. */
  defaultValue: string;
  /** The server already read the submitted value and it was not a receipt number. */
  invalid: boolean;
}

/**
 * The verifier's entry: a receipt number in, the field by field recomputation out. It is a plain GET form, so it
 * works before JavaScript loads (the page redirects /verify?id=455 to /verify/455); with JavaScript it checks the
 * number in place and goes straight to the result. The number is a machine value, so it is set in mono. It is the
 * same number every action carries in the history and on its details page.
 */
export function VerifyForm({ defaultValue, invalid }: VerifyFormProps): JSX.Element {
  const router = useRouter();
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  const [value, setValue] = useState(defaultValue);
  const [error, setError] = useState<string | undefined>(invalid ? NOT_A_RECEIPT_NUMBER : undefined);
  const [opening, startOpening] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = readReceiptIdInput(value);
    if (id === null) {
      setError(NOT_A_RECEIPT_NUMBER);
      return;
    }
    startOpening(() => router.push(`/verify/${id}`));
  }

  return (
    <form action="/verify" method="get" noValidate onSubmit={submit} className="flex flex-col">
      <label htmlFor={inputId} className="text-body-s font-semibold text-ink">
        Receipt number
      </label>
      <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-stretch">
        <div
          className={cx(
            'flex min-h-control-lg min-w-0 flex-1 items-center rounded-pill border bg-surface transition-colors duration-fast ease-standard has-[input:focus-visible]:outline has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-focus',
            error === undefined ? 'border-border-control hover:border-ink-secondary' : 'border-danger',
          )}
        >
          <span aria-hidden="true" className="pl-5 font-mono text-input text-ink-muted">
            #
          </span>
          <input
            id={inputId}
            name="id"
            inputMode="numeric"
            autoComplete="off"
            enterKeyHint="go"
            spellCheck={false}
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setError(undefined);
            }}
            aria-invalid={error === undefined ? undefined : true}
            aria-describedby={cx(hintId, error !== undefined && errorId)}
            className="min-h-control-lg w-0 min-w-0 flex-1 bg-transparent pl-1.5 pr-5 font-mono text-input tabular-nums text-ink placeholder:font-sans placeholder:text-ink-muted focus-visible:outline-none"
          />
        </div>
        <Button type="submit" size="lg" busy={opening} busyLabel="Checking">
          Check it
        </Button>
      </div>
      <p id={hintId} className="mt-2 text-body-s text-ink-muted">
        It is the number beside every action in your history, and on a payday card shared with proof.
      </p>
      {error === undefined ? null : (
        <p id={errorId} className="mt-2 flex items-start gap-1.5 text-body-s text-danger">
          <Icon name="alert" className="mt-0.5 size-4" />
          {error}
        </p>
      )}
    </form>
  );
}
