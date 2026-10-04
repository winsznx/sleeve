import { CHAIN_ID } from '@sleeve/core';
import type { Address } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';

import { createChainClient } from './chain/client';
import { type ChainGateway, viemGateway } from './chain/gateway';
import type { KeeperConfig } from './config';
import { ConfigError } from './errors';
import { type HealthLimits, type HealthState, initialHealth } from './health';
import { Indexer } from './index/indexer';
import { Keeper } from './keeper';
import { loadKeeperAccount } from './keyfile';
import { type Logger, createLogger, urlSecrets } from './log';
import { Market } from './market';
import { RunRecorder } from './runs';
import type { KeeperStore } from './store/store';
import { createSupabaseStore } from './store/supabase';
import { NonceManager } from './tx/nonce';
import { TxSender } from './tx/sender';
import { KEEPER_VERSION } from './version';

export interface AppMode {
  dryRun: boolean;
}

export interface AppOptions {
  /** Replaces the store's fetch, for tests that put the database behind a stand-in API. */
  storeFetch?: typeof fetch;
  log?: Logger;
  now?: () => Date;
}

export interface KeeperApp {
  keeper: Keeper;
  health: HealthState;
  limits: HealthLimits;
  chain: ChainGateway;
  store: KeeperStore;
  address: Address;
  log: Logger;
}

/** Secrets that must never reach a log line or a keeper_runs row. */
export function configSecrets(config: KeeperConfig): string[] {
  return [...urlSecrets(config.rpcUrl), config.supabaseServiceRoleKey];
}

export function redactor(secrets: readonly string[]): (text: string) => string {
  const usable = secrets.filter((secret) => secret.length >= 8);
  return (text) => usable.reduce((out, secret) => out.split(secret).join('[redacted]'), text);
}

/** Wires the keeper from its configuration: RPC, key, store, index, market, sender and health state. */
export async function createKeeperApp(
  config: KeeperConfig,
  mode: AppMode,
  options: AppOptions = {},
): Promise<KeeperApp> {
  const secrets = configSecrets(config);
  const log = options.log ?? createLogger({ level: config.logLevel, secrets });
  const account: PrivateKeyAccount | null =
    config.privateKeyFile === null ? null : await loadKeeperAccount(config.privateKeyFile);
  const address = (account?.address ?? config.keeperAddress)?.toLowerCase() as Address | undefined;
  if (address === undefined) throw new ConfigError('CONFIG_MISSING', 'no keeper key and no KEEPER_ADDRESS');

  const client = createChainClient(config.rpcUrl);
  const chainId = await client.getChainId();
  if (chainId !== CHAIN_ID) throw new ConfigError('WRONG_CHAIN', `KEEPER_RPC serves chain ${chainId}, not ${CHAIN_ID}`);
  const chain = viemGateway(client);

  const store = createSupabaseStore({
    url: config.supabaseUrl,
    serviceRoleKey: config.supabaseServiceRoleKey,
    ...(options.storeFetch === undefined ? {} : { fetch: options.storeFetch }),
  });
  const clock = options.now === undefined ? {} : { now: options.now };
  const runs = new RunRecorder({ store, log, redact: redactor(secrets), ...clock });
  const indexer = new Indexer(chain, store, runs, log, {
    confirmations: config.confirmations,
    maxChunkBlocks: config.logChunkBlocks,
  });
  const market = new Market(chain, log);
  const health = initialHealth(KEEPER_VERSION, address, mode.dryRun, new Date());
  const sender =
    mode.dryRun || account === null
      ? null
      : new TxSender({
          chain,
          account,
          nonces: new NonceManager(() => chain.pendingNonce(account.address)),
          maxFeeWei: config.maxFeeWei,
          maxGas: config.maxGas,
          log,
        });
  const keeper = new Keeper(
    {
      keeper: address,
      dryRun: mode.dryRun || account === null,
      gasCeilingWei: config.gasCeilingWei,
      maxFeeWei: config.maxFeeWei,
      minBalanceWei: config.minBalanceWei,
    },
    { chain, store, indexer, market, runs, sender, health, log, ...clock },
  );
  // A pass can wait up to a minute for a receipt, so a stall is three minutes or twelve polls without a finished pass.
  const limits: HealthLimits = { maxLagSeconds: config.maxLagSeconds, stallMs: Math.max(180_000, config.pollMs * 12) };
  return { keeper, health, limits, chain, store, address, log };
}
