'use client';

import { shortAddress, type Address } from '@sleeve/core';
import { useId, useState, type JSX } from 'react';
import { flushSync } from 'react-dom';

import { Button } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { Icon } from '@/components/ui/icons';
import { useAttachWallet } from '@/data/hooks';

import { ConnectClosedError } from './connect-flow';
import { useWalletLayer } from './wallet-layer';
import { walletConnectFailureText } from './wallet-problems';

export interface ConnectToSignProps {
  /** The wallet that owns the signed-in account. */
  owner: Address;
  /**
   * For a step inside a modal dialog: true right before RainbowKit's connect modal opens, which a dialog in the top
   * layer would cover, and false once connecting settles. The dialog closes while it is true and then comes back.
   */
  onStepAside?: (aside: boolean) => void;
  className?: string;
}

/**
 * The step before a wallet session's first signature in a tab (D-041). A session read back from storage holds no
 * signer, so the owner connects the wallet here, Sleeve checks it is the account's owner, and the action continues to
 * its signature. The wallet code loads only on this press.
 */
export function ConnectToSign({ owner, onStepAside, className }: ConnectToSignProps): JSX.Element {
  const walletLayer = useWalletLayer();
  const attach = useAttachWallet();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ error: unknown } | null>(null);
  const titleId = useId();

  async function connect(): Promise<void> {
    setBusy(true);
    setFailure(null);
    let steppedAside = false;
    const beforeModal =
      onStepAside === undefined
        ? undefined
        : () => {
            steppedAside = true;
            // The dialog has to leave the top layer before the modal mounts, so this commits at once.
            flushSync(() => onStepAside(true));
          };
    try {
      const link = await walletLayer.load();
      const address = await link.connect({ beforeModal });
      await attach.mutateAsync(link.signerFor(address));
    } catch (error) {
      if (!(error instanceof ConnectClosedError)) setFailure({ error });
    } finally {
      if (steppedAside) onStepAside?.(false);
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby={titleId}
      className={cx('flex gap-2.5 rounded-row border border-accent-border bg-info-soft p-3.5 text-body-s', className)}
    >
      <Icon name="wallet" className="mt-0.5 size-4 shrink-0 text-info" />
      <div className="min-w-0">
        <h3 id={titleId} className="font-semibold text-ink">
          Connect your wallet to sign
        </h3>
        <p className="mt-0.5 text-ink-secondary">
          This account belongs to the wallet {shortAddress(owner)}. Connect that wallet here, then approve.
        </p>
        {failure === null ? null : (
          <p role="alert" className="mt-2 text-danger">
            {walletConnectFailureText(failure.error)}
          </p>
        )}
        <Button size="sm" icon="wallet" className="mt-3" onClick={() => void connect()} busy={busy} busyLabel="Waiting for your wallet">
          {failure === null ? 'Connect your wallet' : 'Try again'}
        </Button>
      </div>
    </section>
  );
}
