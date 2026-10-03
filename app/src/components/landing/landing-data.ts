'use client';

import type { Rule } from '@sleeve/core';
import { useSyncExternalStore } from 'react';

import { useBuckets, useHoldings, useInbox, useLedger, useMarket, useReceipt, useRule } from '@/data/hooks';
import { DATA_SOURCE } from '@/data/source';
import type { BucketView, Holding, InboxItem, LedgerView, MarketSnapshot, ReceiptRecord } from '@/data/types';

import { EXAMPLE_RECEIPT_ID } from './example-receipt';

/**
 * The landing page reads one example account through the data layer: the account whose payday the example receipt
 * records. With the mock that is the sample account; on Robinhood Chain it is whichever account wrote the receipt
 * NEXT_PUBLIC_SLEEVE_EXAMPLE_RECEIPT_ID names. Every widget shows one of three states, and a failed read offers a
 * retry instead of a number.
 */
export type Remote<T> =
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | { status: 'ready'; data: T };

interface Refetchable {
  isError: boolean;
  refetch: () => Promise<unknown>;
}

function failure(queries: readonly Refetchable[]): Remote<never> | null {
  const failed = queries.filter((query) => query.isError);
  if (failed.length === 0) return null;
  return {
    status: 'error',
    retry: () => {
      for (const query of failed) void query.refetch();
    },
  };
}

/** "Sample account" while the mock runs, so no sample number passes for a chain read. */
export const EXAMPLE_ACCOUNT_LABEL = DATA_SOURCE === 'mock' ? 'Sample account' : 'Example account';

/** The example payday's receipt, or null when none is configured or the id names no receipt. */
export function useExampleReceipt(): Remote<ReceiptRecord | null> {
  const receipt = useReceipt(EXAMPLE_RECEIPT_ID ?? undefined);
  if (EXAMPLE_RECEIPT_ID === null) return { status: 'ready', data: null };
  const failed = failure([receipt]);
  if (failed !== null) return failed;
  if (receipt.data === undefined) return { status: 'loading' };
  return { status: 'ready', data: receipt.data };
}

export interface ExampleAccount {
  /** The example payday: the split the landing walks through. */
  record: ReceiptRecord;
  ledger: LedgerView;
  holdings: Holding[];
  buckets: BucketView[];
  rule: Rule;
  /** Inbound USDG transfers, newest first. */
  payments: InboxItem[];
  market: MarketSnapshot;
  /** When the market snapshot was read, in browser milliseconds, for the reopen countdown. */
  marketReadAt: number;
}

/** The example payday's account: ledger, holdings, waiting buckets, rule, payments and the market they sit in. */
export function useExampleAccount(): Remote<ExampleAccount | null> {
  const receipt = useExampleReceipt();
  const account = receipt.status === 'ready' ? receipt.data?.receipt.account : undefined;
  const ledger = useLedger(account);
  const holdings = useHoldings(account);
  const buckets = useBuckets(account);
  const rule = useRule(account);
  const payments = useInbox(account);
  const market = useMarket();

  if (receipt.status !== 'ready') return receipt;
  const record = receipt.data;
  if (record === null) return { status: 'ready', data: null };
  const failed = failure([ledger, holdings, buckets, rule, payments, market]);
  if (failed !== null) return failed;
  if (
    ledger.data === undefined ||
    holdings.data === undefined ||
    buckets.data === undefined ||
    rule.data === undefined ||
    payments.data === undefined ||
    market.data === undefined
  ) {
    return { status: 'loading' };
  }
  return {
    status: 'ready',
    data: {
      record,
      ledger: ledger.data,
      holdings: holdings.data,
      buckets: buckets.data,
      rule: rule.data,
      payments: payments.data,
      market: market.data,
      marketReadAt: market.dataUpdatedAt,
    },
  };
}

/** The market snapshot alone, for the launch ticker cards and the session eyebrow. */
export function useMarketSnapshot(): Remote<{ market: MarketSnapshot; readAt: number }> {
  const market = useMarket();
  const failed = failure([market]);
  if (failed !== null) return failed;
  if (market.data === undefined) return { status: 'loading' };
  return { status: 'ready', data: { market: market.data, readAt: market.dataUpdatedAt } };
}

/** The split that sorted a payment, or null while the payment is not sorted yet. */
export function usePaymentSplit(payment: InboxItem): Remote<ReceiptRecord | null> {
  const receiptId = payment.sortedBy?.receiptId;
  const receipt = useReceipt(receiptId);
  if (receiptId === undefined) return { status: 'ready', data: null };
  const failed = failure([receipt]);
  if (failed !== null) return failed;
  if (receipt.data === undefined) return { status: 'loading' };
  return { status: 'ready', data: receipt.data };
}

const CLOCK_TICK_MS = 15_000;

function subscribeToClock(onTick: () => void): () => void {
  const timer = window.setInterval(onTick, CLOCK_TICK_MS);
  return () => window.clearInterval(timer);
}

function currentMinute(): number {
  return Math.floor(Date.now() / 60_000);
}

function noMinute(): null {
  return null;
}

/**
 * Chain time now, to the minute: the snapshot's chain timestamp plus the real time since it was read. The browser
 * clock only measures elapsed time, never the chain's own time, so a device set to the wrong day still counts down
 * correctly. Before hydration it is the snapshot time itself.
 */
export function useChainNow(asOf: bigint, readAt: number): bigint {
  const minute = useSyncExternalStore(subscribeToClock, currentMinute, noMinute);
  if (minute === null) return asOf;
  const elapsedSeconds = Math.max(0, Math.floor((minute * 60_000 - readAt) / 1_000));
  return asOf + BigInt(elapsedSeconds);
}
