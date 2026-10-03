import type { InboxItem } from '@/data/types';

/** Payments that arrived and are not sorted yet: spendable now, split next. */
export function unsortedPayments(inbox: readonly InboxItem[]): { count: number; amount: bigint } {
  const waiting = inbox.filter((item) => item.state !== 'SORTED');
  return { count: waiting.length, amount: waiting.reduce((sum, item) => sum + item.amount, 0n) };
}
