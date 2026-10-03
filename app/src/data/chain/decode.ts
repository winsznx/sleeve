import {
  ACCOUNTING_MODES,
  DEPLOYMENT_4663,
  REASONS,
  RULE_STATUSES,
  STATUSES,
  TRIGGERS,
  enumMember,
  sleeveModuleAbi,
  type Receipt,
  type Rule,
} from '@sleeve/core';
import {
  decodeEventLog,
  encodeAbiParameters,
  encodeEventTopics,
  getAbiItem,
  isAddressEqual,
  keccak256,
  type Address,
  type DecodeEventLogReturnType,
  type Hex,
  type Log,
} from 'viem';

/**
 * SleeveModule events as the app reads them. Enum fields arrive as uint8 and leave as the member name, through
 * enumMember, which throws on an index the contract cannot produce rather than showing some other status.
 */

const receiptWrittenEvent = getAbiItem({ abi: sleeveModuleAbi, name: 'ReceiptWritten' });
const receiptComponents = receiptWrittenEvent.inputs[3].components;

/** The raw tuple viem decodes for the Receipt struct. */
export type RawReceipt = DecodeEventLogReturnType<typeof sleeveModuleAbi, 'ReceiptWritten'>['args']['receipt'];

export function receiptFromRaw(raw: RawReceipt): Receipt {
  return {
    ...raw,
    trigger: enumMember(TRIGGERS, raw.trigger),
    status: enumMember(STATUSES, raw.status),
    reason: enumMember(REASONS, raw.reason),
    mode: enumMember(ACCOUNTING_MODES, raw.mode),
  };
}

/** abi.encode(receipt): the bytes receiptHash(id) hashes and the ReceiptWritten log carries as its data. */
export function encodeReceipt(receipt: Receipt): Hex {
  const raw = {
    ...receipt,
    trigger: TRIGGERS.indexOf(receipt.trigger),
    status: STATUSES.indexOf(receipt.status),
    reason: REASONS.indexOf(receipt.reason),
    mode: ACCOUNTING_MODES.indexOf(receipt.mode),
  };
  return encodeAbiParameters([{ type: 'tuple', components: receiptComponents }], [raw]);
}

/** keccak256(abi.encode(receipt)), as SleeveReceipts stores it. */
export function receiptHashOf(receipt: Receipt): Hex {
  return keccak256(encodeReceipt(receipt));
}

export interface ReceiptLog {
  receipt: Receipt;
  txHash: Hex;
  blockNumber: bigint;
  logIndex: number;
  /** keccak256 of the log data, which is abi.encode(receipt). */
  dataHash: Hex;
}

type AnyLog = Pick<Log, 'data' | 'topics' | 'transactionHash' | 'blockNumber' | 'logIndex'>;

function position(log: AnyLog): { txHash: Hex; blockNumber: bigint; logIndex: number } {
  if (log.transactionHash === null || log.blockNumber === null || log.logIndex === null) {
    throw new RangeError('a pending log has no position yet');
  }
  return { txHash: log.transactionHash, blockNumber: log.blockNumber, logIndex: log.logIndex };
}

export function decodeReceiptLog(log: AnyLog): ReceiptLog {
  const decoded = decodeEventLog({ abi: sleeveModuleAbi, eventName: 'ReceiptWritten', data: log.data, topics: log.topics });
  return { receipt: receiptFromRaw(decoded.args.receipt), ...position(log), dataHash: keccak256(log.data) };
}

export function ruleFromRaw(raw: {
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

export interface RuleSetLog {
  rule: Rule;
  blockNumber: bigint;
  logIndex: number;
}

export function decodeRuleSetLog(log: AnyLog): RuleSetLog {
  const decoded = decodeEventLog({ abi: sleeveModuleAbi, eventName: 'RuleSet', data: log.data, topics: log.topics });
  const { blockNumber, logIndex } = position(log);
  return { rule: ruleFromRaw(decoded.args.rule), blockNumber, logIndex };
}

export interface ReconciledLog {
  receiptId: bigint;
  balance: bigint;
  fromSpend: bigint;
  /** Indexed by ticker id. */
  fromBuckets: readonly bigint[];
}

export function decodeReconciledLog(log: AnyLog): ReconciledLog {
  const decoded = decodeEventLog({ abi: sleeveModuleAbi, eventName: 'Reconciled', data: log.data, topics: log.topics });
  return {
    receiptId: decoded.args.receiptId,
    balance: decoded.args.balance,
    fromSpend: decoded.args.fromSpend,
    fromBuckets: decoded.args.fromBuckets,
  };
}

export interface OwnerOpEndedLog {
  balanceAtBegin: bigint;
  moduleDelta: bigint;
  ownerDelta: bigint;
  fromSpend: bigint;
  fromUnsorted: bigint;
  fromBuckets: readonly bigint[];
  txHash: Hex;
}

export function decodeOwnerOpEndedLog(log: AnyLog): OwnerOpEndedLog {
  const decoded = decodeEventLog({ abi: sleeveModuleAbi, eventName: 'OwnerOpEnded', data: log.data, topics: log.topics });
  return { ...decoded.args, txHash: log.transactionHash ?? '0x' };
}

const OWNER_OP_ENDED_TOPIC = encodeEventTopics({ abi: sleeveModuleAbi, eventName: 'OwnerOpEnded' })[0];

/** The OwnerOpEnded event for this account among a transaction's (or a simulation's) logs, or null. */
export function findOwnerOpEnded(logs: readonly (AnyLog & Pick<Log, 'address'>)[], account: Address): OwnerOpEndedLog | null {
  const log = logs.find(
    (entry) =>
      isAddressEqual(entry.address, DEPLOYMENT_4663.contracts.SleeveModule.address) &&
      entry.topics[0] === OWNER_OP_ENDED_TOPIC &&
      entry.topics[1] !== undefined &&
      isAddressEqual(`0x${entry.topics[1].slice(26)}`, account),
  );
  return log === undefined ? null : decodeOwnerOpEndedLog(log);
}
