import { CHAIN_ID, CHAIN_NAME } from '@sleeve/core';
import { type Chain, type PublicClient, createPublicClient, defineChain, http } from 'viem';

/** Robinhood Chain as viem sees it, on the keeper's own RPC. */
export function robinhoodChain(rpcUrl: string): Chain {
  return defineChain({
    id: CHAIN_ID,
    name: CHAIN_NAME,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
}

export interface ClientOptions {
  /** Requests made in the same tick go out as one JSON-RPC batch. */
  batch?: boolean;
  timeoutMs?: number;
}

export function createChainClient(rpcUrl: string, options: ClientOptions = {}): PublicClient {
  return createPublicClient({
    chain: robinhoodChain(rpcUrl),
    transport: http(rpcUrl, {
      batch: options.batch === false ? false : { batchSize: 32, wait: 5 },
      timeout: options.timeoutMs ?? 20_000,
      retryCount: 2,
      retryDelay: 300,
    }),
    pollingInterval: 1_000,
  });
}
