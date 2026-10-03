import { PUBLIC_RPC_URL } from '@sleeve/core';

/**
 * What the Robinhood Chain data layer needs from the environment. Next inlines a NEXT_PUBLIC_ variable only where the
 * code names it in full, so each one is read by its literal name below. Every value here is public by design: RPC
 * URLs with a domain allowlist, the ZeroDev project URL, the relying party id and Supabase's anon key. Secrets stay
 * server side (SUPABASE_SERVICE_ROLE_KEY is read only in app/api).
 */

export interface SupabasePublicConfig {
  url: string;
  anonKey: string;
}

export interface ChainConfig {
  /** Browser and server reads. The public RPC when NEXT_PUBLIC_ROBINHOOD_RPC_URL is empty. */
  readRpcUrl: string;
  /** True on the public RPC, which is rate limited: reads go one at a time with backoff (D-012). */
  readRpcIsPublic: boolean;
  /** ZeroDev bundler and paymaster, https://rpc.zerodev.app/api/v3/<project id>/chain/4663. */
  zeroDevRpcUrl: string | null;
  /** The passkey's relying party id: Sleeve's domain, final before the first real passkey (D-003). */
  passkeyRpId: string | null;
  /** Read receipts from Supabase first when both values are set. */
  supabase: SupabasePublicConfig | null;
}

/** The variables the chain layer reads, by the name a person types into .env.local. */
export type ChainEnvKey =
  | 'NEXT_PUBLIC_ROBINHOOD_RPC_URL'
  | 'NEXT_PUBLIC_ZERODEV_RPC_URL'
  | 'NEXT_PUBLIC_PASSKEY_RP_ID'
  | 'NEXT_PUBLIC_SUPABASE_URL'
  | 'NEXT_PUBLIC_SUPABASE_ANON_KEY';

export type ChainEnv = Partial<Record<ChainEnvKey, string | undefined>>;

function value(text: string | undefined): string | null {
  const trimmed = text?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

/** The environment as Next inlines it. */
export function publicChainEnv(): ChainEnv {
  return {
    NEXT_PUBLIC_ROBINHOOD_RPC_URL: process.env.NEXT_PUBLIC_ROBINHOOD_RPC_URL,
    NEXT_PUBLIC_ZERODEV_RPC_URL: process.env.NEXT_PUBLIC_ZERODEV_RPC_URL,
    NEXT_PUBLIC_PASSKEY_RP_ID: process.env.NEXT_PUBLIC_PASSKEY_RP_ID,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}

export function readChainConfig(env: ChainEnv = publicChainEnv()): ChainConfig {
  const rpc = value(env.NEXT_PUBLIC_ROBINHOOD_RPC_URL);
  const supabaseUrl = value(env.NEXT_PUBLIC_SUPABASE_URL);
  const anonKey = value(env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  return {
    readRpcUrl: rpc ?? PUBLIC_RPC_URL,
    readRpcIsPublic: rpc === null || rpc.replace(/\/+$/, '') === PUBLIC_RPC_URL,
    zeroDevRpcUrl: value(env.NEXT_PUBLIC_ZERODEV_RPC_URL),
    passkeyRpId: value(env.NEXT_PUBLIC_PASSKEY_RP_ID),
    supabase: supabaseUrl !== null && anonKey !== null ? { url: supabaseUrl.replace(/\/+$/, ''), anonKey } : null,
  };
}

/**
 * The keys onboarding needs before it can create an account on chain, for the screen to list. The read RPC is not
 * among them: an empty value reads through the public RPC, slower but working.
 */
export function missingAccountKeys(config: ChainConfig): ChainEnvKey[] {
  const missing: ChainEnvKey[] = [];
  if (config.zeroDevRpcUrl === null) missing.push('NEXT_PUBLIC_ZERODEV_RPC_URL');
  if (config.passkeyRpId === null) missing.push('NEXT_PUBLIC_PASSKEY_RP_ID');
  return missing;
}

/** The plain line for a missing key. */
export function missingKeyText(key: ChainEnvKey): string {
  return `Add ${key} to .env.local`;
}
