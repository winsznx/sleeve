import { CHAIN_ID, EXPLORER_URL, PUBLIC_RPC_URL } from '@sleeve/core';
import { defineChain } from 'viem';
import { robinhood } from 'viem/chains';

if (robinhood.id !== CHAIN_ID) throw new Error(`viem's Robinhood Chain entry has id ${robinhood.id}, expected ${CHAIN_ID}`);

/**
 * Robinhood Chain for the data layer's viem clients. viem's entry also lists a third-party RPC and websocket; Sleeve
 * names only the official RPC and the Blockscout explorer, and passes its transport explicitly everywhere.
 * Multicall3 is deployed at the canonical address on 4663 (wallet-connect.md section 4).
 */
export const sleeveChain = defineChain({
  ...robinhood,
  rpcUrls: { default: { http: [PUBLIC_RPC_URL] } },
  blockExplorers: { default: { name: 'Blockscout', url: EXPLORER_URL, apiUrl: `${EXPLORER_URL}/api` } },
});
