import { describe, expect, it } from 'vitest';

import { DataLayerError } from '@/data/errors';

import { lintText } from '../../../../scripts/copy-lint.mjs';
import { passkeySignInText, walletHasNoAccount, walletSignInText } from './sign-in-text';

const OWNER = '0x05a1C0FfEE00000000000000000000000000b92D';
const OTHER = '0x3333333333333333333333333333333333333333';

describe('passkeySignInText', () => {
  it('points an owner whose passkey finds no Sleeve account to wallet sign in', () => {
    // #given each way a passkey finds no account: none on record, none on chain, none this browser can use
    const texts = (['NotFound', 'NotInstalled', 'PasskeyUnavailable'] as const).map((code) => passkeySignInText(new DataLayerError({ code }, code)));
    // #then each says so plainly and names the wallet way in
    expect(texts[0]).toBe('Sleeve has no account for this passkey. If you set up Sleeve with a wallet, sign in with that wallet.');
    expect(texts[1]).toBe(texts[0]);
    expect(texts[2]).toBe('Your passkey could not be used here. If you set up Sleeve with a wallet, sign in with that wallet.');
  });

  it('treats a closed prompt as a passkey that may not be on this device, and anything else as a retry', () => {
    expect(passkeySignInText(new DataLayerError({ code: 'PasskeyCancelled' }, 'closed'))).toBe(
      'Your passkey did not sign you in. Try again, or sign in with a wallet if you set up Sleeve with one.',
    );
    expect(passkeySignInText(new Error('offline'))).toBe('Sign in did not go through. Try again in a moment.');
  });
});

describe('walletSignInText', () => {
  it('says a wallet owns no account, which setting one up answers', () => {
    const none = new DataLayerError({ code: 'NotFound' }, 'no account');
    expect(walletHasNoAccount(none)).toBe(true);
    expect(walletSignInText(none)).toBe(
      'This wallet has no Sleeve account. Set one up with it, or sign in with your passkey if you made one for Sleeve.',
    );
  });

  it('tells a chain that did not answer apart from a wallet that did not connect', () => {
    expect(walletSignInText(new DataLayerError({ code: 'SourceUnavailable' }, 'timeout'))).toBe(
      'Sleeve could not reach Robinhood Chain to find your account. Try again in a moment.',
    );
    const declined = Object.assign(new Error('User rejected the request.'), { name: 'UserRejectedRequestError' });
    expect(walletSignInText(declined)).toBe('You declined the request in your wallet. Nothing was signed and nothing moved.');
    const chunk = Object.assign(new Error('Loading chunk 812 failed.'), { name: 'ChunkLoadError' });
    expect(walletSignInText(chunk)).toBe('Sleeve could not load what it needs to connect a wallet. Check your connection, then try again.');
    expect(walletSignInText(new Error('anything else'))).toBe('Your wallet did not connect. Try again in a moment.');
  });

  it('names the wallet the account expects when another one connects', () => {
    const wrong = new DataLayerError({ code: 'WrongWallet', owner: OWNER, connected: OTHER }, 'wrong wallet');
    expect(walletSignInText(wrong)).toBe('Your wallet has 0x3333…3333 selected. Switch to 0x05a1…b92D in your wallet to continue.');
  });

  it('passes the copy lint in every state', () => {
    const errors = [
      new DataLayerError({ code: 'PasskeyCancelled' }, 'x'),
      new DataLayerError({ code: 'NotFound' }, 'x'),
      new DataLayerError({ code: 'PasskeyUnavailable' }, 'x'),
      new DataLayerError({ code: 'SourceUnavailable' }, 'x'),
      new DataLayerError({ code: 'WrongWallet', owner: OWNER, connected: OTHER }, 'x'),
      new Error('x'),
    ];
    for (const error of errors) {
      expect(lintText(passkeySignInText(error))).toEqual([]);
      expect(lintText(walletSignInText(error))).toEqual([]);
    }
  });
});
