'use client';

import { connectorsForWallets, type WalletList } from '@rainbow-me/rainbowkit';
import {
  coinbaseWallet,
  metaMaskWallet,
  rabbyWallet,
  rainbowWallet,
  trustWallet,
  walletConnectWallet,
} from '@rainbow-me/rainbowkit/wallets';
import { cookieStorage, createConfig, createStorage, http } from 'wagmi';

import { robinhoodChain } from './chain';
import { WALLETCONNECT_PROJECT_ID } from './env';

/**
 * Coinbase Wallet's default ("all") offers its smart wallet, which signs with ERC-1271 and ERC-6492. The Kernel ECDSA
 * validator only recovers plain ECDSA signatures, so only the Coinbase Wallet EOA (extension or app) can own a
 * Sleeve account.
 */
coinbaseWallet.preference = 'eoaOnly';

/**
 * With a project id: the six wallets the owner named. Without one, RainbowKit throws for every wallet that can fall
 * back to WalletConnect (MetaMask, Rainbow and Trust when not installed, and WalletConnect itself), and on the server
 * nothing counts as installed, so the list keeps only wallets that never use WalletConnect. Installed extensions,
 * MetaMask and Rainbow among them, still appear under "Installed" through EIP-6963 discovery.
 */
export function walletList(projectId: string | null): WalletList {
  if (projectId === null) {
    return [{ groupName: 'Browser wallets', wallets: [rabbyWallet, coinbaseWallet] }];
  }
  return [
    {
      groupName: 'Wallets',
      wallets: [metaMaskWallet, rainbowWallet, coinbaseWallet, walletConnectWallet, rabbyWallet, trustWallet],
    },
  ];
}

export function createWalletConfig(readRpcUrl: string) {
  return createConfig({
    chains: [robinhoodChain],
    transports: { [robinhoodChain.id]: http(readRpcUrl) },
    connectors: connectorsForWallets(walletList(WALLETCONNECT_PROJECT_ID), {
      appName: 'Sleeve',
      appDescription: 'A payment address on Robinhood Chain that invests part of every payment.',
      // projectId is typed as required; with null no wallet in the list reads it.
      projectId: WALLETCONNECT_PROJECT_ID ?? '',
    }),
    // EIP-6963: installed extensions announce themselves and RainbowKit lists them under "Installed".
    multiInjectedProviderDiscovery: true,
    storage: createStorage({ storage: cookieStorage }),
    ssr: true,
  });
}

export type WalletConfig = ReturnType<typeof createWalletConfig>;

declare module 'wagmi' {
  interface Register {
    config: WalletConfig;
  }
}
