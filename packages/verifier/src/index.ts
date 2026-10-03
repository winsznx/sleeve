/**
 * The Sleeve verifier (PRD 10, D-009 Q36): recomputes a receipt from public chain data and shows every field with
 * its receipt value, its recomputed value and MATCH or MISMATCH. The app's /verify page and the CLI both import this
 * entry, so it stays free of Node APIs: tsconfig.json checks src without Node types, and tsconfig.node.json checks
 * the CLI and the tests with them.
 */

export { verifyReceipt, createReader, disclosureHashOf, type VerifyOptions } from './verify';
export { checkEvidence, notFoundResult } from './check';
export type { CheckOptions } from './checks';
export { gatherEvidence, type GatherOptions, type Gathered } from './gather';
export { viemReader, MULTICALL3, type ChainReader, type LogFilter, type ContractCall, type CallOutcome } from './reader';
export { throttledHttp, RequestQueue, classifyRefusal, type ThrottleOptions } from './transport';
export { LogScanner, rangeRefusal } from './logs';
export { findSellRun, findBuyFill, proRataShares, WHOLE_SELL_FIELDS, type SellRun, type BuyFill } from './trades';
export { decodeReceiptLog, encodeReceipt, hashReceipt, receiptKind, RECEIPT_WRITTEN_TOPIC, type ReceiptKind } from './receipt';
export {
  VerifierError,
  ProviderBlockedError,
  ChainMismatchError,
  ReceiptLogMissingError,
  LogRangeTooNarrowError,
  InvalidReceiptIdError,
  ReadFailedError,
  parseReceiptId,
  type VerifierErrorCode,
} from './errors';
export type { Evidence, RawLog, Reading } from './evidence';
export type { VerifyResult, FieldRow, CheckRow, DerivedRow, RowStatus, Verdict, ValueUnit, Relation } from './types';
