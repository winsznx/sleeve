'use client';

import { useState, type JSX } from 'react';

import { Button, ButtonLink } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { ConnectClosedError, type ConnectOptions } from '@/components/wallet/connect-flow';
import { useWalletLayer } from '@/components/wallet/wallet-layer';
import { useSignIn, useSignInWithWallet } from '@/data/hooks';

import { passkeySignInText, walletHasNoAccount, walletSignInText } from './sign-in-text';

export interface SignInFailure {
  by: 'passkey' | 'wallet';
  error: Error;
}

export interface SignInFlows {
  passkeyBusy: boolean;
  walletBusy: boolean;
  /** The last attempt's failure. Null before one, and after a connect modal closed without a wallet. */
  failure: SignInFailure | null;
  signInWithPasskey: () => void;
  signInWithWallet: (options?: ConnectOptions) => void;
}

export interface SignInFlowOptions {
  /** Called when the wallet path fails, for a host whose panel closed before the wallet connected. */
  onWalletFailure?: (error: Error) => void;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Both ways into an existing account (D-003, D-022, D-041): the passkey ceremony, and a wallet that connects and signs
 * in to the account it owns, which loads the wallet code on that press. The caller holds them, so a sign in started
 * from a panel that closes keeps its state. A success refreshes every read, so the screen fills in where it stands.
 */
export function useSignInFlows({ onWalletFailure }: SignInFlowOptions = {}): SignInFlows {
  const passkey = useSignIn();
  const wallet = useSignInWithWallet();
  const walletLayer = useWalletLayer();
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletFailure, setWalletFailure] = useState<Error | null>(null);

  async function runWallet(options: ConnectOptions | undefined): Promise<void> {
    setWalletBusy(true);
    setWalletFailure(null);
    passkey.reset();
    try {
      const link = await walletLayer.load();
      const address = await link.connect(options);
      await wallet.mutateAsync(link.signerFor(address));
    } catch (error) {
      if (error instanceof ConnectClosedError) return;
      const failure = asError(error);
      setWalletFailure(failure);
      onWalletFailure?.(failure);
    } finally {
      setWalletBusy(false);
    }
  }

  let failure: SignInFailure | null = null;
  if (passkey.error !== null) failure = { by: 'passkey', error: passkey.error };
  else if (walletFailure !== null) failure = { by: 'wallet', error: walletFailure };

  return {
    passkeyBusy: passkey.isPending,
    walletBusy,
    failure,
    signInWithPasskey: () => {
      setWalletFailure(null);
      passkey.mutate();
    },
    signInWithWallet: (options) => {
      void runWallet(options);
    },
  };
}

export interface SignInOptionsProps {
  flows: SignInFlows;
  /** Runs as the wallet path starts, for a host that has to close first, such as the top bar's panel. */
  onWallet?: () => void;
  /** center under an empty state's title; start in a card or a panel that reads from the left. Default center. */
  align?: 'center' | 'start';
}

/** The two ways in, what went wrong with the last try, and the way to set up for someone new. */
export function SignInOptions({ flows, onWallet, align = 'center' }: SignInOptionsProps): JSX.Element {
  const { failure } = flows;
  const noAccount = failure?.by === 'wallet' && walletHasNoAccount(failure.error);
  const centered = align === 'center';
  return (
    <div className={cx('flex w-full flex-col gap-2', centered ? 'items-center' : 'items-start')}>
      <div className={cx('flex w-full flex-col gap-2 sm:flex-row', centered ? 'items-center sm:justify-center' : 'items-start sm:flex-wrap')}>
        <Button icon="key" onClick={flows.signInWithPasskey} busy={flows.passkeyBusy} busyLabel="Signing in" disabled={flows.walletBusy}>
          Sign in with your passkey
        </Button>
        <Button
          variant="secondary"
          icon="wallet"
          onClick={() => {
            onWallet?.();
            flows.signInWithWallet();
          }}
          busy={flows.walletBusy}
          busyLabel="Waiting for your wallet"
          disabled={flows.passkeyBusy}
        >
          Sign in with a wallet
        </Button>
      </div>
      {failure === null ? null : (
        <p role="alert" className={cx('max-w-reading text-body-s text-danger', centered && 'text-center')}>
          {failure.by === 'passkey' ? passkeySignInText(failure.error) : walletSignInText(failure.error)}
        </p>
      )}
      {noAccount ? (
        <ButtonLink href="/onboard" prefetch={false} variant="secondary" size="sm" icon="arrowRight">
          Set up your account
        </ButtonLink>
      ) : (
        <ButtonLink href="/onboard" prefetch={false} variant="ghost" size="sm">
          New to Sleeve? Set up your account
        </ButtonLink>
      )}
    </div>
  );
}

/** The two ways in, for a signed-out screen that holds them itself. */
export function SignInChoices({ align }: Pick<SignInOptionsProps, 'align'>): JSX.Element {
  const flows = useSignInFlows();
  return <SignInOptions flows={flows} align={align} />;
}
