import {
  formatBps,
  formatUsdg,
  LAUNCH_TICKERS,
  parseUsdg,
  RULE_DEFAULTS,
  RULE_LIMITS,
  TOTAL_BPS,
  validateRuleInput,
  type Rule,
  type RuleInput,
  type TickerId,
} from '@sleeve/core';

import { percentWords, tickerSymbol } from '@/components/sleeve/text';

/**
 * The rule editor's draft and its words (PRD 7.3 and 7.4, SPEC 6, D-014). The draft holds what the person is choosing;
 * the input is what setRule takes, checked with the same validation the module runs. Every percent shown is basis
 * points under the hood.
 */

export interface RuleDraft {
  tickerId: TickerId;
  /** Basis points of every payment that buys the Stock Token. */
  equityBps: number;
  premiumCapBps: number;
  slippageBps: number;
  /** The minimum buy as typed, in USDG. */
  minClipText: string;
}

/** Share presets, in basis points. 10 percent is the product default (PRD 7.3). */
export const SHARE_PRESETS = [500, 1_000, 2_000, 5_000] as const;

/** PRD 7.4: in session the feed can trail the live price by up to about 0.5 percent, so the cap gains that much. */
export const FEED_TRAIL_BPS = 50;

/** The tickers that track a broad fund rather than one company. The suggestion is always one of these (PRD 7.3). */
const BROAD_FUNDS = new Set<TickerId>([0, 1]);

export function isBroadFund(tickerId: TickerId): boolean {
  return BROAD_FUNDS.has(tickerId);
}

/** The ticker Sleeve suggests: SPY, a broad fund, never a single company (PRD 7.3). */
export const SUGGESTED_TICKER: TickerId = RULE_DEFAULTS.tickerId;

export function draftFrom(rule: Rule | null): RuleDraft {
  const base = rule === null || rule.status === 'NONE' ? RULE_DEFAULTS : rule;
  return {
    tickerId: base.tickerId,
    equityBps: base.equityBps,
    premiumCapBps: base.premiumCapBps,
    slippageBps: base.slippageBps,
    minClipText: formatUsdg(base.minClip, { minFractionDigits: 0, maxFractionDigits: 6, grouping: false }),
  };
}

export type MinClipProblem = 'EMPTY' | 'NOT_A_NUMBER' | 'TOO_MANY_DECIMALS' | 'BELOW_FLOOR';

/** The minimum buy in USDG base units, or why the text is not one. */
export function parseMinClip(text: string): { ok: true; value: bigint } | { ok: false; problem: MinClipProblem } {
  const parsed = parseUsdg(text);
  if (!parsed.ok) return { ok: false, problem: parsed.error === 'NEGATIVE' ? 'NOT_A_NUMBER' : parsed.error };
  if (parsed.value < RULE_LIMITS.minClipFloor) return { ok: false, problem: 'BELOW_FLOOR' };
  return { ok: true, value: parsed.value };
}

export function minClipProblemText(problem: MinClipProblem): string {
  switch (problem) {
    case 'EMPTY':
      return 'Enter a minimum buy of at least 1 USDG.';
    case 'NOT_A_NUMBER':
      return 'Enter a number of USDG, such as 25.';
    case 'TOO_MANY_DECIMALS':
      return 'USDG has six decimal places at most.';
    case 'BELOW_FLOOR':
      return 'The minimum buy is at least 1 USDG.';
  }
}

/** The setRule input for a draft, checked as the module checks it, or the problem with the minimum buy. */
export function draftInput(draft: RuleDraft): { ok: true; input: RuleInput } | { ok: false; problem: MinClipProblem } {
  const clip = parseMinClip(draft.minClipText);
  if (!clip.ok) return clip;
  const input: RuleInput = {
    spendBps: TOTAL_BPS - draft.equityBps,
    equityBps: draft.equityBps,
    tickerId: draft.tickerId,
    premiumCapBps: draft.premiumCapBps,
    slippageBps: draft.slippageBps,
    minClip: clip.value,
  };
  const issues = validateRuleInput(
    input,
    LAUNCH_TICKERS.map((ticker) => ticker.id),
  );
  if (issues.includes('MinClipBelowFloor')) return { ok: false, problem: 'BELOW_FLOOR' };
  return { ok: true, input };
}

export interface RuleChange {
  id: 'ticker' | 'share' | 'premium' | 'slippage' | 'clip';
  label: string;
  from: string;
  to: string;
}

function percent(bps: number): string {
  return formatBps(bps, { minFractionDigits: 2 });
}

/** What saving would change, in words, against the rule as it stands. Empty when nothing changes. */
export function ruleChanges(current: Rule, input: RuleInput): RuleChange[] {
  const changes: RuleChange[] = [];
  if (current.tickerId !== input.tickerId) {
    changes.push({ id: 'ticker', label: 'Stock Token', from: tickerSymbol(current.tickerId), to: tickerSymbol(input.tickerId) });
  }
  if (current.equityBps !== input.equityBps) {
    changes.push({ id: 'share', label: 'Part of each payment', from: formatBps(current.equityBps), to: formatBps(input.equityBps) });
  }
  if (current.premiumCapBps !== input.premiumCapBps) {
    changes.push({ id: 'premium', label: 'Premium cap', from: percent(current.premiumCapBps), to: percent(input.premiumCapBps) });
  }
  if (current.slippageBps !== input.slippageBps) {
    changes.push({ id: 'slippage', label: 'Slippage cap', from: percent(current.slippageBps), to: percent(input.slippageBps) });
  }
  if (current.minClip !== input.minClip) {
    changes.push({ id: 'clip', label: 'Minimum buy', from: `${formatUsdg(current.minClip)} USDG`, to: `${formatUsdg(input.minClip)} USDG` });
  }
  return changes;
}

/**
 * The cap's worst case against the live price (PRD 7.4), in percent and in USDG on a given equity share: the cap
 * plus about 0.5 percent of feed lag.
 */
export function worstCaseLine(capBps: number, equityPart: bigint): string {
  const worst = capBps + FEED_TRAIL_BPS;
  const usdg = (equityPart * BigInt(worst)) / BigInt(TOTAL_BPS);
  return `The Chainlink reference can trail the live price by about 0.5 percent, so with a ${percentWords(capBps)} cap a buy can pay up to about ${percentWords(worst)} above the live price: about ${formatUsdg(usdg)} USDG on a ${formatUsdg(equityPart)} USDG equity share.`;
}
