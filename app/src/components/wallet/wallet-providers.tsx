'use client';

import '@rainbow-me/rainbowkit/styles.css';

import { RainbowKitProvider, type DisclaimerComponent } from '@rainbow-me/rainbowkit';
import { PUBLIC_RPC_URL } from '@sleeve/core';
import { useState, type JSX, type ReactNode } from 'react';
import { cookieToInitialState, WagmiProvider } from 'wagmi';

import { robinhoodChain } from './chain';
import { createWalletConfig } from './config';
import { WALLETCONNECT_PROJECT_ID } from './env';
import { SLEEVE_WALLET_CSS } from './theme';

/** Shown at the foot of the connect modal while WalletConnect has no project id. */
const QrCodeOff: DisclaimerComponent = ({ Text }) => (
  <Text>
    Phone wallets by QR code are off until Sleeve has a WalletConnect project id. Wallets installed in this browser
    work now.
  </Text>
);

/**
 * wagmi and RainbowKit for the routes that use a wallet (onboarding now, wallet signing later). Mounted in a route
 * layout, not the product layout: on mount wagmi's reconnect loads every connector's SDK. It sits inside
 * DataLayerProvider and shares its QueryClient, so there is one cache per tab. The config is made once per mount,
 * never at module scope, so the server never shares wallet state between requests.
 *
 * The cookie is read here during hydration, instead of in a layout through headers(), which would
 * make every product route dynamic. On the server initialState is undefined, so every piece of wallet UI waits for
 * mount (ConnectButton.Custom's mounted flag) and never renders wallet state in server HTML.
 */
export function WalletProviders({ children }: { children: ReactNode }): JSX.Element {
  const [config] = useState(() => createWalletConfig(process.env.NEXT_PUBLIC_ROBINHOOD_RPC_URL || PUBLIC_RPC_URL));
  const [initialState] = useState(() =>
    cookieToInitialState(config, typeof document === 'undefined' ? null : document.cookie),
  );
  return (
    <WagmiProvider config={config} initialState={initialState}>
      <RainbowKitProvider
        theme={null}
        modalSize="compact"
        initialChain={robinhoodChain}
        appInfo={{ appName: 'Sleeve', disclaimer: WALLETCONNECT_PROJECT_ID === null ? QrCodeOff : undefined }}
      >
        <style dangerouslySetInnerHTML={{ __html: SLEEVE_WALLET_CSS }} />
        {children}
      </RainbowKitProvider>
    </WagmiProvider>
  );
}
