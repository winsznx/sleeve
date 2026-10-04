import {
  ACCOUNTING_MODES,
  ADDRESSES,
  REASONS,
  RULE_STATUSES,
  type Receipt,
  type Rule,
  STATUSES,
  TRIGGERS,
  enumMember,
  erc20Abi,
  sleeveModuleAbi,
} from '@sleeve/core';
import { type Address, type Hex, type Log, decodeEventLog, getAbiItem, toEventSelector } from 'viem';

import { IndexIntegrityError } from '../errors';

/** Where a log sits on chain. Block numbers are L2 block numbers, as logs give them. */
export interface LogPosition {
  blockNumber: bigint;
  logIndex: number;
  txHash: Hex;
}

/** Chain order of two positions. */
export function comparePositions(
  a: Pick<LogPosition, 'blockNumber' | 'logIndex'>,
  b: Pick<LogPosition, 'blockNumber' | 'logIndex'>,
): number {
  if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
  return a.logIndex - b.logIndex;
}

/** Addresses and hashes are lowercase everywhere in the index (supabase/README.md, values). */
export function lower<T extends string>(value: T): T {
  return value.toLowerCase() as T;
}

export type ModuleEvent =
  | { kind: 'Installed'; pos: LogPosition; account: Address; keeper: Address; spend: bigint }
  | { kind: 'Uninstalled'; pos: LogPosition; account: Address; released: bigint }
  | { kind: 'RuleSet'; pos: LogPosition; account: Address; version: number; rule: Rule }
  | { kind: 'RulePaused'; pos: LogPosition; account: Address; version: number }
  | { kind: 'RuleResumed'; pos: LogPosition; account: Address; version: number }
  | { kind: 'KeeperSet'; pos: LogPosition; account: Address; keeper: Address }
  | { kind: 'ReceiptWritten'; pos: LogPosition; receipt: Receipt; data: Hex }
  | { kind: 'Observed'; pos: LogPosition; account: Address; observedAt: bigint; observedUnsorted: bigint }
  | {
      kind: 'Reconciled';
      pos: LogPosition;
      account: Address;
      receiptId: bigint;
      balance: bigint;
      fromSpend: bigint;
      fromBuckets: readonly bigint[];
    }
  | { kind: 'OwnerOpEnded'; pos: LogPosition; account: Address; ownerDelta: bigint; moduleDelta: bigint }
  | { kind: 'LotsReconciled'; pos: LogPosition; account: Address; tickerId: number; balance: bigint; trimmed: bigint };

/** A USDG Transfer log. */
export interface TransferLog {
  pos: LogPosition;
  from: Address;
  to: Address;
  amount: bigint;
}

export function positionOf(log: Pick<Log, 'blockNumber' | 'logIndex' | 'transactionHash'>): LogPosition {
  if (log.blockNumber === null || log.logIndex === null || log.transactionHash === null) {
    throw new IndexIntegrityError('LOG_PENDING', 'a log without a block, index or transaction cannot be indexed');
  }
  return { blockNumber: log.blockNumber, logIndex: log.logIndex, txHash: lower(log.transactionHash) };
}

interface RawReceipt {
  id: bigint;
  account: Address;
  ruleVersion: number;
  trigger: number;
  payer: Address;
  status: number;
  reason: number;
  mode: number;
  tickerId: number;
  token: Address;
  tokenUid: Hex;
  usdgIn: bigint;
  usdgToSpend: bigint;
  usdgToEquity: bigint;
  usdgSpent: bigint;
  usdgQueued: bigint;
  tokensIn: bigint;
  tokensOut: bigint;
  usdgOut: bigint;
  uiMultiplier: bigint;
  execPrice: bigint;
  premiumBps: bigint;
  roundId: bigint;
  answer: bigint;
  updatedAt: bigint;
  usdgRoundId: bigint;
  usdgAnswer: bigint;
  quote: bigint;
  minOut: bigint;
  venueId: number;
  pool: Address;
  calendarVersion: number;
  disclosureHash: Hex;
  l2Block: bigint;
  timestamp: bigint;
  lotId: bigint;
  queuedSince: bigint;
  overrideClosed: boolean;
  overrideCapBps: number;
}

/** The decoded Receipt struct with its enums named and its addresses and hashes lowercase. */
export function receiptFromEvent(raw: RawReceipt): Receipt {
  return {
    ...raw,
    account: lower(raw.account),
    payer: lower(raw.payer),
    token: lower(raw.token),
    pool: lower(raw.pool),
    tokenUid: lower(raw.tokenUid),
    disclosureHash: lower(raw.disclosureHash),
    trigger: enumMember(TRIGGERS, raw.trigger),
    status: enumMember(STATUSES, raw.status),
    reason: enumMember(REASONS, raw.reason),
    mode: enumMember(ACCOUNTING_MODES, raw.mode),
  };
}

function ruleFromEvent(raw: {
  version: number;
  status: number;
  equityBps: number;
  tickerId: number;
  premiumCapBps: number;
  slippageBps: number;
  minClip: bigint;
}): Rule {
  return { ...raw, status: enumMember(RULE_STATUSES, raw.status) };
}

/** One module log as a typed event, or null for a topic the ABI does not know. */
export function decodeModuleLog(log: Log): ModuleEvent | null {
  let decoded;
  try {
    decoded = decodeEventLog({ abi: sleeveModuleAbi, data: log.data, topics: log.topics, strict: true });
  } catch {
    return null;
  }
  const pos = positionOf(log);
  switch (decoded.eventName) {
    case 'Installed':
      return {
        kind: 'Installed',
        pos,
        account: lower(decoded.args.account),
        keeper: lower(decoded.args.keeper),
        spend: decoded.args.spend,
      };
    case 'Uninstalled':
      return { kind: 'Uninstalled', pos, account: lower(decoded.args.account), released: decoded.args.released };
    case 'RuleSet':
      return {
        kind: 'RuleSet',
        pos,
        account: lower(decoded.args.account),
        version: decoded.args.version,
        rule: ruleFromEvent(decoded.args.rule),
      };
    case 'RulePaused':
      return { kind: 'RulePaused', pos, account: lower(decoded.args.account), version: decoded.args.version };
    case 'RuleResumed':
      return { kind: 'RuleResumed', pos, account: lower(decoded.args.account), version: decoded.args.version };
    case 'KeeperSet':
      return { kind: 'KeeperSet', pos, account: lower(decoded.args.account), keeper: lower(decoded.args.keeper) };
    case 'ReceiptWritten':
      return { kind: 'ReceiptWritten', pos, receipt: receiptFromEvent(decoded.args.receipt), data: lower(log.data) };
    case 'Observed':
      return {
        kind: 'Observed',
        pos,
        account: lower(decoded.args.account),
        observedAt: decoded.args.observedAt,
        observedUnsorted: decoded.args.observedUnsorted,
      };
    case 'Reconciled':
      return {
        kind: 'Reconciled',
        pos,
        account: lower(decoded.args.account),
        receiptId: decoded.args.receiptId,
        balance: decoded.args.balance,
        fromSpend: decoded.args.fromSpend,
        fromBuckets: decoded.args.fromBuckets,
      };
    case 'OwnerOpEnded':
      return {
        kind: 'OwnerOpEnded',
        pos,
        account: lower(decoded.args.account),
        ownerDelta: decoded.args.ownerDelta,
        moduleDelta: decoded.args.moduleDelta,
      };
    case 'LotsReconciled':
      return {
        kind: 'LotsReconciled',
        pos,
        account: lower(decoded.args.account),
        tickerId: decoded.args.tickerId,
        balance: decoded.args.balance,
        trimmed: decoded.args.trimmed,
      };
  }
}

export const TRANSFER_EVENT = getAbiItem({ abi: erc20Abi, name: 'Transfer' });

export function decodeTransferLog(log: Log): TransferLog {
  const decoded = decodeEventLog({ abi: erc20Abi, eventName: 'Transfer', data: log.data, topics: log.topics });
  return {
    pos: positionOf(log),
    from: lower(decoded.args.from),
    to: lower(decoded.args.to),
    amount: decoded.args.value,
  };
}

/**
 * EntryPoint v0.7's UserOperationEvent, emitted after each UserOp's execution. Inside a handleOps transaction, the
 * logs between two of these belong to one UserOp, which is how the indexer tells an owner's bracketed op apart from
 * a payer's op in the same bundle.
 */
export const USER_OPERATION_EVENT_TOPIC: Hex = toEventSelector(
  'UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)',
);

export const ENTRY_POINT: Address = lower(ADDRESSES.ENTRY_POINT_V07);

/** Log indexes of the UserOperationEvent logs in one transaction's receipt logs. */
export function userOperationBoundaries(logs: readonly Pick<Log, 'address' | 'topics' | 'logIndex'>[]): number[] {
  return logs
    .filter((log) => lower(log.address) === ENTRY_POINT && log.topics[0]?.toLowerCase() === USER_OPERATION_EVENT_TOPIC)
    .map((log) => log.logIndex)
    .filter((index): index is number => index !== null)
    .sort((a, b) => a - b);
}
