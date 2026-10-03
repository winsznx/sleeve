import { RULE_DEFAULTS, type Address, type Hex } from '@sleeve/core';
import { describe, expect, it, vi } from 'vitest';

import { checkEligibilityOnServer } from '../eligibility-client';
import { DataLayerError, isDataLayerError } from '../errors';
import { browserPasskeys, fromBase64Url, passkeyFailure, toBase64Url, type PasskeyCeremony } from '../passkey';
import type { AccountSetupStep, WalletSigner } from '../types';
import { createMockDataLayer, SAMPLE_ACCOUNT } from '.';

const WALLET: Address = '0x05a1C0FfEE00000000000000000000000000b92D';

function fakeCeremony(): PasskeyCeremony & { approvals: string[] } {
  const approvals: string[] = [];
  return {
    approvals,
    register: vi.fn(async () => ({ credentialId: 'real-credential-1', rpId: 'localhost', ceremony: 'webauthn' as const })),
    approve: vi.fn(async (credentialId: string) => {
      approvals.push(credentialId);
    }),
  };
}

function fakeWallet(address: Address = WALLET): WalletSigner & { signed: Hex[] } {
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

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
}

describe('createPasskey', () => {
  it('simulates a passkey when no browser ceremony is wired, as in tests and on the server', async () => {
    const layer = createMockDataLayer();
    const credential = await layer.createPasskey();
    expect(credential.ceremony).toBe('simulated');
    expect(credential.credentialId).not.toBe('');
  });

  it('runs the browser ceremony when one is wired', async () => {
    const ceremony = fakeCeremony();
    const layer = createMockDataLayer({ passkeys: ceremony });
    expect(await layer.createPasskey()).toEqual({ credentialId: 'real-credential-1', rpId: 'localhost', ceremony: 'webauthn' });
    expect(ceremony.register).toHaveBeenCalledTimes(1);
  });
});

describe('createAccount', () => {
  it('reports each step in order and asks the real passkey to approve the first op and the recovery op', async () => {
    // #given a passkey made by the browser ceremony and a recovery wallet
    const ceremony = fakeCeremony();
    const layer = createMockDataLayer({ passkeys: ceremony });
    const credential = await layer.createPasskey();
    const steps: AccountSetupStep[] = [];
    // #when the account is set up
    const session = await layer.createAccount({
      rule: { ...RULE_DEFAULTS },
      recoverySigner: WALLET,
      signer: { kind: 'passkey', credentialId: credential.credentialId },
      onStep: (step) => steps.push(step),
    });
    // #then the steps ran in order, the passkey signed twice and both views say the module is in
    expect(steps).toEqual(['approve', 'deploy', 'install', 'recovery', 'check']);
    expect(ceremony.approvals).toEqual(['real-credential-1', 'real-credential-1']);
    const account = await layer.getAccount(session.account);
    expect([account.deployed, account.moduleInstalled, account.recoverySigner]).toEqual([true, true, WALLET]);
    expect(session.credentialId).toBe('real-credential-1');
  });

  it('skips the recovery step when none was asked for', async () => {
    const layer = createMockDataLayer();
    const steps: AccountSetupStep[] = [];
    await layer.createAccount({ rule: null, recoverySigner: null, onStep: (step) => steps.push(step) });
    expect(steps).toEqual(['approve', 'deploy', 'install', 'check']);
  });

  it('has a wallet sign the first op once and signs into the same account when the same wallet comes back', async () => {
    // #given a connected wallet
    const layer = createMockDataLayer();
    const wallet = fakeWallet();
    // #when it creates an account twice
    const first = await layer.createAccount({ rule: { ...RULE_DEFAULTS }, recoverySigner: null, signer: { kind: 'wallet', wallet } });
    const again = await layer.createAccount({ rule: { ...RULE_DEFAULTS }, recoverySigner: null, signer: { kind: 'wallet', wallet } });
    // #then one signature made one account, which a wallet session carries no credential for
    expect(wallet.signed).toHaveLength(1);
    expect(again.account).toBe(first.account);
    expect(first.credentialId).toBe('');
    expect(first.account).not.toBe(SAMPLE_ACCOUNT);
  });

  it('creates nothing when the wallet refuses to sign', async () => {
    // #given a wallet whose owner rejects the signature
    const layer = createMockDataLayer();
    const rejected = Object.assign(new Error('User rejected the request.'), { name: 'UserRejectedRequestError' });
    const wallet: WalletSigner = { address: WALLET, signHash: () => Promise.reject(rejected) };
    // #when the setup runs
    const error = await failure(layer.createAccount({ rule: null, recoverySigner: null, signer: { kind: 'wallet', wallet } }));
    // #then the wallet's error comes back as it is and the sample owner is still signed in
    expect(error).toBe(rejected);
    expect((await layer.getSession())?.account).toBe(SAMPLE_ACCOUNT);
  });

  it('asks a wallet that owns the account to sign every owner op after setup', async () => {
    const layer = createMockDataLayer();
    const wallet = fakeWallet();
    await layer.createAccount({ rule: { ...RULE_DEFAULTS }, recoverySigner: null, signer: { kind: 'wallet', wallet } });
    await layer.setRule({ ...RULE_DEFAULTS, spendBps: 8_500, equityBps: 1_500 });
    expect(wallet.signed).toHaveLength(2);
  });
});

describe('owner ops', () => {
  it('ask a real passkey for every write, and never the sample account', async () => {
    // #given the sample owner signed in, then an owner whose passkey this tab made
    const ceremony = fakeCeremony();
    const layer = createMockDataLayer({ passkeys: ceremony });
    await layer.pauseRule();
    expect(ceremony.approvals).toEqual([]);
    const credential = await layer.createPasskey();
    await layer.createAccount({ rule: { ...RULE_DEFAULTS }, recoverySigner: null, signer: { kind: 'passkey', credentialId: credential.credentialId } });
    // #when that owner pauses and resumes the rule
    await layer.pauseRule();
    await layer.resumeRule();
    // #then the first op and both writes were approved with the passkey
    expect(ceremony.approvals).toHaveLength(3);
  });

  it('stop at a cancelled passkey prompt and change nothing', async () => {
    const ceremony = fakeCeremony();
    const layer = createMockDataLayer({ passkeys: ceremony });
    const credential = await layer.createPasskey();
    const session = await layer.createAccount({
      rule: { ...RULE_DEFAULTS },
      recoverySigner: null,
      signer: { kind: 'passkey', credentialId: credential.credentialId },
    });
    vi.mocked(ceremony.approve).mockRejectedValueOnce(new DataLayerError({ code: 'PasskeyCancelled' }, 'closed'));
    const error = await failure(layer.pauseRule());
    expect(isDataLayerError(error) && error.code).toBe('PasskeyCancelled');
    expect((await layer.getRule(session.account)).status).toBe('ACTIVE');
  });
});

describe('eligibility', () => {
  it('uses the server check when one is wired', async () => {
    const eligibility = vi.fn(async () => ({ eligible: false, ipCountry: 'GB', blocks: [{ kind: 'IP_RESTRICTED' as const, country: 'GB' }] }));
    const layer = createMockDataLayer({ eligibility });
    const input = { residence: 'NG', notUsPerson: true, notSanctioned: true };
    expect((await layer.checkEligibility(input)).ipCountry).toBe('GB');
    expect(eligibility).toHaveBeenCalledWith(input);
  });

  it('fails closed when the server cannot answer', async () => {
    const input = { residence: 'NG', notUsPerson: true, notSanctioned: true };
    const offline = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    const broken = vi.fn(async () => new Response('oops', { status: 500 }));
    const fine = vi.fn(async () => Response.json({ eligible: true, ipCountry: 'NG', blocks: [] }));
    for (const fetcher of [offline, broken]) {
      const error = await failure(checkEligibilityOnServer(input, fetcher as unknown as typeof fetch));
      expect(isDataLayerError(error) && error.code).toBe('SourceUnavailable');
    }
    expect(await checkEligibilityOnServer(input, fine as unknown as typeof fetch)).toEqual({ eligible: true, ipCountry: 'NG', blocks: [] });
  });
});

describe('the WebAuthn ceremony', () => {
  it('names a closed prompt and a page off Sleeve’s site', () => {
    expect(passkeyFailure(new DOMException('closed', 'NotAllowedError')).code).toBe('PasskeyCancelled');
    expect(passkeyFailure(new DOMException('rp id', 'SecurityError')).code).toBe('PasskeyUnavailable');
    expect(passkeyFailure(new Error('anything else')).code).toBe('PasskeyUnavailable');
  });

  it('refuses where the browser has no WebAuthn', async () => {
    const error = await failure(browserPasskeys({ rpId: 'localhost' }).register());
    expect(isDataLayerError(error) && error.code).toBe('PasskeyUnavailable');
  });

  it('round-trips credential ids through base64url', () => {
    const raw = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(Array.from(fromBase64Url(toBase64Url(raw)))).toEqual(Array.from(raw));
    expect(toBase64Url(raw)).not.toMatch(/[+/=]/);
  });
});
