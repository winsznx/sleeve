import { ADDRESSES, RULE_DEFAULTS, sleeveModuleAbi } from '@sleeve/core';
import { decodeFunctionData, encodeFunctionData, getAddress, type Address } from 'viem';
import { describe, expect, it } from 'vitest';

import { decodeKernelBatch, encodeKernelBatch, installSleeveModuleCall, sleeveInstallData } from './kernel';
import {
  BEGIN_OWNER_OP,
  END_OWNER_OP,
  NestedBracketCallError,
  NotBracketedError,
  SLEEVE_MODULE,
  UNINSTALL_CALL_GAS_FLOOR,
  assertBracketed,
  bracket,
  buildOwnerOp,
  stepCalls,
  type BatchStep,
  type BatchStepKind,
} from './owner-ops';

const ACCOUNT: Address = '0x00000000000000000000000000000000000000aa';
const POOL: Address = '0xa7Bb1AC63BBaB0C44316E6c8C455213441689167';
const PAYEE: Address = '0x00000000000000000000000000000000000000bb';

/** One of every step the builder knows. The Record type fails to compile when a kind is added and not listed here. */
const EVERY_STEP: Record<BatchStepKind, BatchStep> = {
  setRule: { kind: 'setRule', rule: RULE_DEFAULTS },
  pauseRule: { kind: 'pauseRule' },
  resumeRule: { kind: 'resumeRule' },
  split: { kind: 'split', pool: POOL, quote: 270_000_000_000_000n },
  settle: { kind: 'settle', tickerId: 0, pool: POOL, quote: 270_000_000_000_000n },
  release: { kind: 'release', tickerId: 2 },
  reconcileLots: { kind: 'reconcileLots', tickerId: 1 },
  sell: {
    kind: 'sell',
    sell: { tickerId: 0, tokenAmount: 10n ** 17n, lotId: 0n, pool: POOL, quote: 3_700_000_000n, overrideClosed: false, overrideCapBps: 0 },
  },
  withdraw: { kind: 'withdraw', to: PAYEE, amount: 10_000_000n },
  setKeeper: { kind: 'setKeeper', keeper: PAYEE },
  installRecovery: { kind: 'installRecovery', owner: PAYEE },
  uninstall: { kind: 'uninstall' },
};

function selectorOf(data: `0x${string}`): string {
  return data.slice(0, 10).toLowerCase();
}

describe('the owner-op builder (I14)', () => {
  it.each(Object.values(EVERY_STEP))('opens with beginOwnerOp and closes with endOwnerOp on the module for $kind', (step) => {
    // #given one owner step
    // #when the builder makes its UserOp callData
    const op = buildOwnerOp(ACCOUNT, [step]);
    const calls = decodeKernelBatch(op.callData);
    // #then the decoded batch is bracketed by the module and nothing else is a bracket call
    expect(calls).not.toBeNull();
    const batch = calls ?? [];
    expect(batch[0]).toEqual({ to: SLEEVE_MODULE, value: 0n, data: BEGIN_OWNER_OP });
    expect(batch[batch.length - 1]).toEqual({ to: SLEEVE_MODULE, value: 0n, data: END_OWNER_OP });
    expect(batch.slice(1, -1).map((call) => selectorOf(call.data))).not.toContain(BEGIN_OWNER_OP);
    expect(batch.slice(1, -1).map((call) => selectorOf(call.data))).not.toContain(END_OWNER_OP);
    const checksummed = stepCalls(ACCOUNT, step).map((call) => ({ ...call, to: getAddress(call.to) }));
    expect(batch.slice(1, -1)).toEqual(checksummed);
  });

  it('brackets a batch of several steps once, around all of them', () => {
    const steps = [EVERY_STEP.release, EVERY_STEP.withdraw, EVERY_STEP.setRule];
    const batch = decodeKernelBatch(buildOwnerOp(ACCOUNT, steps).callData) ?? [];
    expect(batch.map((call) => selectorOf(call.data))).toEqual([
      BEGIN_OWNER_OP,
      ...steps.flatMap((step) => stepCalls(ACCOUNT, step)).map((call) => selectorOf(call.data)),
      END_OWNER_OP,
    ]);
  });

  it('reconciles lots before every sell in the batch (SPEC 12)', () => {
    const inner = stepCalls(ACCOUNT, EVERY_STEP.sell);
    const names = inner.map((call) => decodeFunctionData({ abi: sleeveModuleAbi, data: call.data }).functionName);
    expect(names).toEqual(['reconcileLots', 'sell']);
  });

  it('sends a withdraw as a USDG transfer from the account to the payee', () => {
    const [transfer] = stepCalls(ACCOUNT, EVERY_STEP.withdraw);
    expect(transfer?.to).toBe(ADDRESSES.USDG);
    expect(transfer?.data).toBe(
      encodeFunctionData({
        abi: [{ type: 'function', name: 'transfer', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' }],
        functionName: 'transfer',
        args: [PAYEE, 10_000_000n],
      }),
    );
  });

  it('gives an uninstall a fixed call gas limit at or above the D-019 floor, and nothing else one', () => {
    expect(buildOwnerOp(ACCOUNT, [EVERY_STEP.uninstall]).callGasLimit).toBeGreaterThanOrEqual(UNINSTALL_CALL_GAS_FLOOR);
    expect(UNINSTALL_CALL_GAS_FLOOR).toBe(400_000n);
    expect(buildOwnerOp(ACCOUNT, [EVERY_STEP.withdraw]).callGasLimit).toBeNull();
  });

  it('refuses a call list that already holds a bracket call', () => {
    const smuggled = { to: SLEEVE_MODULE, value: 0n, data: END_OWNER_OP } as const;
    expect(() => bracket([...stepCalls(ACCOUNT, EVERY_STEP.withdraw), smuggled])).toThrow(NestedBracketCallError);
  });

  it('refuses an op with no steps', () => {
    expect(() => buildOwnerOp(ACCOUNT, [])).toThrow(RangeError);
  });
});

describe('assertBracketed', () => {
  const inner = stepCalls(ACCOUNT, EVERY_STEP.withdraw);

  it('accepts what the builder makes', () => {
    expect(() => assertBracketed(buildOwnerOp(ACCOUNT, [EVERY_STEP.withdraw]).callData)).not.toThrow();
  });

  it('refuses a batch without brackets', () => {
    expect(() => assertBracketed(encodeKernelBatch(inner))).toThrow(NotBracketedError);
  });

  it('refuses a batch whose brackets name another module', () => {
    const other: Address = '0x000000000000000000000000000000000000dEaD';
    const forged = [{ to: other, value: 0n, data: BEGIN_OWNER_OP }, ...inner, { to: other, value: 0n, data: END_OWNER_OP }];
    expect(() => assertBracketed(encodeKernelBatch(forged))).toThrow(NotBracketedError);
  });

  it('refuses a batch that only opens the bracket', () => {
    expect(() => assertBracketed(encodeKernelBatch([{ to: SLEEVE_MODULE, value: 0n, data: BEGIN_OWNER_OP }, ...inner]))).toThrow(
      NotBracketedError,
    );
  });

  it('refuses a second bracket inside the batch', () => {
    const nested = [...bracket(inner)];
    nested.splice(2, 0, { to: SLEEVE_MODULE, value: 0n, data: BEGIN_OWNER_OP });
    expect(() => assertBracketed(encodeKernelBatch(nested))).toThrow(NotBracketedError);
  });

  it('refuses the install call, the one owner op that cannot be bracketed', () => {
    const install = installSleeveModuleCall(ACCOUNT, SLEEVE_MODULE, sleeveInstallData('0x0000000000000000000000000000000000000000', RULE_DEFAULTS));
    expect(() => assertBracketed(install.data)).toThrow(NotBracketedError);
  });
});
