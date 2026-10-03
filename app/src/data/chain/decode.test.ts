import { DEPLOYMENT_4663, sleeveModuleAbi, type Receipt } from '@sleeve/core';
import { encodeAbiParameters, encodeEventTopics, getAbiItem, keccak256, type Log } from 'viem';
import { describe, expect, it } from 'vitest';

import { decodeReceiptLog, encodeReceipt, findOwnerOpEnded, receiptHashOf } from './decode';
import { receiptsInLogs } from './history';

const ACCOUNT = '0x00000000000000000000000000000000000000AA';
const MODULE = DEPLOYMENT_4663.contracts.SleeveModule.address;

const FILLED: Receipt = {
  id: 7n,
  account: ACCOUNT,
  ruleVersion: 2,
  trigger: 'KEEPER',
  payer: '0x0000000000000000000000000000000000000000',
  status: 'FILLED',
  reason: 'NONE',
  mode: 'WRAPPED',
  tickerId: 0,
  token: '0x117cc2133c37B721F49dE2A7a74833232B3B4C0C',
  tokenUid: '0x000000000000000000000000000000001c6f27a62789417d8ed359ed3c2d3da1',
  usdgIn: 100_000_000n,
  usdgToSpend: 90_000_000n,
  usdgToEquity: 10_000_000n,
  usdgSpent: 10_000_000n,
  usdgQueued: 0n,
  tokensIn: 0n,
  tokensOut: 14_812_345_678_901_234n,
  usdgOut: 0n,
  uiMultiplier: 10n ** 18n,
  execPrice: 675_115_000n,
  premiumBps: 37n,
  roundId: 147n,
  answer: 67_260_000_000n,
  updatedAt: 1_790_000_000n,
  usdgRoundId: 9n,
  usdgAnswer: 100_010_000n,
  quote: 1_481_234_567_890n,
  minOut: 14_738_000_000_000_000n,
  venueId: 1,
  pool: '0xa7Bb1AC63BBaB0C44316E6c8C455213441689167',
  calendarVersion: 1,
  disclosureHash: '0x8408c7a59df30d1b5dbec102c388048f2bf8bba21a2e91ac0806df7d68068e89',
  l2Block: 79_400_000n,
  timestamp: 1_790_000_100n,
  lotId: 7n,
  queuedSince: 0n,
  overrideClosed: false,
  overrideCapBps: 0,
};

function receiptLog(receipt: Receipt, logIndex = 3): Log {
  return {
    address: MODULE.toLowerCase() as `0x${string}`,
    topics: encodeEventTopics({
      abi: sleeveModuleAbi,
      eventName: 'ReceiptWritten',
      args: { id: receipt.id, account: receipt.account, status: 0 },
    }) as Log['topics'],
    data: encodeReceipt(receipt),
    blockNumber: 79_400_000n,
    blockHash: `0x${'ab'.repeat(32)}`,
    logIndex,
    transactionHash: `0x${'cd'.repeat(32)}`,
    transactionIndex: 1,
    removed: false,
  };
}

describe('ReceiptWritten decoding', () => {
  it('reads every field back with the enum names, and the log data is abi.encode(receipt)', () => {
    // #given a ReceiptWritten log as the module emits it
    const log = receiptLog(FILLED);
    // #when it is decoded
    const decoded = decodeReceiptLog(log);
    // #then the receipt comes back field for field
    expect(decoded.receipt).toEqual(FILLED);
    expect(decoded.dataHash).toBe(keccak256(log.data));
    expect(receiptHashOf(FILLED)).toBe(decoded.dataHash);
  });

  it('encodes the struct as the event declares it, 39 words', () => {
    const components = getAbiItem({ abi: sleeveModuleAbi, name: 'ReceiptWritten' }).inputs[3].components;
    expect(components).toHaveLength(39);
    expect(encodeReceipt(FILLED)).toBe(
      encodeAbiParameters([{ type: 'tuple', components }], [{ ...FILLED, trigger: 0, status: 0, reason: 0, mode: 0 }]),
    );
    expect((encodeReceipt(FILLED).length - 2) / 64).toBe(39);
  });

  it('refuses an enum index the contract cannot produce instead of showing another status', () => {
    const log = receiptLog(FILLED);
    const words = log.data.slice(2).match(/.{64}/g) ?? [];
    words[5] = '00000000000000000000000000000000000000000000000000000000000000ff';
    expect(() => decodeReceiptLog({ ...log, data: `0x${words.join('')}` })).toThrow(RangeError);
  });

  it("keeps only the account's receipts from a transaction's logs, ascending id", () => {
    const other = { ...FILLED, id: 6n, account: '0x00000000000000000000000000000000000000bb' } as const;
    const second = { ...FILLED, id: 8n, status: 'RECONCILED' } as const;
    const found = receiptsInLogs([receiptLog(second, 5), receiptLog(other, 2), receiptLog(FILLED, 4)], ACCOUNT);
    expect(found.map((entry) => entry.receipt.id)).toEqual([7n, 8n]);
  });
});

describe('OwnerOpEnded', () => {
  it("finds the account's own event among a transaction's logs", () => {
    const log: Log = {
      ...receiptLog(FILLED),
      topics: encodeEventTopics({ abi: sleeveModuleAbi, eventName: 'OwnerOpEnded', args: { account: ACCOUNT } }) as Log['topics'],
      data: encodeAbiParameters(
        [
          { type: 'uint256' },
          { type: 'int256' },
          { type: 'int256' },
          { type: 'uint256' },
          { type: 'uint256' },
          { type: 'uint256[]' },
        ],
        [30_000_000n, 0n, -10_000_000n, 10_000_000n, 0n, [0n, 0n]],
      ),
    };
    expect(findOwnerOpEnded([log], ACCOUNT)).toMatchObject({ ownerDelta: -10_000_000n, fromSpend: 10_000_000n });
    expect(findOwnerOpEnded([log], '0x00000000000000000000000000000000000000bb')).toBeNull();
  });
});
