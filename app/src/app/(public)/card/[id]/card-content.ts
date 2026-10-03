import { TOTAL_BPS, formatBps, shortAddress } from '@sleeve/core';

import { tickerSymbol, tokenText, usdgText } from '@/components/sleeve/text';
import { formatUtcDate } from '@/components/ui/format-time';
import type { CardData } from '@/data/types';
import { BRAND_NAME, DEBT_SECURITY_LINE, DISCLAIMER } from '@/lib/copy';

/**
 * What a shared card says (PRD 7.10), worked out once so the PNG and its text alternative never disagree. By
 * default a card carries the ticker, the share of pay, the date and the debt security line. Amounts appear only
 * when the owner chose them, receipt numbers and the account only with proof. The date is the day, never the
 * time: a ticker and an exact second would be enough to find the buy onchain.
 */

export interface CardProofLines {
  /** "Receipt 455", or "Receipts 455, 560 and 611". */
  receipts: string;
  /** "Account 0x3efE…9b36". */
  account: string;
  /** Where to recompute: "sleeve.example/verify/455". */
  verify: string;
  receiptIds: readonly bigint[];
}

export interface CardContent {
  kind: CardData['kind'];
  brand: string;
  /** "22 Sep 2026" or "Week of 21 Sep 2026". */
  dateLine: string;
  /** The share of pay: "10%". */
  figure: string;
  /** Under the figure: "of my pay became SPY". */
  headline: string;
  /** Week cards: how many paydays split and what was bought. */
  facts: readonly string[];
  /** The rail, in basis points of pay. */
  equityBps: number;
  spendLabel: string;
  equityLabel: string;
  /** Only when the owner chose to show amounts. */
  amounts: string | null;
  /** Only when the owner turned proof on. */
  proof: CardProofLines | null;
  debtLine: string;
  disclaimer: string;
}

/** Receipt numbers a week card spells out before it says how many more there are. */
const LISTED_RECEIPTS = 6;

/** "SPY", "SPY and QQQ", "SPY, QQQ and NVDA". */
export function joinWords(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

function receiptList(ids: readonly bigint[]): string {
  if (ids.length === 1) return `Receipt ${ids[0]}`;
  const listed = ids.slice(0, LISTED_RECEIPTS).map(String);
  const rest = ids.length - listed.length;
  return rest > 0 ? `Receipts ${listed.join(', ')} and ${rest} more` : `Receipts ${joinWords(listed)}`;
}

function verifyLine(ids: readonly bigint[], host: string | null): string {
  const site = host ?? 'the Sleeve verifier';
  if (ids.length === 1) return host === null ? `Recompute it with ${site}.` : `Recompute it at ${site}/verify/${ids[0]}`;
  return host === null ? `Recompute any of them with ${site}.` : `Recompute any of them at ${site}/verify`;
}

/** `host` is where the card is served, such as "sleeve.example", or null before the page knows it. */
export function cardContent(card: CardData, host: string | null): CardContent {
  const equityBps = Math.min(Math.max(card.equityBps, 0), TOTAL_BPS);
  const spendBps = TOTAL_BPS - equityBps;
  const proof: CardProofLines | null =
    card.proof === null
      ? null
      : {
          receipts: receiptList(card.proof.receiptIds),
          account: `Account ${shortAddress(card.proof.account)}`,
          verify: verifyLine(card.proof.receiptIds, host),
          receiptIds: card.proof.receiptIds,
        };
  const shared = {
    brand: BRAND_NAME,
    figure: formatBps(equityBps),
    equityBps,
    proof,
    debtLine: DEBT_SECURITY_LINE,
    disclaimer: DISCLAIMER,
  };

  if (card.kind === 'receipt') {
    const symbol = tickerSymbol(card.tickerId);
    const amounts = card.amounts;
    return {
      ...shared,
      kind: 'receipt',
      dateLine: formatUtcDate(card.timestamp),
      headline: `of my pay became ${symbol}`,
      facts: [],
      spendLabel: `${formatBps(spendBps)} stayed spendable`,
      equityLabel: `${formatBps(equityBps)} became ${symbol}`,
      amounts:
        amounts === null
          ? null
          : card.status === 'SETTLED'
            ? `${usdgText(amounts.usdgSpent)} waited as USDG, then became ${tokenText(amounts.tokensOut, symbol)}.`
            : `${usdgText(amounts.usdgIn)} arrived. ${usdgText(amounts.usdgSpent)} of it became ${tokenText(amounts.tokensOut, symbol)}.`,
    };
  }

  const bought = card.tickerIds.map(tickerSymbol);
  return {
    ...shared,
    kind: 'week',
    dateLine: `Week of ${formatUtcDate(card.weekStart)}`,
    headline: 'of my pay goes to Stock Tokens',
    facts: [
      `${card.paydays} ${card.paydays === 1 ? 'payday' : 'paydays'} split this week`,
      bought.length === 0 ? 'Nothing bought this week' : `Bought ${joinWords(bought)}`,
    ],
    spendLabel: `${formatBps(spendBps)} stays spendable`,
    equityLabel: `${formatBps(equityBps)} for Stock Tokens`,
    amounts:
      card.amounts === null
        ? null
        : `${usdgText(card.amounts.usdgIn)} arrived this week. ${usdgText(card.amounts.usdgBought)} bought Stock Tokens.`,
  };
}

/** Everything the image says, in reading order, as one text alternative. */
export function cardAltText(content: CardContent): string {
  const sentence = (text: string): string => (/[.!?]$/.test(text) ? text : `${text}.`);
  return [
    `${content.brand} card, ${content.dateLine}`,
    `${content.figure} ${content.headline}`,
    content.debtLine,
    ...content.facts,
    `${content.spendLabel}, ${content.equityLabel}`,
    ...(content.amounts === null ? [] : [content.amounts]),
    ...(content.proof === null ? [] : [content.proof.receipts, content.proof.account, content.proof.verify]),
  ]
    .map(sentence)
    .join(' ');
}

/** sleeve-receipt-card.png or sleeve-week-card.png. */
export function cardFileName(content: CardContent): string {
  return `sleeve-${content.kind}-card.png`;
}
