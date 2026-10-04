import { RULE_DEFAULTS, type Address, type Hex } from '@sleeve/core';
import { describe, expect, it, vi } from 'vitest';

import { DataLayerError } from '../errors';
import type { WalletSigner } from '../types';
import { createEmptyWorld, createMockDataLayer } from '.';

/**
 * Wallet sessions on the mock (D-041), as on chain: signing in with the wallet that owns an account, and a session
 * that came back without its signer, which signs only once the owner's wallet is attached again.
 */

const OWNER: Address = '0x05a1C0FfEE00000000000000000000000000b92D';
const OTHER: Address = '0x3333333333333333333333333333333333333333';

function fakeWallet(address: Address = OWNER): WalletSigner & { signed: Hex[] } {
  const signed: Hex[] = [];
  return {
    address,
    signed,
    signHash: vi.fn(async (hash: Hex) => {
      signed.push(hash);
      return `0x${'ab'.repeat(65)}` as Hex;
    }),
  };
}

async function failure(promise: Promise<unknown>): Promise<DataLayerError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DataLayerError) return error;
    throw error;
  }
  throw new Error('expected a DataLayerError');
}

/** A world where OWNER's wallet set up an account, signed out, as a returning owner finds it. */
async function walletAccountWorld() {
  const world = createEmptyWorld();
  const setup = createMockDataLayer({ world });
  const created = await setup.createAccount({ rule: { ...RULE_DEFAULTS }, recoverySigner: null, signer: { kind: 'wallet', wallet: fakeWallet() } });
  await setup.signOut();
  return { world, account: created.account };
}

describe('signInWithWallet on the mock', () => {
  it('signs in to the account the wallet set up, without a signature, and the wallet signs from then on', async () => {
    // #given the owner's account and a new tab
    const { world, account } = await walletAccountWorld();
    const layer = createMockDataLayer({ world });
    const wallet = fakeWallet();
    // #when the owner signs in with the wallet
    const session = await layer.signInWithWallet(wallet);
    // #then the session is that account's, attached, and nothing was signed until an owner op
    expect(session).toMatchObject({ account, credentialId: '', wallet: { owner: OWNER, attached: true } });
    expect(wallet.signed).toEqual([]);
    await layer.pauseRule();
    expect(wallet.signed).toHaveLength(1);
  });

  it('leaves a wallet-owned account to its wallet: a passkey sign in finds no account for it', async () => {
    const { world } = await walletAccountWorld();
    const layer = createMockDataLayer({ world });
    expect((await failure(layer.signIn())).code).toBe('NotFound');
    expect(await layer.getSession()).toBeNull();
  });

  it('refuses with NotFound a wallet that owns no account, and starts no session', async () => {
    const { world } = await walletAccountWorld();
    const layer = createMockDataLayer({ world });
    expect((await failure(layer.signInWithWallet(fakeWallet(OTHER)))).code).toBe('NotFound');
    expect(await layer.getSession()).toBeNull();
  });

  it('signs in to an account Sleeve is off for', async () => {
    // #given the owner removed Sleeve, then signed out
    const world = createEmptyWorld();
    const setup = createMockDataLayer({ world });
    const created = await setup.createAccount({ rule: { ...RULE_DEFAULTS }, recoverySigner: null, signer: { kind: 'wallet', wallet: fakeWallet() } });
    await setup.removeSleeve();
    await setup.signOut();
    // #when the owner signs in with the wallet in a new tab
    const layer = createMockDataLayer({ world });
    const session = await layer.signInWithWallet(fakeWallet());
    // #then the account opens, and it reads back without the module
    expect(session.account).toBe(created.account);
    expect((await layer.getAccount(created.account)).moduleInstalled).toBe(false);
  });
});

describe('attachWallet on the mock', () => {
  it('lets a session that came back without its signer sign only once the owner’s wallet is attached', async () => {
    // #given the owner signed in, and the tab reloaded: the session is there, the signer is not
    const { world } = await walletAccountWorld();
    await createMockDataLayer({ world }).signInWithWallet(fakeWallet());
    const layer = createMockDataLayer({ world });
    const wallet = fakeWallet();
    expect((await layer.getSession())?.wallet).toEqual({ owner: OWNER, attached: false });
    expect((await failure(layer.pauseRule())).code).toBe('NotSignedIn');
    // #when the owner's wallet is attached
    const session = await layer.attachWallet(wallet);
    // #then the session says so and the wallet signs the next owner op
    expect(session.wallet).toEqual({ owner: OWNER, attached: true });
    await layer.pauseRule();
    expect(wallet.signed).toHaveLength(1);
  });

  it('refuses another wallet by name, with the owner the account expects', async () => {
    const { world } = await walletAccountWorld();
    await createMockDataLayer({ world }).signInWithWallet(fakeWallet());
    const layer = createMockDataLayer({ world });
    const error = await failure(layer.attachWallet(fakeWallet(OTHER)));
    expect(error.detail).toEqual({ code: 'WrongWallet', owner: OWNER, connected: OTHER });
    expect((await layer.getSession())?.wallet?.attached).toBe(false);
  });
});
