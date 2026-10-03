import type { Address } from '@sleeve/core';

import type { ReceiptQuery, SellRequest } from './types';

const ROOT = 'sleeve';

function accountKey(account: Address | undefined): string | null {
  return account === undefined ? null : account.toLowerCase();
}

/**
 * Query keys for every read. Keys hold strings, numbers and booleans only: React Query hashes keys as JSON,
 * which cannot carry a bigint. Every owner write invalidates `all`.
 */
export const queryKeys = {
  all: [ROOT] as const,
  session: () => [ROOT, 'session'] as const,
  market: () => [ROOT, 'market'] as const,
  account: (account?: Address) => [ROOT, 'account', accountKey(account)] as const,
  ledger: (account?: Address) => [ROOT, 'ledger', accountKey(account)] as const,
  rule: (account?: Address) => [ROOT, 'rule', accountKey(account)] as const,
  buckets: (account?: Address) => [ROOT, 'buckets', accountKey(account)] as const,
  splitPreview: (account?: Address) => [ROOT, 'split-preview', accountKey(account)] as const,
  holdings: (account?: Address) => [ROOT, 'holdings', accountKey(account)] as const,
  inbox: (account?: Address) => [ROOT, 'inbox', accountKey(account)] as const,
  receipts: (query: Partial<Omit<ReceiptQuery, 'cursor'>>) =>
    [
      ROOT,
      'receipts',
      accountKey(query.account),
      query.tickerId ?? null,
      query.status ?? null,
      query.limit ?? null,
    ] as const,
  receipt: (id?: bigint) => [ROOT, 'receipt', id === undefined ? null : id.toString()] as const,
  card: (cardId?: string) => [ROOT, 'card', cardId ?? null] as const,
  verify: (id?: bigint) => [ROOT, 'verify', id === undefined ? null : id.toString()] as const,
  sellQuote: (request: SellRequest | null) =>
    [
      ROOT,
      'sell-quote',
      request === null
        ? null
        : {
            tickerId: request.tickerId,
            amount: request.amount.toString(),
            lotId: request.lotId.toString(),
            overrideClosed: request.overrideClosed,
            overrideCapBps: request.overrideCapBps,
          },
    ] as const,
};
