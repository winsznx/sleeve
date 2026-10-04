'use client';

import { useConnectModal } from '@rainbow-me/rainbowkit';
import { useEffect, useState, type JSX } from 'react';
import { useConfig, type Config } from 'wagmi';
import { getAccount, watchAccount } from 'wagmi/actions';

import { ConnectFlow, type AccountReading, type AccountSource } from './connect-flow';
import { useWalletSigner } from './use-wallet';
import type { WalletLink } from './wallet-layer';
import { WalletProviders } from './wallet-providers';

/**
 * The wallet code product pages load on demand (D-041): wagmi and RainbowKit through the WalletProviders onboarding
 * uses, and a bridge that hands the layer outside them a link to connect and to sign with. wallet-layer.tsx is the
 * only importer, through import(), so no product page loads this file or anything it imports on first paint.
 */

function accountOf(config: Config): AccountSource {
  const reading = ({ status, address }: ReturnType<typeof getAccount>): AccountReading => ({ status, address });
  return {
    read: () => reading(getAccount(config)),
    watch: (onChange) => watchAccount(config, { onChange: (account) => onChange(reading(account)) }),
  };
}

function WalletBridge({ onLink }: { onLink: (link: WalletLink) => void }): null {
  const config = useConfig();
  const signerFor = useWalletSigner();
  const { connectModalOpen, openConnectModal } = useConnectModal();
  const [flow] = useState(() => new ConnectFlow(accountOf(config)));

  // RainbowKit keeps its modal in React state inside its provider; the flow lives outside React and learns of it here.
  useEffect(() => {
    flow.modalChanged(connectModalOpen, openConnectModal);
  }, [flow, connectModalOpen, openConnectModal]);

  // The layer outside wagmi's tree gets the link once this tree has mounted, after the flow knows the modal.
  useEffect(() => {
    onLink({ connect: (options) => flow.connect(options), signerFor });
  }, [flow, signerFor, onLink]);

  return null;
}

export function WalletIsland({ onLink }: { onLink: (link: WalletLink) => void }): JSX.Element {
  return (
    <WalletProviders>
      <WalletBridge onLink={onLink} />
    </WalletProviders>
  );
}
