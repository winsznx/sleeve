'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent, type JSX } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';

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
 * number in place and goes straight to the result.
 */
export function VerifyForm({ defaultValue, invalid }: VerifyFormProps): JSX.Element {
  const router = useRouter();
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
    <form action="/verify" method="get" noValidate onSubmit={submit} className="flex flex-col gap-4">
      <Input
        name="id"
        label="Receipt number"
        inputMode="numeric"
        autoComplete="off"
        enterKeyHint="go"
        spellCheck={false}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setError(undefined);
        }}
        error={error}
        hint="It is on every receipt, and on a card shared with proof."
      />
      <Button type="submit" size="lg" busy={opening} busyLabel="Opening" className="md:self-start">
        Recompute the receipt
      </Button>
    </form>
  );
}
