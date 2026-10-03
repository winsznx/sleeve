import { EXPECTED_DECIMALS, formatStockToken, formatUnits, shortAddress, type Receipt, type Status } from '@sleeve/core';

import { tickerSymbol } from '@/components/sleeve/text';
import { STATUS_TONE, type BadgeTone } from '@/components/ui/badge';
import { formatUtcDate } from '@/components/ui/format-time';
import type { ReceiptRecord } from '@/data/types';

/**
 * What one action did, in the words the product leads with (D-024): a payday arrives and splits into spendable
 * USDG and a Stock Token, or its equity share waits as USDG. The onchain receipt stays behind these words, on the
 * details page's proof section. Every string is built from the receipt's own numbers, so the words never drift
 * from the record.
 */

/** "1,200", "937.25", "93.725": every digit the receipt holds, without padding zeros, for titles. */
export function usdgWords(amount: bigint): string {
  return formatUnits(amount, EXPECTED_DECIMALS.USDG, { minFractionDigits: 0 });
}

/** A number sign and the id: how an action is numbered wherever it is listed. The number is the receipt id onchain. */
export function actionNumber(id: bigint): string {
  return `#${id.toString()}`;
}

/** The statuses that record a payday being split by the rule. */
const SPLIT_STATUSES = new Set<Status>(['FILLED', 'QUEUED', 'REFUSED_TICKER', 'REFUSED_ACCOUNT']);

export function isPaydaySplit(status: Status): boolean {
  return SPLIT_STATUSES.has(status);
}

/**
 * A refusal written by a settle: the guard refused a bucket that was waiting, and the bucket went to spend. A split's
 * refusal carries no queuedSince. Settle and release receipts leave usdgIn zero onchain and carry what they moved to
 * spend as usdgToSpend (contracts/src/interfaces/ISleeveModule.sol, Receipt), so the words read that field.
 */
export function isSettleRefusal(receipt: Receipt): boolean {
  return (receipt.status === 'REFUSED_TICKER' || receipt.status === 'REFUSED_ACCOUNT') && receipt.queuedSince > 0n;
}

/**
 * A correction of one lot: Stock Tokens left the account outside Sleeve, so reconcileLots trimmed the lot to the
 * balance, oldest lot first, and nothing moved. It carries the lot and the tokens trimmed as tokensIn, and no USDG; a
 * split's correction carries no lot (ISleeveModule.sol, Receipt).
 */
export function isLotCorrection(receipt: Receipt): boolean {
  return receipt.status === 'RECONCILED' && receipt.lotId > 0n;
}

/**
 * The details page title: what happened, with the amounts, as D-024 words it.
 * "1,200 USDG payday: 1,080 stayed spendable, 120 became SPY".
 */
export function actionTitle(record: ReceiptRecord): string {
  const r = record.receipt;
  const symbol = tickerSymbol(r.tickerId);
  const payday = `${usdgWords(r.usdgIn)} USDG payday`;
  switch (r.status) {
    case 'FILLED':
      return r.usdgToSpend === 0n
        ? `${payday}: all of it became ${symbol}`
        : `${payday}: ${usdgWords(r.usdgToSpend)} stayed spendable, ${usdgWords(r.usdgSpent)} became ${symbol}`;
    case 'QUEUED':
      return r.usdgToSpend === 0n
        ? `${payday}: all of it waits to buy ${symbol}`
        : `${payday}: ${usdgWords(r.usdgToSpend)} stayed spendable, ${usdgWords(r.usdgQueued)} waits to buy ${symbol}`;
    case 'REFUSED_TICKER':
    case 'REFUSED_ACCOUNT':
      return isSettleRefusal(r)
        ? `${usdgWords(r.usdgToSpend)} USDG waiting for ${symbol} went to spend when the buy was refused`
        : `${payday}: all of it stayed spendable`;
    case 'SETTLED':
      return `${usdgWords(r.usdgSpent)} USDG that waited became ${symbol}`;
    case 'RELEASED':
      return `${usdgWords(r.usdgToSpend)} USDG waiting for ${symbol} moved to spend`;
    case 'PART_SOLD':
    case 'SOLD':
      return `Sold ${formatStockToken(r.tokensIn)} ${symbol} for ${usdgWords(r.usdgOut)} USDG`;
    case 'RECONCILED': {
      if (isLotCorrection(r)) return `Lot ${r.lotId.toString()} trimmed by ${formatStockToken(r.tokensIn)} ${symbol} to match the balance`;
      const shortfall = record.reconciliation?.shortfall;
      return shortfall === undefined || shortfall === 0n
        ? 'Ledgers corrected to match the balance'
        : `Ledgers lowered by ${usdgWords(shortfall)} USDG to match the balance`;
    }
  }
}

/** A short name for an action in a list: "Payday split", "Sold QQQ". */
export function actionLabel(record: ReceiptRecord): string {
  const r = record.receipt;
  const symbol = tickerSymbol(r.tickerId);
  switch (r.status) {
    case 'FILLED':
    case 'QUEUED':
    case 'REFUSED_TICKER':
    case 'REFUSED_ACCOUNT':
      return isSettleRefusal(r) ? 'Waiting USDG moved to spend' : 'Payday split';
    case 'SETTLED':
      return `Bought ${symbol} after waiting`;
    case 'RELEASED':
      return 'Waiting USDG moved to spend';
    case 'PART_SOLD':
    case 'SOLD':
      return `Sold ${symbol}`;
    case 'RECONCILED':
      return isLotCorrection(r) ? 'Lot corrected' : 'Ledgers corrected';
  }
}

/**
 * Where an action's money came from, as the quiet line under its name: who paid, which lot was sold, how long the
 * USDG waited. Senders come from Transfer logs, so a screen that shows them as facts labels them derived.
 */
export function actionSource(record: ReceiptRecord): string | null {
  const r = record.receipt;
  const inbound = record.derived.inbound;
  switch (r.status) {
    case 'FILLED':
    case 'QUEUED':
    case 'REFUSED_TICKER':
    case 'REFUSED_ACCOUNT': {
      if (isSettleRefusal(r)) return `was waiting to buy ${tickerSymbol(r.tickerId)}`;
      const first = inbound[0];
      if (first === undefined) return null;
      return inbound.length === 1 ? `from ${shortAddress(first.from)}` : `from ${inbound.length} payments`;
    }
    case 'SETTLED':
      return r.queuedSince > 0n ? `waited since ${formatUtcDate(r.queuedSince)}` : 'waited as USDG';
    case 'RELEASED':
      return `was waiting to buy ${tickerSymbol(r.tickerId)}`;
    case 'PART_SOLD':
    case 'SOLD':
      return r.lotId === 0n ? null : `from lot ${r.lotId.toString()}`;
    case 'RECONCILED':
      return isLotCorrection(r) ? `${tickerSymbol(r.tickerId)} left outside Sleeve` : 'USDG left outside Sleeve';
  }
}

/**
 * Status in plain words, one per onchain status, so a filter chip and the chip on a row always read the same. The
 * onchain names stay in the proof section and the CSV.
 */
export const STATUS_WORDS: Record<Status, string> = {
  FILLED: 'Bought',
  SETTLED: 'Bought after waiting',
  QUEUED: 'Waiting',
  RELEASED: 'Moved to spend',
  SOLD: 'Sold',
  PART_SOLD: 'Sold part of lot',
  REFUSED_TICKER: 'Not on the allowlist',
  REFUSED_ACCOUNT: 'Account blocked',
  RECONCILED: 'Corrected',
};

/** The tone of each status (docs/DESIGN.md 12.3): bought green, waiting amber, refused red, the rest neutral. */
export function statusTone(status: Status): BadgeTone {
  return STATUS_TONE[status];
}

/** Statuses in the order a payday reads: bought, waited, moved, sold, refused, corrected. */
export const STATUS_ORDER: readonly Status[] = [
  'FILLED',
  'QUEUED',
  'SETTLED',
  'RELEASED',
  'SOLD',
  'PART_SOLD',
  'REFUSED_TICKER',
  'REFUSED_ACCOUNT',
  'RECONCILED',
];

/** "1 action", "13 actions" */
export function actionCount(count: number): string {
  return count === 1 ? '1 action' : `${count} actions`;
}
