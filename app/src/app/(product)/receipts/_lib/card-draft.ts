import type { Address, Status, TickerId } from '@sleeve/core';

import type { CreateCardInput, ReceiptCard, ReceiptRecord, WeekCard } from '@/data/types';

import { weekEndOf } from './week';

/**
 * What a card would hold if the owner made it now (PRD 7.10), worked out from receipts the composer has already read,
 * so its preview follows every toggle at once without writing anything. The rules are the data layer's for
 * createCard (src/data/types.ts, CardData): a payday card is one buy and the share of pay of the rule version it ran
 * under; a week card counts the week's splits and buys from Monday 00:00 New York time. card-draft.test.ts checks
 * that each draft equals the card the sample data layer makes.
 */

export interface CardChoices {
  showAmounts: boolean;
  showProof: boolean;
}

/** Statuses a split writes: each is one payday. */
const SPLIT_STATUSES = new Set<Status>(['FILLED', 'QUEUED', 'REFUSED_TICKER', 'REFUSED_ACCOUNT']);
/** Statuses that bought a Stock Token. A payday card shows one of these. */
const BUY_STATUSES = new Set<Status>(['FILLED', 'SETTLED']);

/** The payday card a buy would make, or null for a receipt that bought nothing. */
export function draftPaydayCard(record: ReceiptRecord, ruleEquityBps: number, choices: CardChoices): ReceiptCard | null {
  const { receipt } = record;
  if (receipt.status !== 'FILLED' && receipt.status !== 'SETTLED') return null;
  return {
    kind: 'receipt',
    cardId: '',
    tickerId: receipt.tickerId,
    status: receipt.status,
    equityBps: record.derived.rule?.equityBps ?? ruleEquityBps,
    timestamp: receipt.timestamp,
    amounts: choices.showAmounts ? { usdgIn: receipt.usdgIn, usdgSpent: receipt.usdgSpent, tokensOut: receipt.tokensOut } : null,
    proof: choices.showProof ? { receiptIds: [receipt.id], account: receipt.account } : null,
  };
}

/** Receipts read for a week card: newest first, and whether every older one was read too. */
export interface WeekReceipts {
  records: readonly ReceiptRecord[];
  exhausted: boolean;
}

/**
 * The week card a week of the account's receipts would make. Null while the receipts read so far may not reach the
 * start of the week, because a draft missing a payday would show a different card from the one made.
 */
export function draftWeekCard(
  receipts: WeekReceipts,
  account: Address,
  weekStart: bigint,
  ruleEquityBps: number,
  choices: CardChoices,
): WeekCard | null {
  const reachesBack = receipts.exhausted || receipts.records.some(({ receipt }) => receipt.timestamp < weekStart);
  if (!reachesBack) return null;
  const weekEnd = weekEndOf(weekStart);
  const owner = account.toLowerCase();
  const inWeek = receipts.records.filter(
    ({ receipt }) => receipt.account.toLowerCase() === owner && receipt.timestamp >= weekStart && receipt.timestamp < weekEnd,
  );
  const splits = inWeek.filter(({ receipt }) => SPLIT_STATUSES.has(receipt.status));
  const buys = inWeek.filter(({ receipt }) => BUY_STATUSES.has(receipt.status));
  const counted = [...splits, ...buys];
  const latest = [...counted].sort((a, b) => (a.receipt.id < b.receipt.id ? 1 : -1))[0];
  const tickerIds = [...new Set<TickerId>(buys.map(({ receipt }) => receipt.tickerId))].sort((a, b) => a - b);
  const receiptIds = [...new Set(counted.map(({ receipt }) => receipt.id))].sort((a, b) => (a < b ? -1 : 1));
  return {
    kind: 'week',
    cardId: '',
    weekStart,
    weekEnd,
    paydays: splits.length,
    tickerIds,
    equityBps: latest?.derived.rule?.equityBps ?? ruleEquityBps,
    amounts: choices.showAmounts
      ? {
          usdgIn: splits.reduce((total, { receipt }) => total + receipt.usdgIn, 0n),
          usdgBought: buys.reduce((total, { receipt }) => total + receipt.usdgSpent, 0n),
        }
      : null,
    proof: choices.showProof ? { receiptIds, account } : null,
  };
}

/** The data layer's input for the card the composer shows. Null until a week is chosen. */
export function cardInputOf(
  subject: { kind: 'receipt'; receiptId: bigint } | { kind: 'week'; account: Address },
  weekStart: bigint | null,
  choices: CardChoices,
): CreateCardInput | null {
  if (subject.kind === 'receipt') return { subject: { kind: 'receipt', receiptId: subject.receiptId }, ...choices };
  return weekStart === null ? null : { subject: { kind: 'week', weekStart }, ...choices };
}
