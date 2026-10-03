import type { Receipt, TickerId } from '@sleeve/core';
import type { Address, Hex } from 'viem';

import type { CardData, CreateCardInput } from '../types';
import type { AccountHistory } from './history';

/**
 * Shared cards on chain (PRD 7.10): the owner signs what the card shows with the account itself (ERC-1271 through
 * Kernel), Sleeve's server checks that signature and the receipt's owner, and stores the card under an opaque id in
 * Supabase. What a card shows is rebuilt from the receipts every time it is read, never stored.
 */

export type CardSubject = CreateCardInput['subject'];

export interface StoredCard {
  cardId: string;
  account: Address;
  subject: CardSubject;
  showAmounts: boolean;
  showProof: boolean;
}

export interface CreateCardRequest {
  account: Address;
  subject: CardSubject;
  showAmounts: boolean;
  showProof: boolean;
  /** cardMessage(...) as signed. */
  message: string;
  signature: Hex;
}

export interface CardStore {
  get(cardId: string): Promise<StoredCard | null>;
  /** Stores the card and gives back its opaque id. */
  create(request: CreateCardRequest): Promise<string>;
}

export const CARDS_ROUTE = '/api/cards';

/** What the owner signs to make a card: the account, the subject and both choices, and when. */
export function cardMessage(account: Address, input: CreateCardInput, issuedAt: bigint): string {
  const subject = input.subject.kind === 'receipt' ? `receipt ${input.subject.receiptId}` : `week from ${input.subject.weekStart}`;
  return [
    'Sleeve card',
    `Account: ${account}`,
    `Shows: ${subject}`,
    `Amounts: ${input.showAmounts ? 'shown' : 'hidden'}`,
    `Proof: ${input.showProof ? 'shown' : 'hidden'}`,
    `Issued: ${issuedAt}`,
  ].join('\n');
}

/** The card's fields as the message names them, so the server can check the message says what is stored. */
export function parseCardMessage(message: string): { account: string; subject: CardSubject; showAmounts: boolean; showProof: boolean } | null {
  const lines = message.split('\n');
  if (lines[0] !== 'Sleeve card' || lines.length !== 6) return null;
  const account = /^Account: (0x[0-9a-fA-F]{40})$/.exec(lines[1] ?? '')?.[1];
  const receipt = /^Shows: receipt (\d+)$/.exec(lines[2] ?? '')?.[1];
  const week = /^Shows: week from (\d+)$/.exec(lines[2] ?? '')?.[1];
  const amounts = /^Amounts: (shown|hidden)$/.exec(lines[3] ?? '')?.[1];
  const proof = /^Proof: (shown|hidden)$/.exec(lines[4] ?? '')?.[1];
  if (account === undefined || amounts === undefined || proof === undefined) return null;
  const subject: CardSubject | null =
    receipt !== undefined ? { kind: 'receipt', receiptId: BigInt(receipt) } : week !== undefined ? { kind: 'week', weekStart: BigInt(week) } : null;
  if (subject === null) return null;
  return { account, subject, showAmounts: amounts === 'shown', showProof: proof === 'shown' };
}

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

function newYorkOffset(timestamp: bigint): bigint {
  const parts = Object.fromEntries(
    NEW_YORK.formatToParts(new Date(Number(timestamp) * 1_000)).map((part) => [part.type, Number(part.value)]),
  );
  const asUtc = Date.UTC(parts.year ?? 0, (parts.month ?? 1) - 1, parts.day ?? 1, parts.hour ?? 0, parts.minute ?? 0, parts.second ?? 0);
  return BigInt(asUtc / 1_000) - timestamp;
}

/** The next Monday 00:00 New York time after a Monday 00:00, an hour off a plain week across a clock change. */
export function weekEndOf(weekStart: bigint): bigint {
  const naive = weekStart + WEEK_SECONDS;
  return naive + newYorkOffset(weekStart) - newYorkOffset(naive);
}

/** What a stored card shows now, from the account's receipts. Null when its receipt is gone or not a buy. */
export function cardDataOf(stored: StoredCard, history: AccountHistory, currentEquityBps: number): CardData | null {
  if (stored.subject.kind === 'receipt') {
    const { receiptId } = stored.subject;
    const entry = history.receipts.find((candidate) => candidate.receipt.id === receiptId);
    if (entry === undefined) return null;
    const { receipt } = entry;
    if (receipt.status !== 'FILLED' && receipt.status !== 'SETTLED') return null;
    return {
      kind: 'receipt',
      cardId: stored.cardId,
      tickerId: receipt.tickerId,
      status: receipt.status,
      equityBps: history.rules.get(receipt.ruleVersion)?.equityBps ?? currentEquityBps,
      timestamp: receipt.timestamp,
      amounts: stored.showAmounts ? { usdgIn: receipt.usdgIn, usdgSpent: receipt.usdgSpent, tokensOut: receipt.tokensOut } : null,
      proof: stored.showProof ? { receiptIds: [receipt.id], account: stored.account } : null,
    };
  }
  const weekStart = stored.subject.weekStart;
  const weekEnd = weekEndOf(weekStart);
  const inWeek = history.receipts.filter(({ receipt }) => receipt.timestamp >= weekStart && receipt.timestamp < weekEnd);
  const splits = inWeek.filter(({ receipt }) => SPLIT_STATUSES.has(receipt.status));
  const buys = inWeek.filter(({ receipt }) => BUY_STATUSES.has(receipt.status));
  const tickerIds = [...new Set<TickerId>(buys.map(({ receipt }) => receipt.tickerId))].sort((a, b) => a - b);
  const latest = [...splits, ...buys].sort((a, b) => (a.receipt.id < b.receipt.id ? 1 : -1))[0];
  const counted = [...new Set([...splits, ...buys].map(({ receipt }) => receipt.id))].sort((a, b) => (a < b ? -1 : 1));
  return {
    kind: 'week',
    cardId: stored.cardId,
    weekStart,
    weekEnd,
    paydays: splits.length,
    tickerIds,
    equityBps: (latest === undefined ? undefined : history.rules.get(latest.receipt.ruleVersion)?.equityBps) ?? currentEquityBps,
    amounts: stored.showAmounts
      ? {
          usdgIn: splits.reduce((total, { receipt }) => total + receipt.usdgIn, 0n),
          usdgBought: buys.reduce((total, { receipt }) => total + receipt.usdgSpent, 0n),
        }
      : null,
    proof: stored.showProof ? { receiptIds: counted, account: stored.account } : null,
  };
}

interface CardJson {
  cardId: string;
  account: Address;
  subject: { kind: 'receipt'; receiptId: string } | { kind: 'week'; weekStart: string };
  showAmounts: boolean;
  showProof: boolean;
}

export function cardFromJson(json: CardJson): StoredCard {
  return {
    ...json,
    subject:
      json.subject.kind === 'receipt'
        ? { kind: 'receipt', receiptId: BigInt(json.subject.receiptId) }
        : { kind: 'week', weekStart: BigInt(json.subject.weekStart) },
  };
}

export function cardToJson(card: StoredCard): CardJson {
  return {
    ...card,
    subject:
      card.subject.kind === 'receipt'
        ? { kind: 'receipt', receiptId: card.subject.receiptId.toString() }
        : { kind: 'week', weekStart: card.subject.weekStart.toString() },
  };
}

/** The browser's card store: Sleeve's server route, which holds the Supabase key. */
export function routeCardStore(fetcher: typeof fetch = (input, init) => fetch(input, init)): CardStore {
  return {
    async get(cardId) {
      const response = await fetcher(`${CARDS_ROUTE}?id=${encodeURIComponent(cardId)}`, { cache: 'no-store' });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`The card did not load: ${response.status}`);
      return cardFromJson((await response.json()) as CardJson);
    },
    async create(request) {
      const response = await fetcher(CARDS_ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request, (_, value: unknown) => (typeof value === 'bigint' ? value.toString() : value)),
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`The card was not saved: ${response.status}`);
      const body = (await response.json()) as { cardId: string };
      return body.cardId;
    },
  };
}
