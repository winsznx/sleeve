import type { Address } from '@sleeve/core';

import { checkRows, type CheckOptions } from './checks';
import { buildContext } from './context';
import { derivedRows } from './derived';
import type { Evidence } from './evidence';
import { fieldRows } from './fields';
import { decodeReceiptLog } from './receipt';
import { checkRow } from './rows';
import type { CheckRow, FieldRow, VerifyResult } from './types';

/**
 * Turns evidence into a result without touching the network. The verdict is MATCH only when the stored hash matches
 * and every field and check row matches; a mismatch is counted and shown, never smoothed (PRD 10).
 */

function countMismatches(fields: readonly FieldRow[], checks: readonly CheckRow[]): number {
  return [...fields, ...checks].filter((row) => row.status === 'MISMATCH').length;
}

export function checkEvidence(ev: Evidence, options: CheckOptions = {}): VerifyResult {
  const base = {
    receiptId: ev.id,
    rpcUrl: ev.rpcUrl,
    chainId: ev.chainId,
    module: ev.module,
    checkedAtBlock: ev.latestBlock,
    checkedAt: ev.latestTimestamp,
    storedHash: ev.storedHash,
    transactionHash: ev.receiptLog.transactionHash,
  };
  const decoded = decodeReceiptLog(ev.receiptLog);
  if (!decoded.ok) {
    const row = checkRow({
      id: 'receipt-decodes',
      label: 'The ReceiptWritten log decodes as a Receipt',
      unit: 'text',
      observed: decoded.error,
      expected: 'a Receipt',
      relation: 'equals',
      ok: false,
      source: 'The ReceiptWritten log',
    });
    return { ...base, verdict: 'MISMATCH', recomputedHash: null, receipt: null, kind: null, fields: [], checks: [row], derived: [], mismatches: 1 };
  }
  const ctx = buildContext(ev, decoded.value);
  const fields = fieldRows(ctx);
  const checks = checkRows(ctx, options);
  const mismatches = countMismatches(fields, checks);
  return {
    ...base,
    verdict: mismatches === 0 ? 'MATCH' : 'MISMATCH',
    recomputedHash: ctx.recomputedHash,
    receipt: ctx.r,
    kind: ctx.kind,
    fields,
    checks,
    derived: derivedRows(ctx),
    mismatches,
  };
}

/** The result for an id the module never wrote: zero, or at or past nextReceiptId(). */
export function notFoundResult(input: {
  id: bigint;
  rpcUrl: string;
  chainId: number;
  module: Address;
  latestBlock: bigint;
  latestTimestamp: bigint;
}): VerifyResult {
  return {
    receiptId: input.id,
    verdict: 'NOT_FOUND',
    rpcUrl: input.rpcUrl,
    chainId: input.chainId,
    module: input.module,
    checkedAtBlock: input.latestBlock,
    checkedAt: input.latestTimestamp,
    storedHash: null,
    recomputedHash: null,
    receipt: null,
    kind: null,
    transactionHash: null,
    fields: [],
    checks: [],
    derived: [],
    mismatches: 0,
  };
}
