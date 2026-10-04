'use client';

import { shortAddress } from '@sleeve/core';
import { useState, type JSX, type ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Banner, ErrorBlock } from '@/components/ui/card';
import { cx } from '@/components/ui/cx';
import { Icon, type IconName } from '@/components/ui/icons';
import { ConnectWalletButton } from '@/components/wallet/connect-wallet-button';
import { WALLETCONNECT_PROJECT_ID } from '@/components/wallet/env';
import { useContractWalletCheck, useWalletConnection } from '@/components/wallet/use-wallet';
import { walletProblem, walletProblemText } from '@/components/wallet/wallet-problems';
import { isDataLayerError } from '@/data/errors';
import { useCreatePasskey } from '@/data/hooks';
import { PASSKEY_RECORDS_LINE, PASSKEY_SITE_LINE, WALLET_OWNER_LINE } from '@/lib/signer';

import type { ChosenSigner } from '../_lib/onboarding';

/** Phone wallets reach Sleeve only through WalletConnect, which needs the project id (wallet-connect.md section 3). */
export const QR_OFF_LINE =
  'Phone wallets by QR code are off until Sleeve has a WalletConnect project id. Wallets installed in this browser work now.';

function passkeyFailureText(error: Error): string {
  if (isDataLayerError(error) && error.detail.code === 'MissingConfig') {
    return `Add ${error.detail.key} to .env.local. The passkey is bound to that site for good, so it is set before any passkey is made.`;
  }
  if (isDataLayerError(error) && error.code === 'PasskeyCancelled') {
    return 'The passkey prompt closed before it finished. Nothing was made. Try again when you are ready.';
  }
  if (isDataLayerError(error) && error.code === 'PasskeyUnavailable') {
    return "This browser cannot make a passkey on this page. Sleeve's passkey works only on Sleeve's own site, over a secure connection. Try another browser, or use a wallet.";
  }
  return 'The passkey was not made. Try again in a moment.';
}

function Option({
  icon,
  title,
  badge,
  chosen,
  children,
}: {
  icon: IconName;
  title: string;
  badge?: ReactNode;
  chosen: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <section
      aria-label={title}
      className={cx(
        'flex min-w-0 flex-col rounded-large border bg-surface p-5 transition-colors duration-fast ease-standard',
        chosen ? 'border-brand ring-1 ring-brand' : 'border-border',
      )}
    >
      <div className="flex items-start gap-3">
        <span className="grid size-icon-tile shrink-0 place-items-center rounded-row bg-surface-muted text-ink">
          <Icon name={icon} />
        </span>
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 text-h3 text-ink">
            {title}
            {badge}
          </h3>
        </div>
      </div>
      <div className="mt-3 flex flex-1 flex-col gap-4 text-body-s text-ink-secondary">{children}</div>
    </section>
  );
}

export interface SignerStepProps {
  chosen: ChosenSigner | null;
  onChosen: (signer: ChosenSigner) => void;
}

/**
 * How the owner signs (D-003, D-022): a passkey made for Sleeve's site, first and suggested, or a wallet the person
 * already has, through RainbowKit. A wallet that owns the account can act outside Sleeve, and the step says so before
 * it is chosen.
 */
export function SignerStep({ chosen, onChosen }: SignerStepProps): JSX.Element {
  const createPasskey = useCreatePasskey();
  const connection = useWalletConnection();
  const checkWallet = useContractWalletCheck();
  const [walletCheck, setWalletCheck] = useState<{ status: 'idle' | 'checking' } | { status: 'failed'; text: string }>({
    status: 'idle',
  });

  function makePasskey() {
    createPasskey.mutate(undefined, { onSuccess: (credential) => onChosen({ kind: 'passkey', credential }) });
  }

  async function chooseWallet(address: `0x${string}`) {
    setWalletCheck({ status: 'checking' });
    try {
      await checkWallet(address);
      setWalletCheck({ status: 'idle' });
      onChosen({ kind: 'wallet', address });
    } catch (error) {
      const problem = walletProblem(error);
      setWalletCheck({
        status: 'failed',
        text:
          problem.kind === 'UNKNOWN'
            ? 'Sleeve could not check this wallet on Robinhood Chain. Nothing moved. Try again in a moment.'
            : walletProblemText(problem),
      });
    }
  }

  const passkeyMade = chosen?.kind === 'passkey';
  const walletChosen = chosen?.kind === 'wallet';

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Option icon="key" title="Use a passkey" badge={<Badge tone="success">Suggested</Badge>} chosen={passkeyMade}>
        <p>{PASSKEY_SITE_LINE}</p>
        <p>Your device makes it with Face ID, Touch ID, Windows Hello or your screen lock. Nothing goes onchain yet.</p>
        <p>{PASSKEY_RECORDS_LINE}</p>
        {passkeyMade ? (
          <p className="flex items-center gap-2 font-medium text-success">
            <Icon name="check" className="size-4" />
            Passkey made for {chosen.credential.rpId}
          </p>
        ) : null}
        {createPasskey.isError ? (
          <ErrorBlock title="No passkey yet">{passkeyFailureText(createPasskey.error)}</ErrorBlock>
        ) : null}
        <div className="mt-auto flex flex-wrap gap-3">
          {passkeyMade ? (
            <Button onClick={() => onChosen(chosen)} icon="arrowRight">
              Continue with this passkey
            </Button>
          ) : (
            <Button onClick={makePasskey} busy={createPasskey.isPending} busyLabel="Waiting for your device" icon="key">
              Create a passkey
            </Button>
          )}
        </div>
      </Option>

      <Option icon="wallet" title="Use a wallet you already have" chosen={walletChosen}>
        <p>MetaMask, Rabby, Rainbow, Trust or Coinbase Wallet. The wallet becomes the owner of your Sleeve account.</p>
        {WALLETCONNECT_PROJECT_ID === null ? <p className="text-ink-muted">{QR_OFF_LINE}</p> : null}
        {connection.status === 'connected' ? (
          <Banner title="Before you choose it">{WALLET_OWNER_LINE}</Banner>
        ) : null}
        {walletCheck.status === 'failed' ? <ErrorBlock title="This wallet cannot own the account">{walletCheck.text}</ErrorBlock> : null}
        <div className="mt-auto flex flex-wrap items-center gap-3">
          <ConnectWalletButton variant="secondary" />
          {connection.status === 'connected' ? (
            <Button
              onClick={() => void chooseWallet(connection.address)}
              busy={walletCheck.status === 'checking'}
              busyLabel="Checking the wallet"
              icon="arrowRight"
            >
              {walletChosen && chosen.address.toLowerCase() === connection.address.toLowerCase()
                ? 'Continue with this wallet'
                : `Use ${shortAddress(connection.address)}`}
            </Button>
          ) : null}
        </div>
      </Option>
    </div>
  );
}
