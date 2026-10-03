import { RULE_DEFAULTS, type Rule } from '@sleeve/core';
import { describe, expect, it } from 'vitest';

import { DataLayerError } from '@/data/errors';

import { lintText } from '../../../../../../scripts/copy-lint.mjs';
import { draftFrom, draftInput, minClipProblemText, parseMinClip, ruleChanges, worstCaseLine } from './rule-draft';
import { ruleFailureText } from './rule-failure';

const ACTIVE: Rule = { version: 2, status: 'ACTIVE', equityBps: 1_000, tickerId: 0, premiumCapBps: 100, slippageBps: 50, minClip: 25_000_000n };

describe('draftFrom', () => {
  it('starts from the product defaults when no rule exists (D-014), and from the rule when one does', () => {
    expect(draftFrom(null)).toEqual({ tickerId: 0, equityBps: 1_000, premiumCapBps: 100, slippageBps: 50, minClipText: '25' });
    expect(draftFrom({ ...ACTIVE, status: 'NONE' })).toEqual(draftFrom(null));
    expect(draftFrom({ ...ACTIVE, tickerId: 1, minClip: 12_500_000n }).minClipText).toBe('12.5');
  });
});

describe('draftInput', () => {
  it('builds what setRule takes, with spend and equity summing to the whole (I9)', () => {
    const result = draftInput({ ...draftFrom(null), equityBps: 2_500 });
    expect(result).toEqual({ ok: true, input: { ...RULE_DEFAULTS, spendBps: 7_500, equityBps: 2_500 } });
  });

  it('refuses a minimum buy under 1 USDG, an empty one and one with too many places', () => {
    expect(parseMinClip('0.5')).toEqual({ ok: false, problem: 'BELOW_FLOOR' });
    expect(parseMinClip('')).toEqual({ ok: false, problem: 'EMPTY' });
    expect(parseMinClip('1.0000001')).toEqual({ ok: false, problem: 'TOO_MANY_DECIMALS' });
    expect(parseMinClip('abc')).toEqual({ ok: false, problem: 'NOT_A_NUMBER' });
    expect(parseMinClip('1')).toEqual({ ok: true, value: 1_000_000n });
    expect(draftInput({ ...draftFrom(null), minClipText: '0.99' })).toEqual({ ok: false, problem: 'BELOW_FLOOR' });
    expect(minClipProblemText('BELOW_FLOOR')).toBe('The minimum buy is at least 1 USDG.');
  });
});

describe('ruleChanges', () => {
  it('lists each change in words, old to new, and nothing when nothing changed', () => {
    expect(ruleChanges(ACTIVE, { ...RULE_DEFAULTS })).toEqual([]);
    expect(ruleChanges(ACTIVE, { ...RULE_DEFAULTS, tickerId: 1, spendBps: 8_000, equityBps: 2_000, premiumCapBps: 50, minClip: 10_000_000n })).toEqual([
      { id: 'ticker', label: 'Stock Token', from: 'SPY', to: 'QQQ' },
      { id: 'share', label: 'Part of each payment', from: '10%', to: '20%' },
      { id: 'premium', label: 'Premium cap', from: '1.00%', to: '0.50%' },
      { id: 'clip', label: 'Minimum buy', from: '25.00 USDG', to: '10.00 USDG' },
    ]);
  });
});

describe('worstCaseLine', () => {
  it('adds about 0.5 percent of feed lag to the cap and prices it on the equity share (PRD 7.4)', () => {
    const line = worstCaseLine(100, 50_000_000n);
    expect(line).toBe(
      'The Chainlink reference can trail the live price by about 0.5 percent, so with a 1.00 percent cap a buy can pay up to about 1.50 percent above the live price: about 0.75 USDG on a 50.00 USDG equity share.',
    );
    expect(lintText(line)).toEqual([]);
    expect(worstCaseLine(0, 50_000_000n)).toContain('up to about 0.50 percent above the live price: about 0.25 USDG');
  });
});

describe('ruleFailureText', () => {
  it('names a closed passkey prompt and an unreachable chain, and says nothing changed', () => {
    expect(ruleFailureText(new DataLayerError({ code: 'PasskeyCancelled' }, 'closed'))).toBe(
      'The passkey prompt closed before you approved it. Nothing changed.',
    );
    expect(ruleFailureText(new DataLayerError({ code: 'SourceUnavailable' }, 'down'))).toBe(
      'Sleeve could not reach Robinhood Chain. Try again in a moment.',
    );
    expect(ruleFailureText(new Error('anything'))).toBe('Try again in a moment.');
  });
});
