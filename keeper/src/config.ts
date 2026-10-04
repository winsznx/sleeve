import { type Address, isAddress, parseEther, parseGwei } from 'viem';

import { ConfigError } from './errors';
import { type LogLevel, isLogLevel } from './log';

/**
 * Everything the keeper reads from its environment. On the VPS that is /opt/sleeve/secrets/keeper.env through the
 * systemd unit; nothing is hardcoded and nothing is read from the repo. keeper/deploy/keeper.env.example lists every
 * variable with its default.
 */
export interface KeeperConfig {
  /** KEEPER_RPC: the keeper's own provider (QuickNode, D-032), never the public RPC the verifier uses (D-008). */
  rpcUrl: string;
  /** KEEPER_PRIVATE_KEY_FILE: one hex private key, mode 600 or tighter. */
  privateKeyFile: string | null;
  /** KEEPER_ADDRESS: lets --dry-run simulate as the keeper without its key. */
  keeperAddress: Address | null;
  /** KEEPER_GAS_CEILING_GWEI: sorting holds while the base fee is above this (PRD 7.2). */
  gasCeilingWei: bigint;
  /** KEEPER_MAX_FEE_GWEI: no transaction is priced above this per gas, whatever the reason to send. */
  maxFeeWei: bigint;
  /** KEEPER_MAX_GAS: hard gas limit per call (audit A1-23). */
  maxGas: bigint;
  /** KEEPER_POLL_MS */
  pollMs: number;
  /** KEEPER_HEALTH_PORT: the health endpoint listens on 127.0.0.1 only. 0 picks a free port. */
  healthPort: number;
  /** SUPABASE_URL, else NEXT_PUBLIC_SUPABASE_URL. */
  supabaseUrl: string;
  /** SUPABASE_SERVICE_ROLE_KEY */
  supabaseServiceRoleKey: string;
  /** KEEPER_CONFIRMATIONS: blocks behind the head the index stays, re-read every pass until they are this deep. */
  confirmations: number;
  /** KEEPER_LOG_CHUNK_BLOCKS: the widest eth_getLogs range, halved on a refusal. */
  logChunkBlocks: number;
  /** KEEPER_MIN_BALANCE_ETH: below this the keeper raises LOW_BALANCE. */
  minBalanceWei: bigint;
  /** KEEPER_MAX_LAG_SECONDS: /health answers 503 when the index is further behind the head than this. */
  maxLagSeconds: number;
  /** KEEPER_LOG_LEVEL */
  logLevel: LogLevel;
}

export interface ConfigMode {
  dryRun: boolean;
}

type Env = Readonly<Record<string, string | undefined>>;

const DECIMAL = /^\d+(\.\d+)?$/;
const INTEGER = /^\d+$/;

function read(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value === '' ? undefined : value;
}

function required(env: Env, name: string): string {
  const value = read(env, name);
  if (value === undefined) throw new ConfigError('CONFIG_MISSING', `${name} is required`);
  return value;
}

function httpUrl(name: string, value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError('CONFIG_INVALID', `${name} is not a URL`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ConfigError('CONFIG_INVALID', `${name} must be an http or https URL`);
  }
  return value;
}

function integer(env: Env, name: string, fallback: number, range: { min: number; max: number }): number {
  const raw = read(env, name);
  if (raw === undefined) return fallback;
  if (!INTEGER.test(raw)) throw new ConfigError('CONFIG_INVALID', `${name} must be a whole number, got "${raw}"`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < range.min || value > range.max) {
    throw new ConfigError('CONFIG_INVALID', `${name} must be between ${range.min} and ${range.max}, got ${raw}`);
  }
  return value;
}

function decimalUnits(env: Env, name: string, fallback: string, parse: (text: string) => bigint): bigint {
  const raw = read(env, name) ?? fallback;
  if (!DECIMAL.test(raw)) throw new ConfigError('CONFIG_INVALID', `${name} must be a decimal number, got "${raw}"`);
  return parse(raw);
}

export function loadConfig(env: Env, mode: ConfigMode): KeeperConfig {
  const rpcUrl = httpUrl('KEEPER_RPC', required(env, 'KEEPER_RPC'));
  const privateKeyFile = read(env, 'KEEPER_PRIVATE_KEY_FILE') ?? null;
  const rawAddress = read(env, 'KEEPER_ADDRESS');
  if (rawAddress !== undefined && !isAddress(rawAddress, { strict: false })) {
    throw new ConfigError('CONFIG_INVALID', 'KEEPER_ADDRESS is not an address');
  }
  const keeperAddress = rawAddress === undefined ? null : (rawAddress as Address);
  if (privateKeyFile === null && !(mode.dryRun && keeperAddress !== null)) {
    throw new ConfigError(
      'CONFIG_MISSING',
      mode.dryRun ? 'KEEPER_PRIVATE_KEY_FILE or KEEPER_ADDRESS is required' : 'KEEPER_PRIVATE_KEY_FILE is required',
    );
  }

  const supabaseUrl = httpUrl(
    'SUPABASE_URL',
    read(env, 'SUPABASE_URL') ?? required(env, 'NEXT_PUBLIC_SUPABASE_URL'),
  );
  const supabaseServiceRoleKey = required(env, 'SUPABASE_SERVICE_ROLE_KEY');

  const gasCeilingWei = decimalUnits(env, 'KEEPER_GAS_CEILING_GWEI', '0.1', parseGwei);
  const maxFeeWei = decimalUnits(env, 'KEEPER_MAX_FEE_GWEI', '1', parseGwei);
  if (maxFeeWei === 0n) throw new ConfigError('CONFIG_INVALID', 'KEEPER_MAX_FEE_GWEI must be above zero');

  const rawLevel = read(env, 'KEEPER_LOG_LEVEL') ?? 'info';
  if (!isLogLevel(rawLevel)) throw new ConfigError('CONFIG_INVALID', `KEEPER_LOG_LEVEL "${rawLevel}" is not a level`);

  return {
    rpcUrl,
    privateKeyFile,
    keeperAddress,
    gasCeilingWei,
    maxFeeWei,
    maxGas: BigInt(integer(env, 'KEEPER_MAX_GAS', 1_200_000, { min: 100_000, max: 30_000_000 })),
    pollMs: integer(env, 'KEEPER_POLL_MS', 5_000, { min: 500, max: 600_000 }),
    healthPort: integer(env, 'KEEPER_HEALTH_PORT', 8_787, { min: 0, max: 65_535 }),
    supabaseUrl,
    supabaseServiceRoleKey,
    confirmations: integer(env, 'KEEPER_CONFIRMATIONS', 64, { min: 0, max: 100_000 }),
    logChunkBlocks: integer(env, 'KEEPER_LOG_CHUNK_BLOCKS', 10_000, { min: 1, max: 1_000_000 }),
    minBalanceWei: decimalUnits(env, 'KEEPER_MIN_BALANCE_ETH', '0.001', (text) => parseEther(text)),
    maxLagSeconds: integer(env, 'KEEPER_MAX_LAG_SECONDS', 120, { min: 10, max: 86_400 }),
    logLevel: rawLevel,
  };
}
