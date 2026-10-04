'use client';

import type { Address } from '@sleeve/core';
import { createContext, useCallback, useContext, useRef, useState, type ComponentType, type JSX, type ReactNode } from 'react';

import type { WalletSigner } from '@/data/types';

import type { ConnectOptions } from './connect-flow';

/**
 * Wallet signing on product pages without wallet code on first paint (D-022, D-041). wagmi, RainbowKit and the Reown
 * SDK load only when a person asks for them: "Sign in with a wallet", or the first signature of a wallet session in a
 * tab. load() imports the wallet island once and mounts it beside the page, never around it, so nothing on the page
 * remounts, then resolves with the link the island hands back. This file imports the island only through import().
 */

export interface WalletLink {
  /** The connected wallet's address, after RainbowKit's connect modal when none is connected. */
  connect(options?: ConnectOptions): Promise<Address>;
  /** A data layer signer that signs as `owner` only, through the wallet connected at the moment it signs. */
  signerFor(owner: Address): WalletSigner;
}

export interface WalletLayer {
  /** Loads the wallet code the first time, and resolves with the link once its providers have mounted. */
  load(): Promise<WalletLink>;
}

type WalletIsland = ComponentType<{ onLink: (link: WalletLink) => void }>;

/** Outside the app shell no island can mount, so asking for the wallet there fails by name instead of waiting. */
const NO_WALLET_LAYER: WalletLayer = {
  load: () => Promise.reject(new Error('Wallet signing needs the app shell, which mounts the wallet layer')),
};

const WalletLayerContext = createContext<WalletLayer>(NO_WALLET_LAYER);

export interface WalletLayerProviderProps {
  children: ReactNode;
  /** Tests pass their own; the app loads the real one. */
  layer?: WalletLayer;
}

/**
 * One wallet layer per tab: a provider inside another, such as the app shell's under a test's, serves nothing of its
 * own, so the tab keeps one wagmi config.
 */
export function WalletLayerProvider({ children, layer: given }: WalletLayerProviderProps): JSX.Element {
  const outer = useContext(WalletLayerContext);
  const [Island, setIsland] = useState<WalletIsland | null>(null);
  const link = useRef<WalletLink | null>(null);
  const loading = useRef<Promise<WalletLink> | null>(null);
  const linked = useRef<((next: WalletLink) => void) | null>(null);

  const [layer] = useState<WalletLayer>(
    () =>
      given ?? {
        load() {
          if (link.current !== null) return Promise.resolve(link.current);
          loading.current ??= new Promise<WalletLink>((resolve, reject) => {
            linked.current = resolve;
            import('./wallet-island').then(
              (module) => setIsland(() => module.WalletIsland),
              (error: unknown) => {
                // A failed chunk load can be asked for again, on the next press.
                loading.current = null;
                reject(error);
              },
            );
          });
          return loading.current;
        },
      },
  );

  const onLink = useCallback((next: WalletLink) => {
    link.current = next;
    linked.current?.(next);
    linked.current = null;
    loading.current = null;
  }, []);

  if (outer !== NO_WALLET_LAYER && given === undefined) return <>{children}</>;
  return (
    <WalletLayerContext.Provider value={layer}>
      {children}
      {Island === null ? null : <Island onLink={onLink} />}
    </WalletLayerContext.Provider>
  );
}

export function useWalletLayer(): WalletLayer {
  return useContext(WalletLayerContext);
}
