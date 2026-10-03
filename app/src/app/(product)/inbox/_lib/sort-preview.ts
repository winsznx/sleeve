import type { Rule } from '@sleeve/core';

import type { SplitLegendItem, SplitParts } from '@/components/sleeve/split-rail';
import { reasonSentence, tickerSymbol, usdgExactText } from '@/components/sleeve/text';
import { REASON_LABEL } from '@/components/ui/badge';
import type { SplitPreview } from '@/data/types';

export interface SortForecast {
  parts: SplitParts;
  legend: SplitLegendItem[];
  /** What sorting now would do, in plain words, with what happens next for the equity share. */
  sentence: string;
}

/**
 * What an owner split would do right now, from previewSplit (SPEC 15): the rail, its legend and one plain
 * sentence. The guard can change before the keeper sorts, so every word is about sorting now. Null when the rule
 * is not active or nothing is unsorted.
 */
export function forecastSort(
  preview: SplitPreview,
  rule: Pick<Rule, 'minClip' | 'premiumCapBps'>,
  reopensAt: bigint | null | undefined,
): SortForecast | null {
  const outcome = preview.outcome;
  if (outcome === null || preview.ruleStatus !== 'ACTIVE') return null;
  const symbol = tickerSymbol(preview.tickerId);
  const spend = usdgExactText(preview.spendPart);
  const equity = usdgExactText(preview.equityPart);

  switch (outcome.kind) {
    case 'BUY':
      return {
        parts: { spend: preview.spendPart, equity: preview.equityPart, waiting: 0n },
        legend: [
          { kind: 'spend', amount: preview.spendPart, label: 'stays spendable' },
          { kind: 'equity', amount: preview.equityPart, label: `buys ${symbol}` },
        ],
        sentence: `Sorting now keeps ${spend} spendable and buys ${symbol} with ${equity} if the price is within your cap. If it is not, that part waits as USDG in your account.`,
      };
    case 'QUEUE': {
      const why = outcome.reason === 'NONE' ? 'waits' : `waits: ${REASON_LABEL[outcome.reason].toLowerCase()}`;
      const next = reasonSentence(outcome.reason, {
        symbol,
        reopensAt,
        minClip: rule.minClip,
        premiumCapBps: rule.premiumCapBps,
      });
      return {
        parts: { spend: preview.spendPart, equity: 0n, waiting: preview.equityPart },
        legend: [
          { kind: 'spend', amount: preview.spendPart, label: 'stays spendable' },
          { kind: 'waiting', amount: preview.equityPart, label: why },
        ],
        sentence: `Sorting now keeps ${spend} spendable and sets ${equity} aside to buy ${symbol}, held as USDG in your account. ${next}`.trim(),
      };
    }
    case 'REFUSE':
      return {
        parts: { spend: preview.unsorted, equity: 0n, waiting: 0n },
        legend: [{ kind: 'spend', amount: preview.unsorted, label: 'stays spendable' }],
        sentence:
          outcome.status === 'REFUSED_ACCOUNT'
            ? `Sorting now keeps all of it spendable. The issuer's blocklist includes this account, so the ${equity} equity share goes to spend too.`
            : `Sorting now keeps all of it spendable. ${symbol} cannot be bought through Sleeve right now, so the ${equity} equity share goes to spend too.`,
      };
  }
}
