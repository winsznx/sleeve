import type { Rule } from '@sleeve/core';
import { describe, expect, it } from 'vitest';

import { DataLayerError, type DataLayerErrorCode, type DataLayerErrorDetail } from '@/data/errors';

import { lintText } from '../../../../../../scripts/copy-lint.mjs';
import { failureText, ruleSentence, signInFailureText } from './sentences';

/** The codes whose detail carries more than the code. */
type CodeWithData<D> = D extends { code: infer C } ? ([Exclude<keyof D, 'code'>] extends [never] ? never : C) : never;

/** Codes whose detail carries nothing but the code. */
type PlainCode = Exclude<DataLayerErrorCode, CodeWithData<DataLayerErrorDetail>>;

const ACTIVE: Rule = {
  version: 2,
  status: 'ACTIVE',
  equityBps: 1_000,
  tickerId: 0,
  premiumCapBps: 100,
  slippageBps: 50,
  minClip: 25_000_000n,
};

function named(code: PlainCode): DataLayerError {
  return new DataLayerError({ code }, code);
}

describe('ruleSentence', () => {
  it('says what every payment does under an active rule, in its own numbers', () => {
    expect(ruleSentence(ACTIVE)).toBe(
      'When you get paid, 90% stays spendable and 10% buys SPY Stock Tokens into your own account.',
    );
    expect(ruleSentence({ ...ACTIVE, equityBps: 2_550, tickerId: 1 })).toBe(
      'When you get paid, 74.5% stays spendable and 25.5% buys QQQ Stock Tokens into your own account.',
    );
  });

  it('reads plainly at either end of the range', () => {
    expect(ruleSentence({ ...ACTIVE, equityBps: 0 })).toBe('When you get paid, all of it stays spendable.');
    expect(ruleSentence({ ...ACTIVE, equityBps: 10_000 })).toBe(
      'When you get paid, all of it buys SPY Stock Tokens into your own account.',
    );
  });

  it('says a paused rule leaves new USDG unsorted and spendable, and that nothing splits without a rule', () => {
    expect(ruleSentence({ ...ACTIVE, status: 'PAUSED' })).toBe(
      'Your rule is paused, so new USDG stays unsorted and spendable until you resume it.',
    );
    expect(ruleSentence({ ...ACTIVE, status: 'NONE', version: 0, equityBps: 0 })).toMatch(/^You have no rule yet, so nothing is split\./);
  });
});

describe('failureText', () => {
  it('names the cause the data layer reports', () => {
    expect(failureText(named('PasskeyCancelled'), 'release')).toBe('The passkey prompt closed before you approved it.');
    expect(failureText(named('NotSignedIn'), 'sort')).toBe('You are signed out. Sign in, then try again.');
    expect(failureText(named('SourceUnavailable'), 'sort')).toBe(
      'Sleeve could not reach Robinhood Chain. Try again in a moment.',
    );
    expect(failureText(named('RuleNotActive'), 'sort')).toBe(
      'Your rule is not active, so nothing can be sorted until you resume it.',
    );
  });

  it('tells a release and a sort apart when nothing is waiting any more', () => {
    expect(failureText(named('NothingWaiting'), 'release')).toMatch(/^Nothing is waiting there any more\./);
    expect(failureText(named('NothingWaiting'), 'sort')).toBe('Nothing is waiting to be sorted any more.');
  });

  it('words a removal and a reinstall that did not go through, with what recovers it', () => {
    const notReleased = new DataLayerError({ code: 'UninstallFailed', result: false }, 'released nothing');
    expect(failureText(notReleased, 'remove')).toBe(
      'The module came off your account, but what waited to buy was not released yet. Turning Sleeve back on releases it to spend first.',
    );
    expect(failureText(new DataLayerError({ code: 'UninstallFailed', result: null }, 'no result'), 'remove')).toMatch(/^Sleeve could not confirm the removal/);
    expect(failureText(named('NotInstalled'), 'remove')).toBe('Sleeve is already off for this account.');
    expect(failureText(named('ModuleInstalled'), 'reinstall')).toBe('Sleeve is already on for this account.');
    expect(failureText(named('SponsorshipUnavailable'), 'remove')).toBe(
      "Sleeve's paymaster did not cover this one, and your account holds too little ETH for the network fee.",
    );
  });

  it('asks for another try when the cause is unknown', () => {
    expect(failureText(new Error('socket hang up'), 'release')).toBe('Try again in a moment.');
    expect(failureText(named('NotFound'), 'release')).toBe('Try again in a moment.');
  });
});

describe('signInFailureText', () => {
  it('covers a closed passkey prompt and anything else', () => {
    expect(signInFailureText(named('PasskeyCancelled'))).toMatch(/^Your passkey did not sign you in\./);
    expect(signInFailureText(new Error('offline'))).toBe('Sign in did not go through. Try again in a moment.');
  });
});

describe('copy', () => {
  it('passes the copy lint in every state', () => {
    const texts = [
      ruleSentence(ACTIVE),
      ruleSentence({ ...ACTIVE, equityBps: 0 }),
      ruleSentence({ ...ACTIVE, equityBps: 10_000 }),
      ruleSentence({ ...ACTIVE, status: 'PAUSED' }),
      ruleSentence({ ...ACTIVE, status: 'NONE' }),
      ...(['release', 'sort'] as const).flatMap((action) =>
        (['PasskeyCancelled', 'NotSignedIn', 'SourceUnavailable', 'NothingWaiting', 'RuleNotActive', 'NotFound'] as const).map(
          (code) => failureText(named(code), action),
        ),
      ),
      ...(['remove', 'reinstall'] as const).flatMap((action) =>
        (['NotInstalled', 'ModuleInstalled', 'SponsorshipUnavailable'] as const).map((code) => failureText(named(code), action)),
      ),
      failureText(new DataLayerError({ code: 'UninstallFailed', result: false }, 'released nothing'), 'remove'),
      failureText(new DataLayerError({ code: 'UninstallFailed', result: null }, 'no result'), 'remove'),
      signInFailureText(named('PasskeyCancelled')),
      signInFailureText(new Error('offline')),
    ];
    for (const text of texts) expect(lintText(text), text).toEqual([]);
  });
});
