import { describe, expect, it } from 'vitest';
import { RULE_DEFAULTS, validateRuleInput } from './rule';
import type { RuleInput } from './spec';
import { LAUNCH_TICKERS } from './tickers';

const ACTIVE = LAUNCH_TICKERS.map((ticker) => ticker.id);

function input(overrides: Partial<RuleInput> = {}): RuleInput {
  return { ...RULE_DEFAULTS, ...overrides };
}

describe('validateRuleInput', () => {
  it('accepts the product default, 10 percent to SPY', () => {
    expect(validateRuleInput(input(), ACTIVE)).toEqual([]);
  });

  it('accepts the edges of every owner range', () => {
    expect(
      validateRuleInput(
        input({ spendBps: 10_000, equityBps: 0, premiumCapBps: 0, slippageBps: 500, minClip: 1_000_000n }),
        ACTIVE,
      ),
    ).toEqual([]);
    expect(validateRuleInput(input({ spendBps: 0, equityBps: 10_000, premiumCapBps: 500 }), ACTIVE)).toEqual([]);
  });

  it('refuses shares that do not sum to 10,000 (I9)', () => {
    expect(validateRuleInput(input({ spendBps: 9_000, equityBps: 1_001 }), ACTIVE)).toEqual(['SharesSumNotTotal']);
  });

  it('refuses fractional or negative basis points before any sum', () => {
    expect(validateRuleInput(input({ spendBps: 8_999.5, equityBps: 1_000.5 }), ACTIVE)).toEqual(['BpsNotWhole']);
    expect(validateRuleInput(input({ slippageBps: -1 }), ACTIVE)).toEqual(['BpsNotWhole']);
  });

  it('refuses caps outside 0 to 500 bps (B2-5)', () => {
    expect(validateRuleInput(input({ premiumCapBps: 501 }), ACTIVE)).toEqual(['PremiumCapOutOfRange']);
    expect(validateRuleInput(input({ slippageBps: 501 }), ACTIVE)).toEqual(['SlippageOutOfRange']);
  });

  it('refuses a clip under 1 USDG', () => {
    expect(validateRuleInput(input({ minClip: 999_999n }), ACTIVE)).toEqual(['MinClipBelowFloor']);
  });

  it('refuses a ticker TokenSource does not list as active', () => {
    expect(validateRuleInput(input({ tickerId: 4 }), ACTIVE)).toEqual(['TickerNotActive']);
    expect(validateRuleInput(input({ tickerId: 0 }), [1, 2, 3])).toEqual(['TickerNotActive']);
  });

  it('reports every problem at once', () => {
    expect(
      validateRuleInput(input({ equityBps: 2_000, premiumCapBps: 900, tickerId: 9, minClip: 0n }), ACTIVE),
    ).toEqual(['SharesSumNotTotal', 'PremiumCapOutOfRange', 'TickerNotActive', 'MinClipBelowFloor']);
  });
});
