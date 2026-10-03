'use client';

import { useQuery } from '@tanstack/react-query';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';

import { robinhoodChain } from './chain';
import { buildWalletOwnedAccount } from './wallet-account';

/**
 * The Sleeve account the connected wallet owns, derived without any write. Keyed by the wallet address, so a switch
 * of account inside the wallet derives a different Sleeve account instead of signing for the old one.
 */
export function useWalletOwnedAccount() {
  const { address, status } = useAccount();
  const publicClient = usePublicClient({ chainId: robinhoodChain.id });
  const { data: wallet } = useWalletClient({ chainId: robinhoodChain.id });
  return useQuery({
    queryKey: ['sleeve', 'wallet-owned-account', address],
    queryFn: () => {
      if (publicClient === undefined || wallet === undefined) throw new Error('wallet not ready');
      return buildWalletOwnedAccount(publicClient, wallet);
    },
    enabled: status === 'connected' && publicClient !== undefined && wallet !== undefined,
    staleTime: Number.POSITIVE_INFINITY,
    structuralSharing: false,
  });
}
