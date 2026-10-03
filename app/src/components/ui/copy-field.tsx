'use client';

import { useEffect, useId, useState, useSyncExternalStore, type JSX, type ReactNode } from 'react';

import { IconButton } from './button';
import { cx } from './cx';

/**
 * Copy and share for machine values (docs/DESIGN.md 12.4 and 12.7). Feedback stays at the button: the icon turns
 * into a check and a polite live region beside it says "Copied". That works inside a sheet or dialog, where a
 * toast would sit behind the modal layer, and on public pages that have no toast provider. The value itself
 * always stays on screen as text, so a failed copy can be done by hand.
 */

const COPIED_MS = 2_000;
const FAILED_MS = 6_000;

type Feedback = { kind: 'copied' } | { kind: 'failed' };

async function writeClipboard(value: string): Promise<void> {
  if (typeof navigator === 'undefined' || navigator.clipboard === undefined) {
    throw new Error('The clipboard is not available on this page');
  }
  await navigator.clipboard.writeText(value);
}

export interface CopyButtonProps {
  value: string;
  /** Names what is copied, as the button's accessible name: "Copy payment address". */
  label: string;
  className?: string;
}

export function CopyButton({ value, label, className }: CopyButtonProps): JSX.Element {
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  // The confirmation is a timer, an external system: it clears itself and is cancelled on unmount or a new copy.
  useEffect(() => {
    if (feedback === null) return;
    const timer = window.setTimeout(() => setFeedback(null), feedback.kind === 'copied' ? COPIED_MS : FAILED_MS);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  async function copy() {
    try {
      await writeClipboard(value);
      setFeedback({ kind: 'copied' });
    } catch {
      setFeedback({ kind: 'failed' });
    }
  }

  // A copy turns the icon into a check for two seconds and is announced; only a failure needs visible words.
  return (
    <span className={cx('inline-flex items-center gap-1', className)}>
      <IconButton icon={feedback?.kind === 'copied' ? 'check' : 'copy'} label={label} onClick={copy} />
      <span role="status" className={feedback?.kind === 'failed' ? 'text-body-s text-danger' : 'sr-only'}>
        {feedback === null ? '' : feedback.kind === 'copied' ? 'Copied' : 'Copy failed. Select the text and copy it.'}
      </span>
    </span>
  );
}

function subscribeToNothing(): () => void {
  return () => undefined;
}

/** navigator.share exists only in the browser; the server snapshot says no, so hydration never mismatches. */
function useCanShare(): boolean {
  return useSyncExternalStore(
    subscribeToNothing,
    () => typeof navigator !== 'undefined' && typeof navigator.share === 'function',
    () => false,
  );
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export interface ShareButtonProps {
  /** The text handed to the system share sheet, such as the full payment address. */
  text: string;
  /** The sheet's title. */
  title?: string;
  /** Accessible name: "Share payment address". */
  label: string;
  className?: string;
}

/** Opens the system share sheet. Renders nothing where the browser has none. */
export function ShareButton({ text, title, label, className }: ShareButtonProps): JSX.Element | null {
  const canShare = useCanShare();
  const [failed, setFailed] = useState(false);
  if (!canShare) return null;

  async function share() {
    setFailed(false);
    try {
      await navigator.share({ title, text });
    } catch (error) {
      // Closing the share sheet rejects with AbortError. That is the person's choice, not a failure.
      if (!isAbort(error)) setFailed(true);
    }
  }

  return (
    <span className={cx('inline-flex items-center gap-1', className)}>
      <IconButton icon="share" label={label} onClick={share} />
      <span role="status" className="text-body-s text-danger">
        {failed ? 'Sharing failed. Copy it instead.' : ''}
      </span>
    </span>
  );
}

export interface CopyFieldProps {
  label: ReactNode;
  value: string;
  /** Accessible name of the copy button: "Copy payment address". */
  copyLabel: string;
  /** More buttons after copy, such as a ShareButton. */
  actions?: ReactNode;
  hint?: ReactNode;
  /** md sets text-mono (13 px) for the payment address; sm sets text-mono-s for hashes. */
  size?: 'md' | 'sm';
  className?: string;
}

/**
 * A machine value shown in full, in mono, wrapping anywhere, with a copy button. The receive screen shows all 42
 * characters of the payment address this way, never only as a QR code (12.7).
 */
export function CopyField({ label, value, copyLabel, actions, hint, size = 'md', className }: CopyFieldProps): JSX.Element {
  const labelId = useId();
  return (
    <div role="group" aria-labelledby={labelId} className={cx('min-w-0', className)}>
      <div id={labelId} className="mb-2 text-body-s font-semibold text-ink">
        {label}
      </div>
      <div className="flex items-start gap-1 rounded-control border border-border bg-surface-muted py-0.5 pl-3.5 pr-0.5">
        <p className={cx('min-w-0 flex-1 break-all py-2.5 font-mono text-ink', size === 'md' ? 'text-mono' : 'text-mono-s')}>{value}</p>
        <div className="flex shrink-0 flex-wrap items-center justify-end">
          <CopyButton value={value} label={copyLabel} />
          {actions}
        </div>
      </div>
      {hint === undefined ? null : <div className="mt-2 text-body-s text-ink-muted">{hint}</div>}
    </div>
  );
}
