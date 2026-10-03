'use client';

import { CHAIN_ID, CHAIN_NAME, formatBps, TOTAL_BPS, type Address, type Rule } from '@sleeve/core';
import { createContext, useCallback, useContext, useState, type JSX, type ReactNode } from 'react';

import { tickerSymbol } from '@/components/sleeve/text';
import { TokenIcon } from '@/components/token/token-icon';
import { CopyField, ShareButton } from '@/components/ui/copy-field';
import { cx } from '@/components/ui/cx';
import { Dialog } from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icons';
import { QRCode } from '@/components/ui/qr-code';
import { useRule } from '@/data/hooks';

/**
 * Receive: the payment address, in full, with its QR code, copy and share (docs/DESIGN.md 12.7). One dialog for the
 * shell; the rail's black pill, the top bar and the account menu all open it.
 */

const ReceiveContext = createContext<(() => void) | null>(null);

/** Opens the Receive dialog, or null outside the shell or with nobody signed in. */
export function useOpenReceive(): (() => void) | null {
  return useContext(ReceiveContext);
}

export function ReceiveProvider({ account, children }: { account: Address | null; children: ReactNode }): JSX.Element {
  const [open, setOpen] = useState(false);
  const openReceive = useCallback(() => setOpen(true), []);
  return (
    <ReceiveContext.Provider value={account === null ? null : openReceive}>
      {children}
      {account === null ? null : <ReceiveDialog account={account} open={open} onClose={() => setOpen(false)} />}
    </ReceiveContext.Provider>
  );
}

/** What the rule does with a payment, as the dialog's lead: the split is why the address exists (D-024). */
export function ruleLead(rule: Rule | undefined): string {
  if (rule === undefined) return `Payers send USDG on ${CHAIN_NAME} to this address.`;
  if (rule.status === 'NONE') return 'You have no rule yet, so every payment stays spendable USDG until you set one.';
  if (rule.status === 'PAUSED') return 'Your rule is paused, so new payments stay unsorted and spendable until you resume it.';
  const spend = formatBps(TOTAL_BPS - rule.equityBps);
  return `Your rule splits every payment: ${spend} stays spendable USDG and ${formatBps(rule.equityBps)} buys ${tickerSymbol(rule.tickerId)}.`;
}

function ReceiveDialog({ account, open, onClose }: { account: Address; open: boolean; onClose: () => void }): JSX.Element {
  const rule = useRule(account);
  return (
    <Dialog open={open} onClose={onClose} title="Receive USDG" description={ruleLead(rule.data)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <QRCode
          value={account}
          label="QR code of your payment address"
          className="size-40 shrink-0 self-center border border-border sm:self-start"
        />
        <div className="min-w-0 flex-1">
          <CopyField
            label={
              <span className="inline-flex items-center gap-2">
                <TokenIcon token="USDG" size="xs" decorative />
                Payment address
              </span>
            }
            value={account}
            copyLabel="Copy payment address"
            actions={<ShareButton text={account} title="Sleeve payment address" label="Share payment address" />}
          />
          <p className="mt-2 text-body-s text-ink-secondary">
            Send USDG only, on {CHAIN_NAME}, chain id {CHAIN_ID}.
          </p>
        </div>
      </div>
      <p className="mt-4 flex gap-2.5 rounded-row border border-accent-border bg-info-soft p-3.5 text-body-s text-ink-secondary">
        <Icon name="info" className="mt-0.5 size-4 shrink-0 text-info" />
        <span>Only USDG that arrives from another account splits. Moving USDG in from inside Sleeve does not.</span>
      </p>
    </Dialog>
  );
}

const LOOK = {
  /** The rail's one action, closeout's black create pill. */
  rail: 'min-h-control w-full justify-center bg-brand px-5 text-body-s text-on-brand hover:bg-brand-strong',
  /** The top bar's bordered chip: a label from 1280 px, the icon alone below. */
  bar: 'min-h-touch min-w-touch justify-center border border-border-strong bg-surface px-2.5 text-body-s text-ink hover:bg-surface-muted md:min-h-control-sm md:min-w-0 xl:px-3.5',
  /** A row in a menu or sheet. */
  menu: 'min-h-control justify-center whitespace-nowrap border border-border-strong bg-surface px-4 text-body text-ink hover:bg-surface-muted',
} as const;

export interface ReceiveButtonProps {
  look: keyof typeof LOOK;
  /** Runs as the dialog opens, such as closing the menu the button sits in. */
  onOpen?: () => void;
  className?: string;
}

export function ReceiveButton({ look, onOpen, className }: ReceiveButtonProps): JSX.Element | null {
  const openReceive = useOpenReceive();
  if (openReceive === null) return null;
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      onClick={() => {
        onOpen?.();
        openReceive();
      }}
      aria-label={look === 'bar' ? 'Receive USDG' : undefined}
      className={cx(
        'inline-flex shrink-0 items-center gap-2 rounded-pill font-medium transition-colors duration-fast ease-standard',
        LOOK[look],
        className,
      )}
    >
      <Icon name="receive" className={look === 'bar' ? 'size-[1.125rem]' : 'size-icon'} />
      <span className={look === 'bar' ? 'hidden xl:inline' : undefined}>{look === 'bar' ? 'Receive' : 'Receive USDG'}</span>
    </button>
  );
}
