import type { Address, Hex, Receipt } from '@sleeve/core';

import type { ReceiptKind } from './receipt';

/**
 * What the verifier returns. Values are raw strings, exact and unrounded: decimal integers for amounts, prices,
 * times and ids, 0x hex for addresses and hashes, enum member names for enums. `unit` says how to read one.
 */

export type RowStatus = 'MATCH' | 'MISMATCH';

/** MATCH when the receipt hash and every row match. NOT_FOUND when the module has never written the id. */
export type Verdict = 'MATCH' | 'MISMATCH' | 'NOT_FOUND';

/**
 * usdg: 6-decimal base units (also an execution price, USDG per whole token). token: 18-decimal Stock Token base
 * units. feed: an 8-decimal Chainlink answer. multiplier: 18 decimals, 1e18 is 1. bps: signed basis points.
 * timestamp: unix seconds. text: anything read as written, durations in seconds among them.
 */
export type ValueUnit = 'usdg' | 'token' | 'feed' | 'multiplier' | 'bps' | 'hash' | 'address' | 'block' | 'timestamp' | 'text';

/** One field of the receipt beside the value recomputed from chain data. */
export interface FieldRow {
  id: `field:${keyof Receipt}`;
  field: keyof Receipt;
  label: string;
  unit: ValueUnit;
  /** The value on the receipt. */
  receipt: string;
  /** The value recomputed from a source other than the receipt, or the value the stored hash commits to. */
  recomputed: string;
  status: RowStatus;
  /** Where the recomputed value came from. */
  source: string;
}

/** How a check compares what it found with what it needs. `within` reads expected as "low to high", both inclusive. */
export type Relation = 'equals' | 'at most' | 'at least' | 'above' | 'within';

/** An invariant or guard condition re-checked from chain data. */
export interface CheckRow {
  id: string;
  label: string;
  unit: ValueUnit;
  /** What the chain data shows. */
  observed: string;
  /** What the observed value must equal, stay within or exceed. */
  expected: string;
  relation: Relation;
  status: RowStatus;
  source: string;
}

/** A fact read from logs that the receipt does not carry, labeled derived (PRD 10). No pass or fail. */
export interface DerivedRow {
  id: string;
  label: string;
  unit: ValueUnit;
  value: string;
  source: string;
}

export interface VerifyResult {
  receiptId: bigint;
  verdict: Verdict;
  rpcUrl: string;
  chainId: number;
  module: Address;
  /** The latest block when the reads were made, and its timestamp. */
  checkedAtBlock: bigint;
  checkedAt: bigint;
  /** receiptHash(id) as stored, and keccak256(abi.encode(receipt)) of the logged receipt. Null when not found. */
  storedHash: Hex | null;
  recomputedHash: Hex | null;
  receipt: Receipt | null;
  kind: ReceiptKind | null;
  transactionHash: Hex | null;
  /** Every Receipt field in SPEC 13 order. Empty when not found. */
  fields: FieldRow[];
  checks: CheckRow[];
  derived: DerivedRow[];
  /** Field and check rows that do not match, the receipt hash included. */
  mismatches: number;
}
