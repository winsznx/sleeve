import { sleeveModuleAbi } from '@sleeve/core';
import { encodeEventTopics, keccak256 } from 'viem';
import { describe, expect, it } from 'vitest';

import { RECEIPT_WRITTEN_TOPIC, decodeReceiptLog, encodeReceipt, hashReceipt, isReceiptLog, receiptKind } from '../src/receipt';
import { MODULE, blankReceipt, filledSplit, receiptLog } from './support/fixtures';

describe('the receipt encoding', () => {
  it('hashes abi.encode(receipt), which is also the log data', () => {
    // #given a receipt and its log
    const { receipt, evidence } = filledSplit();
    // #when / #then the hash is keccak256 of the log data, and decoding returns the same receipt
    expect(hashReceipt(receipt)).toBe(keccak256(evidence.receiptLog.data));
    const decoded = decodeReceiptLog(evidence.receiptLog);
    expect(decoded.ok && decoded.value.receipt).toEqual(receipt);
  });

  it('keeps the indexed topics apart from the struct', () => {
    const receipt = blankReceipt({ id: 12n, status: 'QUEUED', reason: 'SESSION' });
    const log = receiptLog(receipt, { logIndex: 0 });
    const decoded = decodeReceiptLog({ ...log, topics: [log.topics[0] ?? RECEIPT_WRITTEN_TOPIC, log.topics[1] ?? '0x', log.topics[2] ?? '0x', receiptLog(blankReceipt({ status: 'SOLD' }), { logIndex: 0 }).topics[3] ?? '0x'] });
    expect(decoded.ok && decoded.value.topicStatus).toBe('SOLD');
    expect(decoded.ok && decoded.value.receipt.status).toBe('QUEUED');
  });

  it('reports a log that is not a receipt instead of throwing', () => {
    expect(decodeReceiptLog({ topics: [], data: '0x' }).ok).toBe(false);
    expect(decodeReceiptLog({ topics: [RECEIPT_WRITTEN_TOPIC], data: encodeReceipt(blankReceipt()) }).ok).toBe(false);
  });

  it('reports an enum index the contract cannot write', () => {
    const data = encodeReceipt(blankReceipt());
    const log = receiptLog(blankReceipt(), { logIndex: 0 });
    // The status word of the struct is its sixth field.
    const words = data.slice(2).match(/.{64}/g) ?? [];
    words[5] = '9'.padStart(64, '0');
    const result = decodeReceiptLog({ topics: log.topics, data: `0x${words.join('')}` });
    expect(result.ok).toBe(false);
  });

  it('uses the module ABI topic', () => {
    expect(RECEIPT_WRITTEN_TOPIC).toBe(encodeEventTopics({ abi: sleeveModuleAbi, eventName: 'ReceiptWritten' })[0]);
    expect(isReceiptLog({ address: MODULE, topics: [RECEIPT_WRITTEN_TOPIC] }, MODULE)).toBe(true);
    expect(isReceiptLog({ address: '0x0000000000000000000000000000000000000001', topics: [RECEIPT_WRITTEN_TOPIC] }, MODULE)).toBe(false);
  });
});

describe('the kind of a receipt', () => {
  it.each([
    [{ status: 'FILLED' as const }, 'SPLIT_FILL'],
    [{ status: 'QUEUED' as const }, 'SPLIT_QUEUE'],
    [{ status: 'SETTLED' as const }, 'SETTLE_FILL'],
    [{ status: 'REFUSED_TICKER' as const, usdgIn: 1n }, 'SPLIT_REFUSAL'],
    [{ status: 'REFUSED_ACCOUNT' as const, usdgIn: 0n }, 'SETTLE_REFUSAL'],
    [{ status: 'RELEASED' as const }, 'RELEASE'],
    [{ status: 'PART_SOLD' as const }, 'SELL'],
    [{ status: 'SOLD' as const }, 'SELL'],
    [{ status: 'RECONCILED' as const }, 'LEDGER_RECONCILE'],
    [{ status: 'RECONCILED' as const, token: '0x117cc2133c37B721F49dE2A7a74833232B3B4C0C' as const }, 'LOT_RECONCILE'],
  ])('%o is %s', (overrides, kind) => {
    expect(receiptKind(blankReceipt(overrides))).toBe(kind);
  });
});
