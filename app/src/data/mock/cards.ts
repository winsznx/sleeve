import type { Receipt, TickerId } from '@sleeve/core';

import { DataLayerError } from '../errors';
import type { CardData, CreateCardInput, ReceiptRecord } from '../types';
import type { MockAccount, MockWorld, StoredCard } from './engine';
import { pseudoHash } from './pseudo-hash';

/** Statuses a split writes. A week's paydays count these. */
const SPLIT_STATUSES = new Set<Receipt['status']>(['FILLED', 'QUEUED', 'REFUSED_TICKER', 'REFUSED_ACCOUNT']);
const BUY_STATUSES = new Set<Receipt['status']>(['FILLED', 'SETTLED']);
const WEEK_SECONDS = 7n * 86_400n;

const NEW_YORK = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
});

/** Seconds New York is ahead of UTC at an instant: -14,400 on daylight time, -18,000 on standard time. */
function newYorkOffset(timestamp: bigint): bigint {
  const parts = Object.fromEntries(
    NEW_YORK.formatToParts(new Date(Number(timestamp) * 1_000)).map((part) => [part.type, Number(part.value)]),
  );
  const asUtc = Date.UTC(
    parts.year ?? 0,
    (parts.month ?? 1) - 1,
    parts.day ?? 1,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  );
  return BigInt(asUtc / 1_000) - timestamp;
}

/** The next Monday 00:00 New York time after a Monday 00:00, an hour off a plain week across a clock change. */
export function weekEndOf(weekStart: bigint): bigint {
  const naive = weekStart + WEEK_SECONDS;
  return naive + newYorkOffset(weekStart) - newYorkOffset(naive);
}

function ownReceipt(world: MockWorld, account: MockAccount, receiptId: bigint): ReceiptRecord {
  const entry = world.receipts.find(
    (candidate) => candidate.receipt.id === receiptId && candidate.receipt.account === account.address,
  );
  if (entry === undefined || !BUY_STATUSES.has(entry.receipt.status)) {
    throw new DataLayerError({ code: 'NotFound' }, 'A card shows one of your own buys');
  }
  return entry;
}

/** Builds what a card shows from the receipts it covers, now. */
export function cardData(world: MockWorld, stored: StoredCard): CardData | null {
  const account = world.accounts.get(stored.account);
  if (account === undefined) return null;
  if (stored.subject.kind === 'receipt') {
    const { receiptId } = stored.subject;
    const entry = world.receipts.find((candidate) => candidate.receipt.id === receiptId);
    if (entry === undefined) return null;
    const { receipt } = entry;
    if (receipt.status !== 'FILLED' && receipt.status !== 'SETTLED') return null;
    return {
      kind: 'receipt',
      cardId: stored.cardId,
      tickerId: receipt.tickerId,
      status: receipt.status,
      equityBps: entry.derived.rule?.equityBps ?? account.rule.equityBps,
      timestamp: receipt.timestamp,
      amounts: stored.showAmounts
        ? { usdgIn: receipt.usdgIn, usdgSpent: receipt.usdgSpent, tokensOut: receipt.tokensOut }
        : null,
      proof: stored.showProof ? { receiptIds: [receipt.id], account: account.address } : null,
    };
  }

  const weekStart = stored.subject.weekStart;
  const weekEnd = weekEndOf(weekStart);
  const inWeek = world.receipts.filter(
    ({ receipt }) =>
      receipt.account === account.address && receipt.timestamp >= weekStart && receipt.timestamp < weekEnd,
  );
  const splits = inWeek.filter(({ receipt }) => SPLIT_STATUSES.has(receipt.status));
  const buys = inWeek.filter(({ receipt }) => BUY_STATUSES.has(receipt.status));
  const tickerIds = [...new Set<TickerId>(buys.map(({ receipt }) => receipt.tickerId))].sort((a, b) => a - b);
  const latestRule = [...splits, ...buys].sort((a, b) => (a.receipt.id < b.receipt.id ? 1 : -1))[0]?.derived.rule;
  const counted = [...splits, ...buys].map(({ receipt }) => receipt.id).sort((a, b) => (a < b ? -1 : 1));
  return {
    kind: 'week',
    cardId: stored.cardId,
    weekStart,
    weekEnd,
    paydays: splits.length,
    tickerIds,
    equityBps: latestRule?.equityBps ?? account.rule.equityBps,
    amounts: stored.showAmounts
      ? {
          usdgIn: splits.reduce((total, { receipt }) => total + receipt.usdgIn, 0n),
          usdgBought: buys.reduce((total, { receipt }) => total + receipt.usdgSpent, 0n),
        }
      : null,
    proof: stored.showProof ? { receiptIds: [...new Set(counted)], account: account.address } : null,
  };
}

/** Stores a card for the owner and returns what it shows. The id is opaque: it encodes neither receipt nor account. */
export function createCard(world: MockWorld, account: MockAccount, input: CreateCardInput): CardData {
  if (input.subject.kind === 'receipt') ownReceipt(world, account, input.subject.receiptId);
  const cardId = pseudoHash(`card:${world.cards.size}:${account.address}:${world.clock.timestamp}`).slice(2, 14);
  const stored: StoredCard = {
    cardId,
    account: account.address,
    subject: input.subject,
    showAmounts: input.showAmounts,
    showProof: input.showProof,
  };
  world.cards.set(cardId, stored);
  const data = cardData(world, stored);
  if (data === null) throw new DataLayerError({ code: 'NotFound' }, 'Nothing to show on this card');
  return data;
}
