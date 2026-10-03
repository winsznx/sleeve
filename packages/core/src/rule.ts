import { TOTAL_BPS } from './chain';
import type { RuleInput, TickerId } from './spec';

/** Product defaults (PRD 7.3, D-014): 10 percent to SPY, 100 bps premium cap, 50 bps slippage, 25 USDG clip. */
export const RULE_DEFAULTS = {
  spendBps: 9_000,
  equityBps: 1_000,
  tickerId: 0,
  premiumCapBps: 100,
  slippageBps: 50,
  minClip: 25_000_000n,
} as const satisfies RuleInput;

/** Owner-editable ranges from B2-5 and the sell override from B2-14. */
export const RULE_LIMITS = {
  premiumCapBps: { min: 0, max: 500 },
  slippageBps: { min: 0, max: 500 },
  /** 1 USDG in base units. */
  minClipFloor: 1_000_000n,
  /** A sell override may widen the discount cap up to this for one sell. */
  sellOverrideCapBpsMax: 500,
} as const;

/**
 * Why a RuleInput would fail setRule. SharesSumNotTotal is LedgerMath's error name; the others name the
 * SPEC 6 checks until the module ABI fixes its own error names.
 */
export type RuleInputIssue =
  | 'BpsNotWhole'
  | 'SharesSumNotTotal'
  | 'TickerNotActive'
  | 'PremiumCapOutOfRange'
  | 'SlippageOutOfRange'
  | 'MinClipBelowFloor';

const UINT16_MAX = 65_535;

function isUint16(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= UINT16_MAX;
}

function inRange(value: number, range: { min: number; max: number }): boolean {
  return value >= range.min && value <= range.max;
}

/** The checks setRule runs (SPEC 6), in a form the rule editor can show before the owner signs. */
export function validateRuleInput(input: RuleInput, activeTickerIds: readonly TickerId[]): RuleInputIssue[] {
  const issues: RuleInputIssue[] = [];
  const bpsFields = [input.spendBps, input.equityBps, input.premiumCapBps, input.slippageBps];
  if (!bpsFields.every(isUint16)) {
    issues.push('BpsNotWhole');
  } else {
    if (input.spendBps + input.equityBps !== TOTAL_BPS) issues.push('SharesSumNotTotal');
    if (!inRange(input.premiumCapBps, RULE_LIMITS.premiumCapBps)) issues.push('PremiumCapOutOfRange');
    if (!inRange(input.slippageBps, RULE_LIMITS.slippageBps)) issues.push('SlippageOutOfRange');
  }
  if (!activeTickerIds.includes(input.tickerId)) issues.push('TickerNotActive');
  if (input.minClip < RULE_LIMITS.minClipFloor) issues.push('MinClipBelowFloor');
  return issues;
}
