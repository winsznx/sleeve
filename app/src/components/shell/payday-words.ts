import type { Reason } from '@sleeve/core';

import { percentWords } from '@/components/sleeve/text';

import type { PaydayOutcome } from './payday-preview';
import { newYorkShort } from './time-words';

/**
 * The words for what a payment arriving now would do with its equity share. Plain, specific, and never a promise
 * about the fill: the preview reads the pool quote, the real split reads the real fill.
 */

const WAITS_BECAUSE: Record<Exclude<Reason, 'NONE' | 'SESSION' | 'PREMIUM'>, string> = {
  PAUSED: 'the issuer has paused the token',
  ORACLE_PAUSED: 'price updates are paused',
  MULTIPLIER: 'a corporate action is due within a day',
  STALE: 'the market reference is waiting for a fresh price',
  DEPEG: 'USDG is away from 1 US dollar',
  CLIP: 'it is below the minimum buy',
};

/** The equity line under the amount: "would buy SPY now", "would wait as USDG until Sun 4 Oct, 20:00". */
export function equityLine(outcome: PaydayOutcome, symbol: string, capBps: number): string {
  switch (outcome.kind) {
    case 'buys':
      return `would buy ${symbol} now`;
    case 'refused':
      return `would stay spendable: ${symbol} is not on the ticker list`;
    case 'waits':
      if (outcome.reason === 'SESSION') {
        return outcome.until === null
          ? 'would wait as USDG until the market opens'
          : `would wait as USDG until ${newYorkShort(outcome.until)} New York time`;
      }
      if (outcome.reason === 'PREMIUM') return `would wait: the pool is more than ${percentWords(capBps)} above the reference`;
      return `would wait as USDG: ${WAITS_BECAUSE[outcome.reason]}`;
  }
}

/** One sentence for the markets panel and the menu footers. */
export function verdictSentence(outcome: PaydayOutcome | null, symbol: string, capBps: number): string {
  if (outcome === null) return 'A payment that arrives now stays spendable in full.';
  switch (outcome.kind) {
    case 'buys':
      return `A payment that arrives now buys ${symbol} with its equity share: the pool is within the ${percentWords(capBps)} cap.`;
    case 'refused':
      return `A payment that arrives now stays spendable in full: ${symbol} is not on the ticker list.`;
    case 'waits':
      if (outcome.reason === 'SESSION') {
        return `A payment that arrives now keeps its equity share as USDG and buys ${symbol} at the open.`;
      }
      if (outcome.reason === 'PREMIUM') {
        return `A payment that arrives now keeps its equity share as USDG: the pool is more than ${percentWords(capBps)} above the reference.`;
      }
      return `A payment that arrives now keeps its equity share as USDG: ${WAITS_BECAUSE[outcome.reason]}.`;
  }
}
