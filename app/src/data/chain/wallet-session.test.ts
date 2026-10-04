// @vitest-environment node
import { getAddress, type Hex } from 'viem';
import { describe, expect, it, vi } from 'vitest';

import type { WalletSigner } from '../types';
import {
  ACCOUNT,
  BLOCK_TIME,
  OWNER_WALLET,
  SESSION,
  chainLayer,
  failure,
  fakeClient,
  installed,
  landingRoute,
  removed,
  undeployed,
} from './__tests__/fake-chain';
import { kernelAccountFor } from './accounts';
import type { StoredSession } from './session';

/**
 * Wallet sessions on the chain data layer (D-041): signing in with the wallet that owns an account, and attaching
 * the wallet again to a session read back from storage, which holds only public data. Run on the fake chain, whose
 * EntryPoint answers ACCOUNT only for a Kernel account that OWNER_WALLET owns on the Sleeve salt.
 */

const OTHER_WALLET = getAddress('0x3333333333333333333333333333333333333333');
const WALLET_SIGNATURE: Hex = `0x${'ab'.repeat(65)}`;

/** A wallet session as a reload reads it back from storage: the owner's address, and no signer. */
const STORED_WALLET_SESSION: StoredSession = {
  account: ACCOUNT,
  signer: { kind: 'wallet', owner: OWNER_WALLET },
  signedInAt: BLOCK_TIME.toString(),
};

function fakeWallet(address = OWNER_WALLET): WalletSigner & { signHash: ReturnType<typeof vi.fn> } {
  return { address, signHash: vi.fn(async () => WALLET_SIGNATURE) };
}

function pauseRule(chain: ReturnType<typeof installed>): void {
  chain.rule = { ...chain.rule, status: 'PAUSED' };
}

describe('signInWithWallet on chain', () => {
  it('signs in to the account the wallet owns, derived as createAccount derives it, and asks for no signature', async () => {
    // #given the owner's wallet and its account deployed with Sleeve on, and nobody signed in
    const state = installed();
    const client = fakeClient(state);
    const layer = chainLayer(client, landingRoute(state, () => undefined, []), null);
    const wallet = fakeWallet();

    // #when the owner signs in with the wallet
    const session = await layer.signInWithWallet(wallet);

    // #then the session is the account createAccount's derivation gives that wallet, held for this tab
    const derived = await kernelAccountFor(client, { kind: 'wallet', address: OWNER_WALLET, signHash: wallet.signHash });
    expect(derived.address).toBe(ACCOUNT);
    expect(session).toEqual({ account: ACCOUNT, credentialId: '', wallet: { owner: OWNER_WALLET, attached: true }, signedInAt: BLOCK_TIME });
    expect(await layer.getSession()).toEqual(session);
    expect(wallet.signHash).not.toHaveBeenCalled();
  });

  it('refuses with NotFound when no account is deployed for the wallet, and starts no session', async () => {
    // #given a wallet that owns no Sleeve account, and the owner's wallet before its account was deployed
    const deployed = installed();
    const other = chainLayer(fakeClient(deployed), landingRoute(deployed, () => undefined, []), null);
    const before = undeployed();
    const owner = chainLayer(fakeClient(before), landingRoute(before, () => undefined, []), null);

    // #when each signs in / #then each is refused by name, and nobody is signed in
    expect((await failure(other.signInWithWallet(fakeWallet(OTHER_WALLET)))).code).toBe('NotFound');
    expect((await failure(owner.signInWithWallet(fakeWallet()))).code).toBe('NotFound');
    expect([await other.getSession(), await owner.getSession()]).toEqual([null, null]);
  });

  it('signs in to an account Sleeve is off for, so its owner can still send or turn Sleeve back on', async () => {
    // #given the owner's account after Remove Sleeve
    const state = removed();
    const layer = chainLayer(fakeClient(state), landingRoute(state, () => undefined, []), null);
    // #when the owner signs in with the wallet
    const session = await layer.signInWithWallet(fakeWallet());
    // #then the session opens on the account, which reads back without the module
    expect(session.account).toBe(ACCOUNT);
    expect((await layer.getAccount(ACCOUNT)).moduleInstalled).toBe(false);
  });
});

describe('attachWallet on chain', () => {
  it('lets a stored wallet session sign only once the owner’s wallet is attached', async () => {
    // #given a wallet session read back from storage, with no signer in this tab
    const state = installed();
    const route = landingRoute(state, pauseRule, []);
    const layer = chainLayer(fakeClient(state), route, STORED_WALLET_SESSION);
    const wallet = fakeWallet();
    expect((await layer.getSession())?.wallet).toEqual({ owner: OWNER_WALLET, attached: false });
    expect(await failure(layer.pauseRule())).toMatchObject({ code: 'NotSignedIn', message: 'Connect the wallet that owns this account again to sign' });

    // #when the owner's wallet is attached
    const session = await layer.attachWallet(wallet);

    // #then the session says so, and the next owner op is signed by that wallet once
    expect(session.wallet).toEqual({ owner: OWNER_WALLET, attached: true });
    expect((await layer.pauseRule()).status).toBe('PAUSED');
    expect(wallet.signHash).toHaveBeenCalledTimes(1);
  });

  it('refuses another wallet by name, with the owner the account expects, and stays unattached', async () => {
    // #given a stored wallet session
    const state = installed();
    const layer = chainLayer(fakeClient(state), landingRoute(state, () => undefined, []), STORED_WALLET_SESSION);
    // #when a wallet that is not the owner is offered
    const error = await failure(layer.attachWallet(fakeWallet(OTHER_WALLET)));
    // #then it is WrongWallet, naming both, and nothing can sign yet
    expect(error.detail).toEqual({ code: 'WrongWallet', owner: OWNER_WALLET, connected: OTHER_WALLET });
    expect((await layer.getSession())?.wallet?.attached).toBe(false);
  });

  it('takes no wallet for a passkey session', async () => {
    const state = installed();
    const layer = chainLayer(fakeClient(state), landingRoute(state, () => undefined, []), SESSION);
    await expect(layer.attachWallet(fakeWallet())).rejects.toThrow(RangeError);
  });
});
