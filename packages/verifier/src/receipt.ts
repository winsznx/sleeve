import {
  ACCOUNTING_MODES,
  REASONS,
  STATUSES,
  TRIGGERS,
  enumMember,
  sleeveModuleAbi,
  type Hex,
  type Receipt,
  type Status,
} from '@sleeve/core';
import {
  decodeEventLog,
  encodeAbiParameters,
  encodeEventTopics,
  getAbiItem,
  keccak256,
  type AbiParameterToPrimitiveType,
} from 'viem';

import type { RawLog } from './evidence';

/**
 * The receipt as the module hashes and logs it (docs/SPEC.md section 13): ReceiptWritten carries the whole Receipt
 * struct, and receiptHash(id) stores keccak256(abi.encode(receipt)). The tuple's ABI comes from the module's own ABI
 * in packages/core, so the encoding here is the contract's.
 */

const receiptWritten = getAbiItem({ abi: sleeveModuleAbi, name: 'ReceiptWritten' });
const receiptParameter = receiptWritten.inputs[3];

/** The Receipt struct as viem decodes it: enums are their uint8 values. */
export type RawReceipt = AbiParameterToPrimitiveType<typeof receiptParameter>;

/** topic0 of ReceiptWritten. */
export const RECEIPT_WRITTEN_TOPIC: Hex = encodeEventTopics({ abi: sleeveModuleAbi, eventName: 'ReceiptWritten' })[0];

/** Converts the decoded struct to the core Receipt, naming each enum member. Throws RangeError on an unknown index. */
export function receiptFromRaw(raw: RawReceipt): Receipt {
  return {
    ...raw,
    trigger: enumMember(TRIGGERS, raw.trigger),
    status: enumMember(STATUSES, raw.status),
    reason: enumMember(REASONS, raw.reason),
    mode: enumMember(ACCOUNTING_MODES, raw.mode),
  };
}

export function receiptToRaw(receipt: Receipt): RawReceipt {
  return {
    ...receipt,
    trigger: TRIGGERS.indexOf(receipt.trigger),
    status: STATUSES.indexOf(receipt.status),
    reason: REASONS.indexOf(receipt.reason),
    mode: ACCOUNTING_MODES.indexOf(receipt.mode),
  };
}

/** abi.encode(receipt), which is also the data of its ReceiptWritten log. */
export function encodeReceipt(receipt: Receipt): Hex {
  return encodeAbiParameters([receiptParameter], [receiptToRaw(receipt)]);
}

/** keccak256(abi.encode(receipt)): what receiptHash(id) stores. */
export function hashReceipt(receipt: Receipt): Hex {
  return keccak256(encodeReceipt(receipt));
}

/** A ReceiptWritten log decoded, with the three indexed values kept apart from the struct's own copies. */
export interface DecodedReceiptLog {
  topicId: bigint;
  topicAccount: Hex;
  topicStatus: Status;
  receipt: Receipt;
}

export type ReceiptDecodeResult = { ok: true; value: DecodedReceiptLog } | { ok: false; error: string };

export function decodeReceiptLog(log: Pick<RawLog, 'topics' | 'data'>): ReceiptDecodeResult {
  try {
    const [signature, ...rest] = log.topics;
    if (signature === undefined) return { ok: false, error: 'the log has no topics' };
    const { args } = decodeEventLog({
      abi: sleeveModuleAbi,
      eventName: 'ReceiptWritten',
      topics: [signature, ...rest],
      data: log.data,
    });
    return {
      ok: true,
      value: {
        topicId: args.id,
        topicAccount: args.account,
        topicStatus: enumMember(STATUSES, args.status),
        receipt: receiptFromRaw(args.receipt),
      },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Whether a log is a ReceiptWritten from the given module. */
export function isReceiptLog(log: Pick<RawLog, 'address' | 'topics'>, module: Hex): boolean {
  return log.address.toLowerCase() === module.toLowerCase() && log.topics[0] === RECEIPT_WRITTEN_TOPIC;
}

/**
 * What wrote the receipt, from the fields SPEC 13 fixes per action: a split always sorts unsorted USDG, so its
 * receipts carry usdgIn above zero, while a settle's carry usdgIn zero; a ledger reconcile names no token, a lot
 * reconcile does.
 */
export type ReceiptKind =
  | 'SPLIT_FILL'
  | 'SPLIT_QUEUE'
  | 'SPLIT_REFUSAL'
  | 'SETTLE_FILL'
  | 'SETTLE_REFUSAL'
  | 'RELEASE'
  | 'SELL'
  | 'LEDGER_RECONCILE'
  | 'LOT_RECONCILE';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export function receiptKind(receipt: Receipt): ReceiptKind {
  switch (receipt.status) {
    case 'FILLED':
      return 'SPLIT_FILL';
    case 'QUEUED':
      return 'SPLIT_QUEUE';
    case 'SETTLED':
      return 'SETTLE_FILL';
    case 'REFUSED_TICKER':
    case 'REFUSED_ACCOUNT':
      return receipt.usdgIn > 0n ? 'SPLIT_REFUSAL' : 'SETTLE_REFUSAL';
    case 'RELEASED':
      return 'RELEASE';
    case 'PART_SOLD':
    case 'SOLD':
      return 'SELL';
    case 'RECONCILED':
      return receipt.token.toLowerCase() === ZERO_ADDRESS ? 'LEDGER_RECONCILE' : 'LOT_RECONCILE';
  }
}

/** Kinds whose swap is in the receipt's transaction: a buy, or a sell's run. */
export function isBuyKind(kind: ReceiptKind): kind is 'SPLIT_FILL' | 'SETTLE_FILL' {
  return kind === 'SPLIT_FILL' || kind === 'SETTLE_FILL';
}

/** Kinds written by a split, whose usdgIn is the unsorted USDG it sorted. */
export function isSplitKind(kind: ReceiptKind): kind is 'SPLIT_FILL' | 'SPLIT_QUEUE' | 'SPLIT_REFUSAL' {
  return kind === 'SPLIT_FILL' || kind === 'SPLIT_QUEUE' || kind === 'SPLIT_REFUSAL';
}
