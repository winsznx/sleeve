import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config';
import { ConfigError } from '../src/errors';

const BASE = {
  KEEPER_RPC: 'https://rpc.example/v2/xxxxxxxxxxxxxxxx',
  KEEPER_PRIVATE_KEY_FILE: '/opt/sleeve/secrets/keeper.key',
  NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-test-test-test',
};

function refusal(env: Record<string, string>, dryRun = false): ConfigError {
  try {
    loadConfig(env, { dryRun });
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error('expected a ConfigError');
}

describe('loadConfig', () => {
  it('fills the documented defaults', () => {
    // #when
    const config = loadConfig(BASE, { dryRun: false });
    // #then
    expect(config).toMatchObject({
      gasCeilingWei: 100_000_000n,
      maxFeeWei: 1_000_000_000n,
      maxGas: 1_200_000n,
      pollMs: 5_000,
      healthPort: 8_787,
      confirmations: 64,
      logChunkBlocks: 10_000,
      minBalanceWei: 1_000_000_000_000_000n,
      maxLagSeconds: 120,
      logLevel: 'info',
      supabaseUrl: 'https://project.supabase.co',
    });
  });

  it('prefers SUPABASE_URL over the public app variable', () => {
    // #when
    const config = loadConfig({ ...BASE, SUPABASE_URL: 'https://server.supabase.co' }, { dryRun: false });
    // #then
    expect(config.supabaseUrl).toBe('https://server.supabase.co');
  });

  it('reads gwei and ether as decimals', () => {
    // #when
    const config = loadConfig(
      { ...BASE, KEEPER_GAS_CEILING_GWEI: '0.0316', KEEPER_MAX_FEE_GWEI: '2.5', KEEPER_MIN_BALANCE_ETH: '0.0005' },
      { dryRun: false },
    );
    // #then
    expect([config.gasCeilingWei, config.maxFeeWei, config.minBalanceWei]).toEqual([
      31_600_000n,
      2_500_000_000n,
      500_000_000_000_000n,
    ]);
  });

  it.each([
    ['KEEPER_RPC', { KEEPER_RPC: '' }, 'CONFIG_MISSING'],
    ['a non-http RPC', { KEEPER_RPC: 'ws://node.example' }, 'CONFIG_INVALID'],
    ['the key file', { KEEPER_PRIVATE_KEY_FILE: '' }, 'CONFIG_MISSING'],
    ['the service key', { SUPABASE_SERVICE_ROLE_KEY: '' }, 'CONFIG_MISSING'],
    ['the Supabase URL', { NEXT_PUBLIC_SUPABASE_URL: '' }, 'CONFIG_MISSING'],
    ['a negative ceiling', { KEEPER_GAS_CEILING_GWEI: '-1' }, 'CONFIG_INVALID'],
    ['a zero fee cap', { KEEPER_MAX_FEE_GWEI: '0' }, 'CONFIG_INVALID'],
    ['a fractional poll', { KEEPER_POLL_MS: '1.5' }, 'CONFIG_INVALID'],
    ['a poll under 500 ms', { KEEPER_POLL_MS: '100' }, 'CONFIG_INVALID'],
    ['a port above 65535', { KEEPER_HEALTH_PORT: '70000' }, 'CONFIG_INVALID'],
    ['an unknown level', { KEEPER_LOG_LEVEL: 'verbose' }, 'CONFIG_INVALID'],
  ])('refuses a bad %s', (_label, change, code) => {
    // #when
    const error = refusal({ ...BASE, ...change });
    // #then
    expect(error.code).toBe(code);
  });

  it('lets a dry run simulate as KEEPER_ADDRESS without the key', () => {
    // #given
    const env = { ...BASE, KEEPER_PRIVATE_KEY_FILE: '', KEEPER_ADDRESS: '0x8649275ca7ce63d2F9E6487570ec0DCe14b6Bf46' };
    // #when
    const config = loadConfig(env, { dryRun: true });
    // #then
    expect([config.privateKeyFile, config.keeperAddress]).toEqual([null, '0x8649275ca7ce63d2F9E6487570ec0DCe14b6Bf46']);
    expect(refusal(env, false).message).toBe('KEEPER_PRIVATE_KEY_FILE is required');
  });

  it('never quotes the RPC URL or the service key in an error', () => {
    // #when
    const error = refusal({ ...BASE, KEEPER_RPC: 'not a url qqqqqqqqqqqq' });
    // #then
    expect(error.message).not.toContain('qqqqqqqqqqqq');
  });
});
