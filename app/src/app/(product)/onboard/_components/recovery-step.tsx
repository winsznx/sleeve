'use client';

import { shortAddress, type Address } from '@sleeve/core';
import { useState, type JSX } from 'react';

import { Button } from '@/components/ui/button';
import { Banner, ErrorBlock } from '@/components/ui/card';
import { Icon } from '@/components/ui/icons';
import { ConnectWalletButton } from '@/components/wallet/connect-wallet-button';
import { useContractWalletCheck, useProveWalletKey, useWalletConnection } from '@/components/wallet/use-wallet';
import { walletProblem, walletProblemText } from '@/components/wallet/wallet-problems';
import { NO_RECOVERY_LINE, RECOVERY_WALLET_LINE } from '@/lib/signer';

import type { ChosenRecovery } from '../_lib/onboarding';

type Proof = { status: 'idle' } | { status: 'proving' } | { status: 'proved'; address: Address } | { status: 'failed'; text: string };

export interface RecoveryStepProps {
  chosen: ChosenRecovery | null;
  onChosen: (recovery: ChosenRecovery) => void;
}

/**
 * An optional recovery wallet for a passkey account (D-014, D-022): connect it, have it sign one plain message so a key
 * that cannot sign never becomes the way back in, then set it with the account. Skipping is allowed and says plainly
 * what it means. I11 is claimed only for accounts that set one.
 */
export function RecoveryStep({ chosen, onChosen }: RecoveryStepProps): JSX.Element {
  const connection = useWalletConnection();
  const prove = useProveWalletKey();
  const checkWallet = useContractWalletCheck();
  const [proof, setProof] = useState<Proof>(chosen?.kind === 'wallet' ? { status: 'proved', address: chosen.address } : { status: 'idle' });
  const [skipping, setSkipping] = useState(chosen?.kind === 'none');

  async function proveWallet(candidate: Address) {
    setProof({ status: 'proving' });
    try {
      await checkWallet(candidate);
      const address = await prove();
      setProof({ status: 'proved', address });
    } catch (error) {
      setProof({ status: 'failed', text: walletProblemText(walletProblem(error)) });
    }
  }

  const connected = connection.status === 'connected' ? connection.address : null;
  const provedHere = proof.status === 'proved' && connected !== null && proof.address.toLowerCase() === connected.toLowerCase();

  return (
    <div className="flex flex-col gap-5">
      <Banner title="What a recovery wallet can do">{RECOVERY_WALLET_LINE}</Banner>

      <section aria-label="Connect a recovery wallet" className="rounded-large border border-border bg-surface p-5">
        <ol className="flex flex-col gap-4 text-body-s text-ink-secondary">
          <li className="flex gap-3">
            <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-pill bg-surface-strong font-mono text-label text-ink">
              1
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-ink">Connect the wallet you want as recovery</p>
              <div className="mt-2">
                <ConnectWalletButton variant="secondary" />
              </div>
            </div>
          </li>
          <li className="flex gap-3">
            <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-pill bg-surface-strong font-mono text-label text-ink">
              2
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-ink">Prove it signs with its own key</p>
              <p className="mt-0.5">It signs one plain message. Nothing is sent and nothing moves.</p>
              {provedHere ? (
                <p className="mt-2 flex items-center gap-2 font-medium text-success">
                  <Icon name="check" className="size-4" />
                  {shortAddress(proof.address)} signs with its own key
                </p>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-2"
                  onClick={() => {
                    if (connected !== null) void proveWallet(connected);
                  }}
                  disabled={connected === null}
                  busy={proof.status === 'proving'}
                  busyLabel="Waiting for your wallet"
                >
                  Sign the message
                </Button>
              )}
              {connected === null && !provedHere ? (
                <p className="mt-1 text-ink-muted">Connect a wallet first.</p>
              ) : null}
            </div>
          </li>
        </ol>
        {proof.status === 'failed' ? (
          <ErrorBlock title="This wallet cannot be your recovery wallet" className="mt-4">
            {proof.text}
          </ErrorBlock>
        ) : null}
      </section>

      {skipping ? (
        <Banner title="Continue without a recovery wallet?">{NO_RECOVERY_LINE}</Banner>
      ) : null}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        {skipping ? (
          <Button variant="secondary" onClick={() => onChosen({ kind: 'none' })}>
            Continue without one
          </Button>
        ) : (
          <Button variant="ghost" onClick={() => setSkipping(true)}>
            Skip for now
          </Button>
        )}
        <Button
          onClick={() => {
            if (provedHere) onChosen({ kind: 'wallet', address: proof.address });
          }}
          disabled={!provedHere}
          icon="arrowRight"
        >
          {provedHere ? `Use ${shortAddress(proof.address)} for recovery` : 'Use this wallet for recovery'}
        </Button>
      </div>
    </div>
  );
}
