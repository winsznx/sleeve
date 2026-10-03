'use client';

import { CHAIN_ID, CHAIN_NAME, shortAddress, type Address } from '@sleeve/core';
import { useRouter } from 'next/navigation';
import type { JSX } from 'react';

import { NetworkGlyph } from '@/components/token/glyphs';
import { Button } from '@/components/ui/button';
import { CopyButton, CopyField, ShareButton } from '@/components/ui/copy-field';
import { cx } from '@/components/ui/cx';
import { Icon } from '@/components/ui/icons';
import { useAccount, useSession, useSignOut } from '@/data/hooks';
import type { Session } from '@/data/types';

import { AccountAvatar } from './account-avatar';
import { BalancesPanel } from './balances';
import { Popover } from './popover';
import { ReceiveButton } from './receive';
import { SampleTag } from './sample-tag';

/**
 * The account chip (docs/design/inspiration.md 5.5): the avatar, the payment address in short form and how the owner
 * signs, with copy beside it. Its panel shows the address in full with copy and share, the signer and the recovery
 * signer, the network, Receive and Sign out; on screens without the balance chip it also carries the balances.
 */

export type SignerKind = 'passkey' | 'wallet';

/** How the signed-in owner signs. M0 sessions come from the passkey ceremony (D-003); a wallet session has no credential. */
export function signerOf(session: Session | null | undefined): SignerKind | null {
  if (session === null || session === undefined) return null;
  return session.credentialId === '' ? 'wallet' : 'passkey';
}

const SIGNER_LABEL: Record<SignerKind, string> = { passkey: 'Passkey', wallet: 'Wallet' };
const SIGNER_LINE: Record<SignerKind, string> = {
  passkey: 'Signed in with a passkey on this device.',
  wallet: 'Signed in with a connected wallet, which can also sign outside Sleeve.',
};

export function AccountChip({ account, className }: { account: Address; className?: string }): JSX.Element {
  const session = useSession();
  const signer = signerOf(session.data);
  const short = shortAddress(account);
  return (
    <div className={cx('flex shrink-0 items-center', className)}>
      <Popover
        title="Your account"
        buttonLabel={`Account ${short}${signer === null ? '' : `, ${SIGNER_LABEL[signer].toLowerCase()}`}. Show account.`}
        buttonClassName="inline-flex min-h-touch min-w-touch items-center justify-center gap-2.5 rounded-pill transition-colors duration-fast ease-standard hover:bg-surface-muted md:min-h-control-sm md:min-w-0 md:px-1.5 xl:border xl:border-border xl:bg-surface xl:pl-1.5 xl:pr-3 xl:hover:border-border-strong xl:hover:bg-surface"
        button={
          <>
            <AccountAvatar address={account} size="sm" />
            <span aria-hidden="true" className="hidden min-w-0 flex-col items-start text-left xl:flex">
              <span className="font-mono text-mono-s leading-tight text-ink">{short}</span>
              {signer === null ? null : <span className="text-micro text-ink-secondary">{SIGNER_LABEL[signer]}</span>}
            </span>
            <Icon name="chevronDown" className="hidden size-3.5 text-ink-secondary xl:block" />
          </>
        }
        panelClassName="w-[24rem]"
      >
        {(close) => <AccountPanel account={account} signer={signer} onDone={close} />}
      </Popover>
      <CopyButton value={account} label="Copy payment address" className="hidden xl:inline-flex" />
    </div>
  );
}

function AccountPanel({ account, signer, onDone }: { account: Address; signer: SignerKind | null; onDone: () => void }): JSX.Element {
  const overview = useAccount(account);
  const signOut = useSignOut();
  const router = useRouter();
  const recovery = overview.data?.recoverySigner;

  function handleSignOut() {
    signOut.mutate(undefined, {
      onSuccess: () => {
        onDone();
        router.push('/');
      },
    });
  }

  return (
    <div className="min-w-0">
      <div className="p-4">
        <div className="flex items-center gap-3">
          <AccountAvatar address={account} />
          <div className="min-w-0">
            <p className="text-body-s font-semibold text-ink">Your payment address</p>
            <p className="text-body-s text-ink-secondary">{signer === null ? 'Not signed in.' : SIGNER_LINE[signer]}</p>
          </div>
        </div>
        <CopyField
          className="mt-3"
          size="sm"
          label={<span className="sr-only">Payment address</span>}
          value={account}
          copyLabel="Copy payment address"
          actions={<ShareButton text={account} title="Sleeve payment address" label="Share payment address" />}
        />
        <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-body-s">
          <dt className="text-ink-secondary">Network</dt>
          <dd className="flex min-w-0 items-center gap-1.5 text-ink">
            <NetworkGlyph className="size-4 shrink-0 text-ink-secondary" />
            {CHAIN_NAME}, chain id {CHAIN_ID}
          </dd>
          <dt className="text-ink-secondary">Recovery</dt>
          <dd className="min-w-0 text-ink">
            {recovery === undefined ? (
              overview.isError ? 'Did not load' : 'Loading'
            ) : recovery === null ? (
              'No recovery signer set'
            ) : (
              <>
                Recovery signer <span className="font-mono text-mono-s">{shortAddress(recovery)}</span>
              </>
            )}
          </dd>
        </dl>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <ReceiveButton look="menu" onOpen={onDone} />
          <Button
            variant="secondary"
            busy={signOut.isPending}
            busyLabel="Signing out"
            onClick={handleSignOut}
          >
            Sign out
          </Button>
        </div>
        {signOut.isError ? (
          <p role="alert" className="mt-2 text-body-s text-danger">
            Signing out did not finish. Try again.
          </p>
        ) : null}
        <SampleTag className="mt-3" />
      </div>
      <div className="border-t border-border lg:hidden">
        <BalancesPanel account={account} withActions={false} />
      </div>
    </div>
  );
}
