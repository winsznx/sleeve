'use client';

import { useState, type JSX, type ReactNode } from 'react';

import { Button, type ButtonVariant } from '@/components/ui/button';
import { ErrorBlock } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icons';
import { useActionPreview, useSession } from '@/data/hooks';
import { DATA_SOURCE } from '@/data/source';
import type { OwnerAction } from '@/data/types';
import { useSettings } from '@/lib/settings';
import { signerApprovalLine, signerKindOf } from '@/lib/signer';

import { TransactionPreview, TransactionPreviewSkeleton } from './transaction-preview';

export interface ActionDialogProps {
  open: boolean;
  onClose: () => void;
  /** The action the owner is about to sign. Its preview loads while the dialog is open and previews are on. */
  action: OwnerAction | null;
  title: string;
  /** What moves or changes, and that the money stays in the account. */
  description: ReactNode;
  /** Shown above the preview. */
  children?: ReactNode;
  /** Shown only while previews are off: the short form of what the preview would say, such as a rule's changes. */
  fallback?: ReactNode;
  confirmLabel: string;
  /** destructive for an action that removes something, such as removing Sleeve (docs/DESIGN.md 11.1). */
  confirmVariant?: Extract<ButtonVariant, 'primary' | 'destructive'>;
  busyLabel: string;
  busy: boolean;
  onConfirm: () => void;
  /** Set when the last attempt failed: what failed, in plain words. */
  error?: ReactNode;
  errorTitle?: string;
}

/**
 * The confirmation every owner action passes through (I14): what it does, the transaction preview while previews are
 * on (D-029), who signs and how, then the action. Whether to preview is read when the dialog opens, so turning
 * previews off from inside it keeps this preview on screen. Confirm waits for the preview, and stays off when the
 * preview says the action would not go through.
 */
export function ActionDialog({
  open,
  onClose,
  action,
  title,
  description,
  children,
  fallback,
  confirmLabel,
  confirmVariant = 'primary',
  busyLabel,
  busy,
  onConfirm,
  error,
  errorTitle = 'It did not go through',
}: ActionDialogProps): JSX.Element {
  const settings = useSettings();
  const session = useSession();
  const signer = signerKindOf(session.data);
  const [wasOpen, setWasOpen] = useState(open);
  const [withPreview, setWithPreview] = useState(settings.previewsEnabled);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setWithPreview(settings.previewsEnabled);
  }

  const preview = useActionPreview(open && withPreview ? action : null);
  const waiting = withPreview && action !== null && preview.isPending;
  const blocked = withPreview && preview.data !== undefined && preview.data.blocked !== null;

  let previewBlock: ReactNode = null;
  if (withPreview && action !== null) {
    if (preview.data !== undefined) previewBlock = <TransactionPreview preview={preview.data} />;
    else if (preview.isError) {
      previewBlock = (
        <ErrorBlock
          title="The preview did not load"
          action={
            <Button variant="secondary" size="sm" onClick={() => void preview.refetch()} busy={preview.isFetching} busyLabel="Reading">
              Try again
            </Button>
          }
        >
          Sleeve could not read what this would do. You can still approve it. The module checks everything again when it runs.
        </ErrorBlock>
      );
    } else previewBlock = <TransactionPreviewSkeleton />;
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      title={title}
      description={description}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={confirmVariant}
            onClick={onConfirm}
            busy={busy}
            busyLabel={busyLabel}
            disabled={waiting || blocked}
            icon={signer === 'passkey' ? 'key' : 'wallet'}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
      {withPreview ? null : fallback}
      {previewBlock === null ? null : <div className={children === undefined || children === null ? undefined : 'mt-4'}>{previewBlock}</div>}
      <p className="mt-4 flex gap-2.5 rounded-row border border-accent-border bg-info-soft p-3.5 text-body-s text-ink-secondary">
        <Icon name={signer === 'passkey' ? 'key' : 'wallet'} className="mt-0.5 size-4 shrink-0 text-info" />
        <span>
          {signerApprovalLine(signer)}
          {DATA_SOURCE === 'mock' ? ' Sample data: nothing is sent to Robinhood Chain.' : ''}
        </span>
      </p>
      {error === undefined || error === null ? null : (
        <ErrorBlock title={errorTitle} fundsStillHere className="mt-4">
          {error}
        </ErrorBlock>
      )}
    </Dialog>
  );
}

/**
 * For an action that used to run on one press: with previews on, the press opens an ActionDialog for it, and
 * Confirm runs it; with previews off, the press runs it at once, as before.
 */
export interface ActionGate {
  open: boolean;
  action: OwnerAction | null;
  /** Ask for an action. `run` starts the write; it runs now when previews are off. */
  start: (action: OwnerAction, run: () => void) => void;
  confirm: () => void;
  close: () => void;
}

export function useActionGate(): ActionGate {
  const { previewsEnabled } = useSettings();
  const [pending, setPending] = useState<{ action: OwnerAction; run: () => void } | null>(null);
  const [open, setOpen] = useState(false);
  return {
    open,
    action: pending?.action ?? null,
    start(action, run) {
      if (!previewsEnabled) {
        run();
        return;
      }
      setPending({ action, run });
      setOpen(true);
    },
    confirm() {
      pending?.run();
    },
    close() {
      setOpen(false);
    },
  };
}
