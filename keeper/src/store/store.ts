import type { Address, Hex, Reason, Receipt, Rule } from '@sleeve/core';

import type { LogPosition } from '../chain/events';

/**
 * The small storage interface the keeper writes through. Production implements it with supabase-js against the
 * hosted project (store/supabase.ts); the tests run that same implementation against the migration on PGlite. Every
 * rule the database enforces is named in supabase/README.md, the table contract.
 */
export interface KeeperStore {
  readCursors(): Promise<Map<StreamName, Cursor>>;
  writeCursor(stream: StreamName, cursor: Cursor): Promise<void>;

  readAccounts(): Promise<AccountRecord[]>;
  upsertAccounts(accounts: readonly AccountRecord[]): Promise<void>;
  upsertRuleVersions(rows: readonly RuleVersionRecord[]): Promise<void>;
  /** Merges duplicates, never ignores them, in id order: a replay is a no-op and a different row fails loudly. */
  upsertReceipts(rows: readonly ReceiptRecord[]): Promise<void>;
  upsertReconciliations(rows: readonly ReconciliationRecord[]): Promise<void>;
  /** Ignores duplicates by (chain id, tx hash, log index): a payment is written once and then only moves status. */
  insertPayments(rows: readonly PaymentRecord[]): Promise<void>;
  /** Moves the account's unsorted payments of one install, from blocks before `beforeBlock`. */
  updateEarlierPayments(update: EarlierPaymentsUpdate): Promise<void>;
  /** Block timestamp of the account's oldest payment of the install at `epoch` that no split has sorted. */
  oldestWaitingPayment(account: Address, epoch: InstallPosition): Promise<bigint | null>;
  markAccountsSeen(accounts: readonly Address[], block: bigint, at: Date): Promise<void>;

  startRun(run: RunStart): Promise<number>;
  finishRun(runId: number, finish: RunFinish): Promise<void>;

  readBucketWaits(): Promise<BucketWaitRecord[]>;
  upsertBucketWait(row: BucketWaitRecord): Promise<void>;
  deleteBucketWait(account: Address, tickerId: number): Promise<void>;
}

/** chain_cursor streams. Module logs are indexed up to a block before USDG transfers up to the same block. */
export const STREAMS = ['sleeve_module', 'usdg_transfers'] as const;
export type StreamName = (typeof STREAMS)[number];

export interface Cursor {
  lastBlock: bigint;
  lastBlockHash: Hex | null;
}

export interface InstallPosition {
  blockNumber: bigint;
  logIndex: number;
}

/** An account as the index holds it: its latest install, keeper and rule. */
export interface AccountRecord {
  address: Address;
  installedAt: InstallPosition;
  uninstalledAtBlock: bigint | null;
  keeper: Address;
  rule: Rule;
}

export interface RuleVersionRecord {
  account: Address;
  rule: Rule;
  pos: LogPosition;
}

export interface ReceiptRecord {
  receipt: Receipt;
  /** The log's data, abi.encode(receipt). */
  data: Hex;
  /** receiptHash(id) as the module stores it, checked equal to keccak256(data) before writing. */
  hash: Hex;
  pos: LogPosition;
}

export interface ReconciliationRecord {
  receiptId: bigint;
  balance: bigint;
  fromSpend: bigint;
  fromBuckets: readonly bigint[];
  pos: LogPosition;
}

export type PaymentStatus = 'RECEIVED' | 'WAITING_GRACE' | 'SORTED';

export interface PaymentRecord {
  pos: LogPosition;
  blockTimestamp: bigint;
  from: Address;
  to: Address;
  amount: bigint;
  status: PaymentStatus;
  /** WAITING_GRACE only. */
  graceEndsAt: bigint | null;
  /** SORTED only. */
  sortedBy: bigint | null;
}

export type PaymentStatusChange =
  | { status: 'SORTED'; sortedBy: bigint }
  | { status: 'WAITING_GRACE'; graceEndsAt: bigint };

export interface EarlierPaymentsUpdate {
  account: Address;
  /** The install the payments belong to: only payments after this position change. */
  epoch: InstallPosition;
  beforeBlock: bigint;
  change: PaymentStatusChange;
}

export const KEEPER_ACTIONS = ['INDEX', 'OBSERVE', 'SPLIT', 'SETTLE'] as const;
export type KeeperAction = (typeof KEEPER_ACTIONS)[number];

export const KEEPER_OUTCOMES = ['SUCCEEDED', 'SKIPPED', 'REVERTED', 'FAILED'] as const;
export type KeeperOutcome = (typeof KEEPER_OUTCOMES)[number];

export interface RunStart {
  action: KeeperAction;
  account: Address | null;
  tickerId: number | null;
  startedAt: Date;
  detail: Readonly<Record<string, unknown>>;
}

export interface RunFinish {
  finishedAt: Date;
  outcome: KeeperOutcome;
  txHash: Hex | null;
  /** Required exactly for REVERTED and FAILED. */
  error: string | null;
  detail: Readonly<Record<string, unknown>>;
}

/** Why a non-empty bucket keeps waiting, from the keeper's settle simulations (SPEC 10, PRD 7.4). */
export interface BucketWaitRecord {
  account: Address;
  tickerId: number;
  reason: Exclude<Reason, 'NONE'>;
  bucketSince: bigint;
  /** Chain time of the first simulation that returned this reason for this bucket. */
  firstSeenAt: bigint;
  lastSeenAt: bigint;
}
