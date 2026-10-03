'use client';

import type { JSX, ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { ErrorBlock } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icons';
import { DATA_SOURCE } from '@/data/source';
import type { SignerKind } from '@/data/types';
import { signerApprovalLine } from '@/lib/signer';

export interface OwnerOpDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** What moves or changes, and that the money stays in the account. */
  description: ReactNode;
  /** The change itself, such as the rule's old and new values. */
  children?: ReactNode;
  signer: SignerKind;
  confirmLabel: string;
  busyLabel: string;
  busy: boolean;
  onConfirm: () => void;
  /** Set when the last attempt failed: what failed, in plain words. */
  error?: ReactNode;
  errorTitle?: string;
}

/**
 * Every rule change is an owner op the owner signs (I14): this dialog says what changes, who signs it and how, then
 * runs it. A passkey signs only on Sleeve's site; a wallet signs a long code that stands for the action. On sample
 * data it says nothing reaches Robinhood Chain.
 */
export function OwnerOpDialog({
  open,
  onClose,
  title,
  description,
  children,
  signer,
  confirmLabel,
  busyLabel,
  busy,
  onConfirm,
  error,
  errorTitle = 'The change did not go through',
}: OwnerOpDialogProps): JSX.Element {
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
          <Button onClick={onConfirm} busy={busy} busyLabel={busyLabel} icon={signer === 'passkey' ? 'key' : 'wallet'}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
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
