'use client';

import type { Address, Hex } from '@sleeve/core';
import { useCallback } from 'react';
import { useAccount, useConfig, usePublicClient } from 'wagmi';
import { getWalletClient } from 'wagmi/actions';

import type { WalletSigner } from '@/data/types';

import { robinhoodChain } from './chain';
import { assertNotContractWallet, assertWalletIsOwner, proveWalletKey } from './wallet-checks';

/**
 * The connected wallet as onboarding needs it, through wagmi inside WalletProviders. Signatures go through the wallet
 * client wagmi holds at the moment of signing, so a switch of account inside the wallet is caught before anything is
 * signed (WRONG_OWNER) instead of after.
 */

export type WalletConnection =
  | { status: 'disconnected' }
  | { status: 'connecting' }
  | { status: 'wrong-chain'; address: Address }
  | { status: 'connected'; address: Address };

export function useWalletConnection(): WalletConnection {
  const { status, address, chainId } = useAccount();
  if (status === 'connecting' || status === 'reconnecting') return { status: 'connecting' };
  if (status !== 'connected' || address === undefined) return { status: 'disconnected' };
  if (chainId !== robinhoodChain.id) return { status: 'wrong-chain', address };
  return { status: 'connected', address };
}

/** A signer for the data layer that signs as `owner` only: one personal_sign per owner op (D-022). */
export function useWalletSigner(): (owner: Address) => WalletSigner {
  const config = useConfig();
  return useCallback(
    (owner: Address): WalletSigner => ({
      address: owner,
      async signHash(hash: Hex): Promise<Hex> {
        const wallet = await getWalletClient(config, { chainId: robinhoodChain.id });
        assertWalletIsOwner(wallet, owner);
        return wallet.signMessage({ account: wallet.account, message: { raw: hash } });
      },
    }),
    [config],
  );
}

/** Refuses a contract wallet, which signs through ERC-1271 and can never own or recover a Kernel account. */
export function useContractWalletCheck(): (address: Address) => Promise<void> {
  const publicClient = usePublicClient({ chainId: robinhoodChain.id });
  return useCallback(
    async (address: Address) => {
      if (publicClient === undefined) throw new Error('No Robinhood Chain client is ready');
      await assertNotContractWallet(publicClient, address);
    },
    [publicClient],
  );
}

/** Has the connected wallet sign one plain message, recovered here, before it becomes a recovery wallet. */
export function useProveWalletKey(): () => Promise<Address> {
  const config = useConfig();
  return useCallback(async () => {
    const wallet = await getWalletClient(config, { chainId: robinhoodChain.id });
    return proveWalletKey(wallet);
  }, [config]);
}
