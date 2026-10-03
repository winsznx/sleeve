import { PUBLIC_RPC_URL } from '@sleeve/core';
import { describe, expect, it } from 'vitest';

import type { VerifyCheck } from '@/data/types';

import { failingChecks, providerSentence, shownValue } from './verify-values';

describe('shownValue', () => {
  it('adds a readable form beside the raw value for units that have one', () => {
    expect(shownValue('usdg', '93725000')).toEqual({ readable: '93.725 USDG', raw: '93725000' });
    expect(shownValue('token', '155872000000000000')).toEqual({ readable: '0.155872 tokens', raw: '155872000000000000' });
    expect(shownValue('feed', '76955120477')).toEqual({ readable: '769.55120477 USD', raw: '76955120477' });
    expect(shownValue('multiplier', '1001717991187472003').readable).toBe('1.001717991187472003');
    expect(shownValue('timestamp', '1790445600').readable).toBe('26 Sep 2026, 18:00 UTC');
  });

  it('keeps the sign of basis points and the singular', () => {
    expect([shownValue('bps', '-9').readable, shownValue('bps', '1').readable, shownValue('bps', '100').readable]).toEqual([
      '-9 basis points',
      '1 basis point',
      '100 basis points',
    ]);
  });

  it('shows hashes, addresses and blocks only as reported', () => {
    const hash = `0x${'ab'.repeat(32)}`;
    expect(shownValue('hash', hash)).toEqual({ readable: null, raw: hash });
    expect(shownValue('block', '73280794')).toEqual({ readable: null, raw: '73280794' });
  });

  it('never coerces a value that is not the integer its unit expects', () => {
    expect(shownValue('usdg', 'missing')).toEqual({ readable: null, raw: 'missing' });
    expect(shownValue('feed', '12.5')).toEqual({ readable: null, raw: '12.5' });
  });
});

describe('verify helpers', () => {
  it('picks out the checks that differ', () => {
    const check = (id: string, ok: boolean): VerifyCheck => ({ id, label: id, unit: 'text', source: 'test', expected: 'a', actual: ok ? 'a' : 'b', ok });
    expect(failingChecks([check('one', true), check('two', false), check('three', false)]).map((item) => item.id)).toEqual(['two', 'three']);
  });

  it('names the public RPC and says it is not the keeper provider', () => {
    expect(providerSentence(PUBLIC_RPC_URL)).toBe("This is the public Robinhood Chain RPC, a different provider from the one Sleeve's keeper uses.");
    expect(providerSentence('https://example.org/rpc')).toBe("This is a different provider from the one Sleeve's keeper uses.");
  });
});
