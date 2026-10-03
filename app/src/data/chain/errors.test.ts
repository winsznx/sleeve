import { sleeveModuleAbi } from '@sleeve/core';
import {
  CallExecutionError,
  RawContractError,
  encodeErrorResult,
  type AbiParameter,
  type Hex,
} from 'viem';
import { describe, expect, it } from 'vitest';

import { DataLayerError, type DataLayerErrorCode } from '../errors';
import { decodeRevert, revertDataOf, revertToDataLayerError, toDataLayerFailure } from './errors';

type ErrorItem = Extract<(typeof sleeveModuleAbi)[number], { type: 'error' }>;

const MODULE_ERRORS = sleeveModuleAbi.filter((item): item is ErrorItem => item.type === 'error');

/** A value of each Solidity type the module's errors take. Reason-like uint8s get 3 (SESSION), a member every enum has. */
function sample(parameter: AbiParameter): unknown {
  const type = parameter.type;
  if (type === 'address') return '0x00000000000000000000000000000000000000AA';
  if (type === 'bool') return true;
  if (type === 'bytes' || type === 'bytes32') return type === 'bytes' ? '0x1234' : `0x${'11'.repeat(32)}`;
  if (type.endsWith('[]')) return [];
  if (/^u?int(8|16|24|32|40|48)$/.test(type)) return 3;
  if (/^u?int\d*$/.test(type)) return 3n;
  throw new Error(`no sample for ${type}`);
}

function encoded(item: ErrorItem): Hex {
  return encodeErrorResult({
    abi: [item],
    errorName: item.name,
    args: item.inputs.map(sample),
  } as Parameters<typeof encodeErrorResult>[0]);
}

describe('module error decoding', () => {
  it('decodes every error in the module ABI, libraries included, to a named app error', () => {
    for (const item of MODULE_ERRORS) {
      // #given the revert data the module would return
      const data = encoded(item);
      // #when it is decoded and mapped
      const revert = decodeRevert(data);
      const mapped = revert === null ? null : revertToDataLayerError(revert);
      // #then it keeps its name and becomes a DataLayerError, never an unnamed failure
      expect(revert?.name, item.name).toBe(item.name);
      expect(mapped, item.name).toBeInstanceOf(DataLayerError);
      expect(mapped?.code, item.name).not.toBe('SourceUnavailable');
    }
  });

  const EXPECTED: Partial<Record<ErrorItem['name'], DataLayerErrorCode>> = {
    ExceedsBalance: 'ExceedsBalance',
    RouterBlocked: 'RouterBlocked',
    LotMismatch: 'LotMismatch',
    ZeroAmount: 'ZeroAmount',
    TooLittleUsdg: 'TooLittleUsdg',
    SellWaits: 'SellWaits',
    DiscountAboveCap: 'DiscountAboveCap',
    GracePeriodActive: 'GracePeriodActive',
    GuardNotClear: 'GuardNotClear',
    BelowClip: 'BelowClip',
    ExceedsLots: 'ExceedsLots',
    OverrideCapOutOfRange: 'OverrideCapOutOfRange',
    AccountBlocked: 'AccountBlocked',
    PoolBlocked: 'PoolBlocked',
    PoolNotAllowed: 'PoolNotAllowed',
    UnknownLot: 'UnknownLot',
    TooManyLots: 'TooManyLots',
    TooFewTokens: 'TooFewTokens',
    EmptyBucket: 'EmptyBucket',
    LedgersAboveBalance: 'LedgersAboveBalance',
    RuleNotActive: 'RuleNotActive',
    RuleNotPaused: 'RuleNotPaused',
    NoRule: 'NoRule',
    NothingWaiting: 'NothingWaiting',
    NotInstalled: 'NotInstalled',
    ModuleNotListed: 'ModuleNotListed',
    OwnerOpOpen: 'OwnerOpOpen',
    AccountLocked: 'AccountLocked',
    SharesSumNotTotal: 'InvalidRule',
    PremiumCapAboveMax: 'InvalidRule',
    SlippageAboveMax: 'InvalidRule',
    MinClipBelowFloor: 'InvalidRule',
    TickerNotActive: 'InvalidRule',
    PremiumAboveCap: 'GuardNotClear',
    ModuleHoldsFunds: 'ModuleReverted',
    PartialFill: 'ModuleReverted',
  };

  it.each(Object.entries(EXPECTED))('names %s as %s', (name, code) => {
    const item = MODULE_ERRORS.find((entry) => entry.name === name);
    expect(item).toBeDefined();
    expect(revertToDataLayerError(decodeRevert(encoded(item!))!).code).toBe(code);
  });

  it('carries the values a screen shows', () => {
    const exceeds = MODULE_ERRORS.find((entry) => entry.name === 'ExceedsBalance')!;
    const data = encodeErrorResult({ abi: [exceeds], errorName: 'ExceedsBalance', args: [5n, 2n] });
    expect(revertToDataLayerError(decodeRevert(data)!).detail).toEqual({ code: 'ExceedsBalance', tokenAmount: 5n, balance: 2n });

    const waits = MODULE_ERRORS.find((entry) => entry.name === 'SellWaits')!;
    const session = encodeErrorResult({ abi: [waits], errorName: 'SellWaits', args: [3] });
    expect(revertToDataLayerError(decodeRevert(session)!, { reopensAt: 1_790_000_000n }).detail).toEqual({
      code: 'SellWaits',
      reason: 'SESSION',
      reopensAt: 1_790_000_000n,
    });
    const stale = encodeErrorResult({ abi: [waits], errorName: 'SellWaits', args: [5] });
    expect(revertToDataLayerError(decodeRevert(stale)!).detail).toEqual({ code: 'SellWaits', reason: 'STALE', reopensAt: null });

    const guard = MODULE_ERRORS.find((entry) => entry.name === 'GuardNotClear')!;
    expect(revertToDataLayerError(decodeRevert(encodeErrorResult({ abi: [guard], errorName: 'GuardNotClear', args: [6] }))!).detail).toEqual({
      code: 'GuardNotClear',
      reason: 'DEPEG',
    });
  });

  it("names USDG's own refusal when a send asks more than the balance", () => {
    const data = encodeErrorResult({
      abi: [
        {
          type: 'error',
          name: 'ERC20InsufficientBalance',
          inputs: [
            { name: 'sender', type: 'address' },
            { name: 'balance', type: 'uint256' },
            { name: 'needed', type: 'uint256' },
          ],
        },
      ],
      errorName: 'ERC20InsufficientBalance',
      args: ['0x00000000000000000000000000000000000000AA', 4n, 9n],
    });
    expect(revertToDataLayerError(decodeRevert(data)!).detail).toEqual({ code: 'InsufficientBalance', balance: 4n, needed: 9n });
  });

  it('leaves unknown revert data undecoded instead of guessing', () => {
    expect(decodeRevert('0xdeadbeef')).toBeNull();
    expect(decodeRevert('0x')).toBeNull();
  });
});

describe('toDataLayerFailure', () => {
  const ruleNotActive = encoded(MODULE_ERRORS.find((entry) => entry.name === 'RuleNotActive')!);

  it('finds revert data inside a viem call error and names it', () => {
    const error = new CallExecutionError(new RawContractError({ data: ruleNotActive }), { account: undefined });
    expect(revertDataOf(error)).toBe(ruleNotActive);
    expect(toDataLayerFailure(error).code).toBe('RuleNotActive');
  });

  it('turns a closed passkey prompt into PasskeyCancelled', () => {
    expect(toDataLayerFailure(new DOMException('closed', 'NotAllowedError')).code).toBe('PasskeyCancelled');
  });

  it('turns a declined wallet request into WalletRejected and keeps the wallet error as the cause', () => {
    const declined = Object.assign(new Error('User rejected the request.'), { name: 'UserRejectedRequestError' });
    const failure = toDataLayerFailure(new Error('signing failed', { cause: declined }));
    expect(failure.code).toBe('WalletRejected');
    expect((failure.cause as Error).cause).toBe(declined);
  });

  it('passes a DataLayerError through unchanged', () => {
    const original = new DataLayerError({ code: 'NotSignedIn' }, 'sign in');
    expect(toDataLayerFailure(original)).toBe(original);
  });

  it('names anything else SourceUnavailable with its own message', () => {
    const failure = toDataLayerFailure(new Error('fetch failed'));
    expect([failure.code, failure.message]).toEqual(['SourceUnavailable', 'fetch failed']);
  });
});
