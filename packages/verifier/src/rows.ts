import { RECEIPT_FIELDS, type Receipt } from '@sleeve/core';
import { getAddress, isAddress } from 'viem';

import type { CheckRow, DerivedRow, FieldRow, Relation, RowStatus, ValueUnit } from './types';

/** Helpers that turn values into the exact strings rows carry. Nothing here rounds. */

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
export const ZERO_BYTES32 = `0x${'0'.repeat(64)}`;

export type Scalar = bigint | number | boolean | string;

export function text(value: Scalar): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

/** Addresses print checksummed whatever case a log or a call returned them in, so equal values read the same. */
function display(value: string, unit: ValueUnit): string {
  return unit === 'address' && isAddress(value, { strict: false }) ? getAddress(value) : value;
}

/** Addresses and hashes compare without regard to case; everything else compares exactly. */
export function sameValue(a: string, b: string, unit: ValueUnit): boolean {
  return unit === 'address' || unit === 'hash' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export function statusOf(ok: boolean): RowStatus {
  return ok ? 'MATCH' : 'MISMATCH';
}

/** The zero value of a receipt field: 0, false, the zero address, zero bytes, or the enum's first member. */
export function zeroOf(field: keyof Receipt): Scalar {
  switch (RECEIPT_FIELDS[field]) {
    case 'address':
      return ZERO_ADDRESS;
    case 'bytes32':
      return ZERO_BYTES32;
    case 'bool':
      return false;
    case 'Reason':
      return 'NONE';
    case 'Trigger':
      return 'KEEPER';
    case 'Status':
      return 'FILLED';
    case 'AccountingMode':
      return 'WRAPPED';
    default:
      return 0n;
  }
}

/** The receipt field as a row string. Numbers of every width print the same way, so 0 and 0n compare equal. */
export function fieldText(receipt: Receipt, field: keyof Receipt): string {
  return text(receipt[field]);
}

export interface FieldRowInput {
  field: keyof Receipt;
  label: string;
  unit: ValueUnit;
  receipt: string;
  recomputed: string;
  /** Set when the comparison is not plain equality of the two strings. */
  status?: RowStatus;
  source: string;
}

export function fieldRow(input: FieldRowInput): FieldRow {
  const status = input.status ?? statusOf(sameValue(input.receipt, input.recomputed, input.unit));
  return {
    id: `field:${input.field}`,
    field: input.field,
    label: input.label,
    unit: input.unit,
    receipt: display(input.receipt, input.unit),
    recomputed: display(input.recomputed, input.unit),
    status,
    source: input.source,
  };
}

export interface CheckRowInput {
  id: string;
  label: string;
  unit: ValueUnit;
  observed: Scalar;
  expected: Scalar;
  relation: Relation;
  ok: boolean;
  source: string;
}

export function checkRow(input: CheckRowInput): CheckRow {
  return {
    id: input.id,
    label: input.label,
    unit: input.unit,
    observed: text(input.observed),
    expected: text(input.expected),
    relation: input.relation,
    status: statusOf(input.ok),
    source: input.source,
  };
}

/** A check whose input could not be read: shown failing with the reason, never passed over. */
export function unreadCheck(input: Omit<CheckRowInput, 'observed' | 'ok'> & { reason: string }): CheckRow {
  return checkRow({ ...input, observed: input.reason, ok: false });
}

export function derivedRow(input: { id: string; label: string; unit: ValueUnit; value: Scalar; source: string }): DerivedRow {
  return { id: input.id, label: input.label, unit: input.unit, value: display(text(input.value), input.unit), source: input.source };
}

/** Compares two integers by a one-sided relation, so every check reads the same. */
export function holds(observed: bigint, relation: Exclude<Relation, 'within'>, expected: bigint): boolean {
  switch (relation) {
    case 'equals':
      return observed === expected;
    case 'at most':
      return observed <= expected;
    case 'at least':
      return observed >= expected;
    case 'above':
      return observed > expected;
  }
}

/** A check that compares two integers. */
export function compareRow(
  input: Omit<CheckRowInput, 'observed' | 'expected' | 'ok' | 'relation'> & {
    observed: bigint;
    expected: bigint;
    relation: Exclude<Relation, 'within'>;
  },
): CheckRow {
  return checkRow({ ...input, ok: holds(input.observed, input.relation, input.expected) });
}
