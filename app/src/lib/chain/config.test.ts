import { PUBLIC_RPC_URL } from '@sleeve/core';
import { describe, expect, it } from 'vitest';

import { missingAccountKeys, missingKeyText, readChainConfig, readServerChainConfig } from './config';

describe('readChainConfig', () => {
  it('reads through the public RPC, throttled, when no read RPC is set', () => {
    const config = readChainConfig({});
    expect([config.readRpcUrl, config.readRpcIsPublic]).toEqual([PUBLIC_RPC_URL, true]);
  });

  it('takes a provider URL as given and does not throttle it', () => {
    const config = readChainConfig({ NEXT_PUBLIC_ROBINHOOD_RPC_URL: ' https://robinhood-mainnet.g.alchemy.com/v2/key ' });
    expect([config.readRpcUrl, config.readRpcIsPublic]).toEqual(['https://robinhood-mainnet.g.alchemy.com/v2/key', false]);
  });

  it('reads Supabase only when both the URL and the anon key are set', () => {
    expect(readChainConfig({ NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co/' }).supabase).toBeNull();
    expect(readChainConfig({ NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co/', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon' }).supabase).toEqual({
      url: 'https://x.supabase.co',
      anonKey: 'anon',
    });
  });

  it('names the keys onboarding still needs, in the words the screen shows', () => {
    expect(missingAccountKeys(readChainConfig({}))).toEqual(['NEXT_PUBLIC_ZERODEV_RPC_URL', 'NEXT_PUBLIC_PASSKEY_RP_ID']);
    expect(
      missingAccountKeys(
        readChainConfig({
          NEXT_PUBLIC_ZERODEV_RPC_URL: 'https://rpc.zerodev.app/api/v3/id/chain/4663',
          NEXT_PUBLIC_PASSKEY_RP_ID: 'sleeve.example',
        }),
      ),
    ).toEqual([]);
    expect(missingKeyText('NEXT_PUBLIC_ZERODEV_RPC_URL')).toBe('Add NEXT_PUBLIC_ZERODEV_RPC_URL to .env.local');
  });
});

describe('readServerChainConfig', () => {
  it('reads through the public RPC, throttled, even when the browser has a locked endpoint', () => {
    // #given the browser's endpoint, which refuses a request without Sleeve's referrer
    const env = { NEXT_PUBLIC_ROBINHOOD_RPC_URL: 'https://name.robinhood-mainnet.quiknode.pro/token/' };
    // #when an API route reads its config
    const config = readServerChainConfig(env);
    // #then it reads the public RPC instead
    expect([config.readRpcUrl, config.readRpcIsPublic]).toEqual([PUBLIC_RPC_URL, true]);
  });
});
