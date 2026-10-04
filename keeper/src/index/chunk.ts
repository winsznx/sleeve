import { type Address, type Hex, type Receipt, ZERO_ADDRESS } from '@sleeve/core';

import { type LogPosition, type ModuleEvent, type TransferLog, comparePositions } from '../chain/events';
import { IndexIntegrityError } from '../errors';
import { EMPTY_RULE } from '../store/rows';
import type {
  AccountRecord,
  EarlierPaymentsUpdate,
  InstallPosition,
  PaymentRecord,
  PaymentStatusChange,
  ReceiptRecord,
  ReconciliationRecord,
  RuleVersionRecord,
} from '../store/store';

/**
 * One block range of module logs and USDG transfers turned into index rows, without any I/O. The logs are applied in
 * chain order to the accounts as the index held them when the range starts, the way the module applied them:
 *
 * - Installed starts a new install: USDG that arrived before it is in the install snapshot and never splits (I5),
 *   so the earlier install's unsorted payments stop moving. Uninstalled ends the install the same way.
 * - A USDG transfer is a payment when its account is installed, it came after the Installed log, and it is not the
 *   owner's own money: not inside the account's bracketed owner op (OwnerOpEnded, PRD 7.2), not sale proceeds, not
 *   a self-transfer and not zero.
 * - Observed puts the account's unsorted payments of the install before it in WAITING_GRACE until observedAt plus the
 *   grace (SPEC 8). A split receipt (FILLED, QUEUED or a refusal with USDG in) sorts every unsorted payment of the
 *   install before it. SORTED is final.
 *
 * Payments from earlier ranges are moved with one filtered update per account (`earlierPayments`); payments in this
 * range are written once with their final status.
 */

export type TransferSkip =
  | 'ZERO_AMOUNT'
  | 'SELF_TRANSFER'
  | 'NOT_INSTALLED'
  | 'BEFORE_INSTALL'
  | 'OWNER_BRACKET'
  | 'SALE_PROCEEDS';

export interface ChunkInput {
  fromBlock: bigint;
  toBlock: bigint;
  /** The index's accounts when the range starts. */
  accounts: ReadonlyMap<Address, AccountRecord>;
  /** Module logs in the range, in chain order. */
  events: readonly ModuleEvent[];
  /** USDG transfers in the range to accounts installed at some point in it, in chain order. */
  transfers: readonly TransferLog[];
  /** receiptHash(id) as the module stores it, already checked against the event data. */
  receiptHashes: ReadonlyMap<bigint, Hex>;
  /** For transactions where a transfer and an OwnerOpEnded of its account meet: the UserOperationEvent log indexes. */
  userOpBoundaries: ReadonlyMap<Hex, readonly number[]>;
  /** Timestamps of the blocks that hold transfers. */
  blockTimestamps: ReadonlyMap<bigint, bigint>;
  graceSeconds: bigint;
}

export interface SkippedTransfer {
  pos: LogPosition;
  to: Address;
  amount: bigint;
  reason: TransferSkip;
}

export interface ChunkResult {
  accounts: AccountRecord[];
  ruleVersions: RuleVersionRecord[];
  receipts: ReceiptRecord[];
  reconciliations: ReconciliationRecord[];
  payments: PaymentRecord[];
  earlierPayments: EarlierPaymentsUpdate[];
  skipped: SkippedTransfer[];
}

const SPLIT_STATUSES: ReadonlySet<Receipt['status']> = new Set([
  'FILLED',
  'QUEUED',
  'REFUSED_TICKER',
  'REFUSED_ACCOUNT',
]);

/** A receipt that sorted unsorted USDG: a split's FILLED, QUEUED or refusal, with USDG in (SPEC 13). */
export function sortsPayments(receipt: Receipt): boolean {
  return SPLIT_STATUSES.has(receipt.status) && receipt.usdgIn > 0n;
}

function key(txHash: Hex, account: Address): string {
  return `${txHash}:${account}`;
}

/** OwnerOpEnded log indexes per (transaction, account). */
function bracketEnds(events: readonly ModuleEvent[]): Map<string, number[]> {
  const ends = new Map<string, number[]>();
  for (const event of events) {
    if (event.kind !== 'OwnerOpEnded') continue;
    const entry = key(event.pos.txHash, event.account);
    ends.set(entry, [...(ends.get(entry) ?? []), event.pos.logIndex]);
  }
  return ends;
}

/** PART_SOLD and SOLD receipts per (transaction, account): the pool a sale's proceeds come from. */
function saleReceipts(events: readonly ModuleEvent[]): Map<string, { logIndex: number; pool: Address }[]> {
  const sales = new Map<string, { logIndex: number; pool: Address }[]>();
  for (const event of events) {
    if (event.kind !== 'ReceiptWritten') continue;
    const { receipt } = event;
    if (receipt.status !== 'PART_SOLD' && receipt.status !== 'SOLD') continue;
    const entry = key(event.pos.txHash, receipt.account);
    sales.set(entry, [...(sales.get(entry) ?? []), { logIndex: event.pos.logIndex, pool: receipt.pool }]);
  }
  return sales;
}

/**
 * Whether a transfer to an account landed inside that account's bracketed owner op: an OwnerOpEnded of the account
 * follows it in the same transaction, with no UserOperationEvent between them. The app puts beginOwnerOp first and
 * endOwnerOp last in every owner op (I14), and each UserOp's logs end with its UserOperationEvent, so a transfer from
 * a payer's op earlier in the same bundle is still a payment.
 */
export function insideOwnerBracket(
  logIndex: number,
  ends: readonly number[] | undefined,
  boundaries: readonly number[] | undefined,
): boolean {
  const end = ends?.find((index) => index > logIndex);
  if (end === undefined) return false;
  const opEnd = boundaries?.find((index) => index > logIndex);
  return opEnd === undefined || opEnd > end;
}

type Entry = { type: 'event'; event: ModuleEvent } | { type: 'transfer'; transfer: TransferLog };

function positionOfEntry(entry: Entry): LogPosition {
  return entry.type === 'event' ? entry.event.pos : entry.transfer.pos;
}

/** Module logs and transfers in one chain-ordered list. */
function merge(events: readonly ModuleEvent[], transfers: readonly TransferLog[]): Entry[] {
  const entries: Entry[] = [
    ...events.map((event): Entry => ({ type: 'event', event })),
    ...transfers.map((transfer): Entry => ({ type: 'transfer', transfer })),
  ];
  return entries.sort((a, b) => comparePositions(positionOfEntry(a), positionOfEntry(b)));
}

interface EarlierState {
  epoch: InstallPosition;
  change: PaymentStatusChange | null;
  /** Set once the install the earlier payments belong to has ended: nothing moves them after that. */
  frozen: boolean;
}

export function processChunk(input: ChunkInput): ChunkResult {
  const touched = new Map<Address, AccountRecord>();
  const ruleVersions: RuleVersionRecord[] = [];
  const receipts: ReceiptRecord[] = [];
  const reconciliations: ReconciliationRecord[] = [];
  const payments: PaymentRecord[] = [];
  const skipped: SkippedTransfer[] = [];
  /** This range's payments of the current install that no split has sorted yet. */
  const unsorted = new Map<Address, PaymentRecord[]>();
  const earlier = new Map<Address, EarlierState>();
  const ends = bracketEnds(input.events);
  const sales = saleReceipts(input.events);

  const current = (account: Address): AccountRecord | undefined => touched.get(account) ?? input.accounts.get(account);

  const known = (account: Address, pos: LogPosition): AccountRecord => {
    const record = current(account);
    if (record === undefined) {
      throw new IndexIntegrityError(
        'UNKNOWN_ACCOUNT',
        `a module log at block ${pos.blockNumber} index ${pos.logIndex} names ${account}, ` +
          'which has no Installed log in the index',
      );
    }
    return record;
  };

  const earlierOf = (account: Address): EarlierState => {
    let state = earlier.get(account);
    if (state === undefined) {
      const atStart = input.accounts.get(account);
      state =
        atStart !== undefined && atStart.uninstalledAtBlock === null
          ? { epoch: atStart.installedAt, change: null, frozen: false }
          : { epoch: { blockNumber: 0n, logIndex: 0 }, change: null, frozen: true };
      earlier.set(account, state);
    }
    return state;
  };

  const endInstall = (account: Address): void => {
    earlierOf(account).frozen = true;
    unsorted.delete(account);
  };

  const move = (account: Address, change: PaymentStatusChange): void => {
    for (const payment of unsorted.get(account) ?? []) {
      payment.status = change.status;
      payment.graceEndsAt = change.status === 'WAITING_GRACE' ? change.graceEndsAt : null;
      payment.sortedBy = change.status === 'SORTED' ? change.sortedBy : null;
    }
    if (change.status === 'SORTED') unsorted.delete(account);
    const state = earlierOf(account);
    if (!state.frozen && state.change?.status !== 'SORTED') state.change = change;
  };

  const applyEvent = (event: ModuleEvent): void => {
    switch (event.kind) {
      case 'Installed':
        endInstall(event.account);
        touched.set(event.account, {
          address: event.account,
          installedAt: { blockNumber: event.pos.blockNumber, logIndex: event.pos.logIndex },
          uninstalledAtBlock: null,
          keeper: event.keeper,
          rule: EMPTY_RULE,
        });
        return;
      case 'Uninstalled': {
        const record = known(event.account, event.pos);
        endInstall(event.account);
        touched.set(event.account, {
          ...record,
          uninstalledAtBlock: event.pos.blockNumber,
          keeper: ZERO_ADDRESS,
          rule: EMPTY_RULE,
        });
        return;
      }
      case 'RuleSet':
        touched.set(event.account, { ...known(event.account, event.pos), rule: event.rule });
        ruleVersions.push({ account: event.account, rule: event.rule, pos: event.pos });
        return;
      case 'RulePaused':
      case 'RuleResumed': {
        const record = known(event.account, event.pos);
        const status = event.kind === 'RulePaused' ? 'PAUSED' : 'ACTIVE';
        touched.set(event.account, { ...record, rule: { ...record.rule, status } });
        return;
      }
      case 'KeeperSet':
        touched.set(event.account, { ...known(event.account, event.pos), keeper: event.keeper });
        return;
      case 'ReceiptWritten': {
        const hash = input.receiptHashes.get(event.receipt.id);
        if (hash === undefined) {
          throw new IndexIntegrityError('RECEIPT_HASH_MISSING', `receipt ${event.receipt.id} has no checked hash`);
        }
        receipts.push({ receipt: event.receipt, data: event.data, hash, pos: event.pos });
        if (sortsPayments(event.receipt)) move(event.receipt.account, { status: 'SORTED', sortedBy: event.receipt.id });
        return;
      }
      case 'Observed':
        move(event.account, { status: 'WAITING_GRACE', graceEndsAt: event.observedAt + input.graceSeconds });
        return;
      case 'Reconciled':
        reconciliations.push({
          receiptId: event.receiptId,
          balance: event.balance,
          fromSpend: event.fromSpend,
          fromBuckets: event.fromBuckets,
          pos: event.pos,
        });
        return;
      case 'OwnerOpEnded':
      case 'LotsReconciled':
        return;
    }
  };

  const classify = (transfer: TransferLog): TransferSkip | null => {
    if (transfer.amount === 0n) return 'ZERO_AMOUNT';
    if (transfer.from === transfer.to) return 'SELF_TRANSFER';
    const record = current(transfer.to);
    if (record === undefined || record.uninstalledAtBlock !== null) return 'NOT_INSTALLED';
    if (comparePositions(transfer.pos, record.installedAt) <= 0) return 'BEFORE_INSTALL';
    const entry = key(transfer.pos.txHash, transfer.to);
    if (insideOwnerBracket(transfer.pos.logIndex, ends.get(entry), input.userOpBoundaries.get(transfer.pos.txHash))) {
      return 'OWNER_BRACKET';
    }
    const fromSale = (sale: { logIndex: number; pool: Address }): boolean =>
      sale.logIndex > transfer.pos.logIndex && sale.pool === transfer.from;
    return sales.get(entry)?.some(fromSale) === true ? 'SALE_PROCEEDS' : null;
  };

  const applyTransfer = (transfer: TransferLog): void => {
    const reason = classify(transfer);
    if (reason !== null) {
      skipped.push({ pos: transfer.pos, to: transfer.to, amount: transfer.amount, reason });
      return;
    }
    const blockTimestamp = input.blockTimestamps.get(transfer.pos.blockNumber);
    if (blockTimestamp === undefined) {
      throw new IndexIntegrityError('BLOCK_TIME_MISSING', `no timestamp for block ${transfer.pos.blockNumber}`);
    }
    const payment: PaymentRecord = {
      pos: transfer.pos,
      blockTimestamp,
      from: transfer.from,
      to: transfer.to,
      amount: transfer.amount,
      status: 'RECEIVED',
      graceEndsAt: null,
      sortedBy: null,
    };
    payments.push(payment);
    unsorted.set(transfer.to, [...(unsorted.get(transfer.to) ?? []), payment]);
  };

  for (const entry of merge(input.events, input.transfers)) {
    if (entry.type === 'event') applyEvent(entry.event);
    else applyTransfer(entry.transfer);
  }

  const earlierPayments: EarlierPaymentsUpdate[] = [];
  for (const [account, state] of earlier) {
    if (state.change !== null) {
      earlierPayments.push({ account, epoch: state.epoch, beforeBlock: input.fromBlock, change: state.change });
    }
  }

  return {
    accounts: [...touched.values()],
    ruleVersions,
    receipts,
    reconciliations,
    payments,
    earlierPayments,
    skipped,
  };
}

/** Accounts whose transfers in a range can be payments: installed when it starts, or installed inside it. */
export function transferRecipients(
  accounts: ReadonlyMap<Address, AccountRecord>,
  events: readonly ModuleEvent[],
): Address[] {
  const recipients = new Set<Address>();
  for (const [address, record] of accounts) if (record.uninstalledAtBlock === null) recipients.add(address);
  for (const event of events) if (event.kind === 'Installed') recipients.add(event.account);
  return [...recipients].sort();
}

/**
 * Transactions where a transfer to an account precedes an OwnerOpEnded of the same account. Only these need their
 * receipt's UserOperationEvent logs to tell whose op the transfer was part of.
 */
export function transactionsNeedingBoundaries(
  events: readonly ModuleEvent[],
  transfers: readonly TransferLog[],
): Hex[] {
  const ends = bracketEnds(events);
  const txs = new Set<Hex>();
  for (const transfer of transfers) {
    const found = ends.get(key(transfer.pos.txHash, transfer.to));
    if (found?.some((index) => index > transfer.pos.logIndex) === true) txs.add(transfer.pos.txHash);
  }
  return [...txs];
}
