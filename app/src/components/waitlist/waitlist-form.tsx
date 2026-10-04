'use client';

import { useState, type FormEvent, type JSX } from 'react';

import { START_HREF } from '@/components/landing/copy';
import { Button, ButtonLink } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { PAID_WITH, WAITLIST_TRAP_FIELD, normalizeEmail, waitlistSource } from '@/lib/waitlist';

const EMAIL_ERROR = 'Enter an email address like you@example.com.';

type Phase =
  | { kind: 'editing' }
  | { kind: 'sending' }
  | { kind: 'joined'; email: string }
  | { kind: 'failed'; error: string };

/**
 * The waitlist form (D-038): an email, one optional question, and a honeypot field people never see. Where the form
 * was opened from comes from the page's `from` query, so the footer link can be told apart from a shared link.
 */
export function WaitlistForm(): JSX.Element {
  const [email, setEmail] = useState('');
  const [paidWith, setPaidWith] = useState('');
  const [emailError, setEmailError] = useState<string | undefined>();
  const [phase, setPhase] = useState<Phase>({ kind: 'editing' });

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const normalized = normalizeEmail(email);
    if (normalized === null) {
      setEmailError(EMAIL_ERROR);
      return;
    }
    setEmailError(undefined);
    const trap = new FormData(event.currentTarget).get(WAITLIST_TRAP_FIELD);
    setPhase({ kind: 'sending' });
    try {
      const response = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: normalized,
          paidWith,
          source: waitlistSource(new URLSearchParams(window.location.search).get('from')),
          [WAITLIST_TRAP_FIELD]: typeof trap === 'string' ? trap : '',
        }),
      });
      if (response.ok) {
        setPhase({ kind: 'joined', email: normalized });
        return;
      }
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setPhase({ kind: 'failed', error: body?.error ?? 'We could not save that. Try again in a minute.' });
    } catch {
      setPhase({ kind: 'failed', error: 'We could not reach Sleeve. Check your connection and try again.' });
    }
  }

  if (phase.kind === 'joined') {
    return (
      <div role="status" className="flex flex-col items-start gap-3">
        <p className="text-h3 text-ink">You are on the list</p>
        <p className="text-body text-ink-secondary">
          We will write to <span className="font-semibold text-ink">{phase.email}</span> when Sleeve has news worth your time.
        </p>
        <ButtonLink href={START_HREF} className="mt-2">
          Get your payment address now
        </ButtonLink>
      </div>
    );
  }

  const sending = phase.kind === 'sending';
  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-5">
      <Input
        label="Email"
        type="email"
        name="email"
        autoComplete="email"
        inputMode="email"
        placeholder="you@example.com"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        error={emailError}
      />
      <Select
        label="How are you paid today?"
        hint="Optional. It tells us who to build for first."
        name="paidWith"
        value={paidWith}
        onChange={(event) => setPaidWith(event.target.value)}
      >
        <option value="">Choose one</option>
        {PAID_WITH.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
      <div aria-hidden="true" className="sr-only">
        <label>
          Company
          <input type="text" name={WAITLIST_TRAP_FIELD} tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>
      {phase.kind === 'failed' ? (
        <p role="alert" className="text-body-s text-danger">
          {phase.error}
        </p>
      ) : null}
      <Button type="submit" busy={sending} busyLabel="Joining" className="self-start">
        Join the waitlist
      </Button>
    </form>
  );
}
