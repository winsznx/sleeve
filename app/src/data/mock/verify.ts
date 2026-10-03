import {
  ADDRESSES,
  DISCLOSURE,
  PUBLIC_RPC_URL,
  discountBps,
  execPriceBuy,
  execPriceSell,
  premiumBps,
  type Address,
  type Receipt,
} from '@sleeve/core';

import type { ReceiptRecord, VerifyCheck, VerifyResult, VerifyUnit } from '../types';
import { roundKey, sampleReceiptHash, type MockWorld, type TransferLog } from './engine';

/**
 * The verifier's recomputation (PRD 10, D-009 Q36) run against the mock world: the receipt is checked against
 * its stored hash, the fill transaction's Transfer logs, the feed rounds as getRoundData serves them, and the
 * shared price arithmetic. Every check is listed whether it passes or not. `expected` is what the chain data
 * gives; `actual` is what the receipt says.
 */

interface CheckInput {
  id: string;
  label: string;
  unit: VerifyUnit;
  source: string;
  expected: bigint | string;
  actual: bigint | string;
  /** Defaults to expected equal to actual. */
  ok?: boolean;
}

function check(input: CheckInput): VerifyCheck {
  const expected = String(input.expected);
  const actual = String(input.actual);
  return {
    id: input.id,
    label: input.label,
    unit: input.unit,
    source: input.source,
    expected,
    actual,
    ok: input.ok ?? expected === actual,
  };
}

function sumTransfers(logs: TransferLog[], token: Address, from: Address, to: Address): bigint {
  const same = (a: Address, b: Address): boolean => a.toLowerCase() === b.toLowerCase();
  return logs
    .filter((log) => same(log.token, token) && same(log.from, from) && same(log.to, to))
    .reduce((total, log) => total + log.amount, 0n);
}

function roundChecks(world: MockWorld, receipt: Receipt, feed: Address | null): VerifyCheck[] {
  const checks: VerifyCheck[] = [];
  if (feed !== null && receipt.roundId !== 0n) {
    const round = world.rounds.get(roundKey(feed, receipt.roundId));
    checks.push(
      check({
        id: 'feed-answer',
        label: 'Feed answer for the round',
        unit: 'feed',
        source: 'getRoundData',
        expected: round?.answer ?? 'missing',
        actual: receipt.answer,
      }),
      check({
        id: 'feed-updated-at',
        label: 'Feed round time',
        unit: 'timestamp',
        source: 'getRoundData',
        expected: round?.updatedAt ?? 'missing',
        actual: receipt.updatedAt,
      }),
    );
  }
  if (receipt.usdgRoundId !== 0n) {
    const round = world.rounds.get(roundKey(ADDRESSES.USDG_USD_FEED, receipt.usdgRoundId));
    checks.push(
      check({
        id: 'usdg-answer',
        label: 'USDG/USD answer for the round',
        unit: 'feed',
        source: 'getRoundData',
        expected: round?.answer ?? 'missing',
        actual: receipt.usdgAnswer,
      }),
    );
  }
  return checks;
}

function conservation(receipt: Receipt): VerifyCheck {
  return check({
    id: 'conservation',
    label: 'USDG in equals spend plus spent plus queued',
    unit: 'usdg',
    source: 'Receipt fields',
    expected: receipt.usdgIn,
    actual: receipt.usdgToSpend + receipt.usdgSpent + receipt.usdgQueued,
  });
}

function buyChecks(world: MockWorld, entry: ReceiptRecord, feed: Address | null): VerifyCheck[] {
  const { receipt } = entry;
  const logs = world.logs.get(entry.derived.txHash) ?? [];
  const checks = [
    conservation(receipt),
    check({
      id: 'usdg-spent',
      label: 'USDG that left the account',
      unit: 'usdg',
      source: 'Transfer log',
      expected: sumTransfers(logs, ADDRESSES.USDG, receipt.account, receipt.pool),
      actual: receipt.usdgSpent,
    }),
    check({
      id: 'tokens-out',
      label: 'Stock Tokens that arrived',
      unit: 'token',
      source: 'Transfer log',
      expected: sumTransfers(logs, receipt.token, receipt.pool, receipt.account),
      actual: receipt.tokensOut,
    }),
    ...roundChecks(world, receipt, feed),
  ];
  if (receipt.tokensOut === 0n || receipt.answer <= 0n) return checks;

  const premium = premiumBps(receipt.usdgSpent, receipt.tokensOut, receipt.answer);
  checks.push(
    check({
      id: 'exec-price',
      label: 'Execution price',
      unit: 'usdg',
      source: 'Recomputed from the amounts',
      expected: execPriceBuy(receipt.usdgSpent, receipt.tokensOut),
      actual: receipt.execPrice,
    }),
    check({
      id: 'premium',
      label: 'Premium over the feed price',
      unit: 'bps',
      source: 'Recomputed from the amounts and the round',
      expected: premium,
      actual: receipt.premiumBps,
    }),
  );
  const cap = entry.derived.rule?.premiumCapBps;
  if (cap !== undefined) {
    checks.push(
      check({
        id: 'premium-cap',
        label: 'Premium within the rule cap',
        unit: 'bps',
        source: 'Rule version on the receipt',
        expected: BigInt(cap),
        actual: premium,
        ok: premium <= BigInt(cap),
      }),
    );
  }
  return checks;
}

function sellChecks(world: MockWorld, entry: ReceiptRecord, feed: Address | null): VerifyCheck[] {
  const { receipt } = entry;
  const logs = world.logs.get(entry.derived.txHash) ?? [];
  const sameTx = world.receipts.filter((other) => other.derived.txHash === entry.derived.txHash);
  const tokensIn = sameTx.reduce((total, other) => total + other.receipt.tokensIn, 0n);
  const usdgOut = sameTx.reduce((total, other) => total + other.receipt.usdgOut, 0n);
  const checks = [
    check({
      id: 'tokens-in',
      label: 'Stock Tokens sold in this transaction',
      unit: 'token',
      source: 'Transfer log',
      expected: sumTransfers(logs, receipt.token, receipt.account, receipt.pool),
      actual: tokensIn,
    }),
    check({
      id: 'usdg-out',
      label: 'USDG received in this transaction',
      unit: 'usdg',
      source: 'Transfer log',
      expected: sumTransfers(logs, ADDRESSES.USDG, receipt.pool, receipt.account),
      actual: usdgOut,
    }),
    check({
      id: 'to-spend',
      label: 'Proceeds credited to spend',
      unit: 'usdg',
      source: 'Receipt fields',
      expected: receipt.usdgOut,
      actual: receipt.usdgToSpend,
    }),
    ...roundChecks(world, receipt, feed),
  ];
  if (tokensIn === 0n || receipt.answer <= 0n) return checks;

  checks.push(
    check({
      id: 'exec-price',
      label: 'Execution price',
      unit: 'usdg',
      source: 'Recomputed from the amounts',
      expected: execPriceSell(usdgOut, tokensIn),
      actual: receipt.execPrice,
    }),
    check({
      id: 'premium',
      label: 'Price against the feed',
      unit: 'bps',
      source: 'Recomputed from the amounts and the round',
      expected: -discountBps(usdgOut, tokensIn, receipt.answer),
      actual: receipt.premiumBps,
    }),
  );
  return checks;
}

function reconcileCheck(entry: ReceiptRecord): VerifyCheck {
  const reconciliation = entry.reconciliation;
  const cut =
    reconciliation === null
      ? 'missing'
      : reconciliation.fromSpend + reconciliation.fromBuckets.reduce((total, part) => total + part.amount, 0n);
  return check({
    id: 'reconcile',
    label: 'Ledger cuts cover the shortfall',
    unit: 'usdg',
    source: 'RECONCILED event',
    expected: reconciliation?.shortfall ?? 'missing',
    actual: cut,
    ok: reconciliation !== null && reconciliation.shortfall === cut,
  });
}

function statusChecks(world: MockWorld, entry: ReceiptRecord): VerifyCheck[] {
  const { receipt } = entry;
  const feed = world.market.get(receipt.tickerId)?.feed.feed ?? null;
  switch (receipt.status) {
    case 'FILLED':
    case 'SETTLED':
      return buyChecks(world, entry, feed);
    case 'PART_SOLD':
    case 'SOLD':
      return sellChecks(world, entry, feed);
    case 'QUEUED':
      return [conservation(receipt), ...roundChecks(world, receipt, feed)];
    case 'REFUSED_TICKER':
    case 'REFUSED_ACCOUNT':
    case 'RELEASED':
      return [conservation(receipt)];
    case 'RECONCILED':
      return [reconcileCheck(entry)];
  }
}

export function verifyInWorld(world: MockWorld, id: bigint): VerifyResult {
  const base = { receiptId: id, checkedAt: world.clock.timestamp, rpcUrl: PUBLIC_RPC_URL };
  const entry = world.receipts.find((candidate) => candidate.receipt.id === id);
  if (entry === undefined) {
    return { ...base, status: 'NOT_FOUND', storedHash: null, recomputedHash: null, checks: [] };
  }
  const recomputedHash = sampleReceiptHash(entry.receipt);
  const checks = [
    check({
      id: 'receipt-hash',
      label: 'Receipt hash',
      unit: 'hash',
      source: 'receiptHash(id)',
      expected: entry.receiptHash,
      actual: recomputedHash,
    }),
    ...statusChecks(world, entry),
    check({
      id: 'disclosure-hash',
      label: 'Issuer disclosure hash',
      unit: 'hash',
      source: 'keccak256 of the served disclosure',
      expected: DISCLOSURE.keccak256,
      actual: entry.receipt.disclosureHash,
    }),
  ];
  return {
    ...base,
    status: checks.every((item) => item.ok) ? 'MATCH' : 'MISMATCH',
    storedHash: entry.receiptHash,
    recomputedHash,
    checks,
  };
}
