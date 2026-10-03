'use client';

import { ConnectButton } from '@rainbow-me/rainbowkit';
import { CHAIN_NAME } from '@sleeve/core';
import type { JSX } from 'react';

import { NetworkGlyph } from '@/components/token/glyphs';
import { Button } from '@/components/ui/button';

/**
 * RainbowKit's state and modals behind Sleeve's own Button. Nothing about the wallet renders until mounted, so the
 * server HTML and the first client render agree whatever the cookie holds.
 */
export function ConnectWalletButton({
  fullWidth = false,
  variant = 'primary',
}: {
  fullWidth?: boolean;
  /** The look of the connect button before a wallet is connected. */
  variant?: 'primary' | 'secondary';
}): JSX.Element {
  return (
    <ConnectButton.Custom>
      {({ account, chain, mounted, openConnectModal, openChainModal, openAccountModal, connectModalOpen }) => {
        if (!mounted) {
          return <span aria-hidden="true" className="inline-block min-h-control w-40 rounded-pill bg-skeleton" />;
        }
        if (account === undefined || chain === undefined) {
          return (
            <Button
              fullWidth={fullWidth}
              variant={variant}
              icon="wallet"
              onClick={openConnectModal}
              busy={connectModalOpen}
              busyLabel="Choosing a wallet"
            >
              Connect a wallet
            </Button>
          );
        }
        if (chain.unsupported === true) {
          return (
            <Button fullWidth={fullWidth} variant="secondary" onClick={openChainModal}>
              <NetworkGlyph className="size-4" />
              Switch to {CHAIN_NAME}
            </Button>
          );
        }
        return (
          <Button fullWidth={fullWidth} variant="secondary" onClick={openAccountModal}>
            <span className="font-mono tabular-nums">{account.displayName}</span>
          </Button>
        );
      }}
    </ConnectButton.Custom>
  );
}
