import { ADDRESSES, DEPLOYMENT_4663 } from '@sleeve/core';
import { createPublicClient, type Address, type PublicClient } from 'viem';

import { sleeveChain } from '@/lib/chain/chain';
import type { ChainConfig } from '@/lib/chain/config';
import { readTransport } from '@/lib/chain/transport';

import { LogStreams } from './logs';

/** The deployed contracts the chain layer reads and calls (docs/DEPLOYMENTS.md, packages/core DEPLOYMENT_4663). */
export const CONTRACTS = {
  module: DEPLOYMENT_4663.contracts.SleeveModule.address,
  tokenSource: DEPLOYMENT_4663.contracts.TokenSource.address,
  calendar: DEPLOYMENT_4663.contracts.SessionCalendarExtension.address,
  usdg: ADDRESSES.USDG,
  usdgUsdFeed: ADDRESSES.USDG_USD_FEED,
  quoter: ADDRESSES.QUOTER_V2,
  router: ADDRESSES.SWAP_ROUTER_02,
  registry: ADDRESSES.ACCESS_CONTROLS_REGISTRY,
  entryPoint: ADDRESSES.ENTRY_POINT_V07,
} as const satisfies Record<string, Address>;

/** No module log can be older than the module's own deploy block. */
export const FIRST_BLOCK = BigInt(DEPLOYMENT_4663.firstBlock);

export interface ChainContext {
  config: ChainConfig;
  client: PublicClient;
  logs: LogStreams;
  /** Where log reads start: the deploy block, or later on a fork whose earlier history is not needed. */
  fromBlock: bigint;
}

export function createReadClient(config: ChainConfig): PublicClient {
  return createPublicClient({
    chain: sleeveChain,
    transport: readTransport(config.readRpcUrl, config.readRpcIsPublic),
    batch: { multicall: { wait: 16 } },
    pollingInterval: 1_000,
  });
}

export function createChainContext(
  config: ChainConfig,
  client: PublicClient = createReadClient(config),
  fromBlock: bigint = FIRST_BLOCK,
): ChainContext {
  return { config, client, logs: new LogStreams(client, fromBlock), fromBlock };
}
