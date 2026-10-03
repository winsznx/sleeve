import { ADDRESSES, DEPLOYMENT_4663, erc20Abi, sleeveModuleAbi, type RuleInput, type TickerId } from '@sleeve/core';
import { encodeFunctionData, isAddressEqual, toFunctionSelector, type Address, type Hex } from 'viem';

import {
  decodeKernelBatch,
  encodeKernelBatch,
  installRecoverySignerCall,
  uninstallSleeveModuleCall,
  type Call,
} from './kernel';

/**
 * The owner-op builder (PRD I14, SPEC 7): the only way the app makes the callData of an owner UserOp. Every batch it
 * builds starts with beginOwnerOp and ends with endOwnerOp on the module, in one ERC-7579 batch with the default exec
 * type, so a failing call reverts the whole batch and no bracket is left open. It mirrors
 * contracts/test/utils/OwnerOps.sol, which the module's fork tests drive through handleOps.
 *
 * The one owner op it does not build is the install: beginOwnerOp needs the module installed (D-019).
 */

export const SLEEVE_MODULE: Address = DEPLOYMENT_4663.contracts.SleeveModule.address;

/**
 * Kernel calls onUninstall with whatever gas is left and ignores a failure, so an uninstall op carries a fixed call
 * gas limit and never the bundler's estimate (SPEC 6, D-019's floor of 400,000).
 */
export const UNINSTALL_CALL_GAS_LIMIT = 450_000n;
export const UNINSTALL_CALL_GAS_FLOOR = 400_000n;

export const BEGIN_OWNER_OP: Hex = toFunctionSelector('function beginOwnerOp()');
export const END_OWNER_OP: Hex = toFunctionSelector('function endOwnerOp()');

export interface SellCallArgs {
  tickerId: TickerId;
  tokenAmount: bigint;
  /** 0 sells oldest first; otherwise that lot only. */
  lotId: bigint;
  pool: Address;
  /** USDG base units per 1e18 token units (D-009 Q21). */
  quote: bigint;
  overrideClosed: boolean;
  overrideCapBps: number;
}

/** What an owner can do in one bracketed op. Each kind is one call or a fixed short sequence. */
export type BatchStep =
  | { kind: 'setRule'; rule: RuleInput }
  | { kind: 'pauseRule' }
  | { kind: 'resumeRule' }
  | { kind: 'split'; pool: Address; quote: bigint }
  | { kind: 'settle'; tickerId: TickerId; pool: Address; quote: bigint }
  | { kind: 'release'; tickerId: TickerId }
  | { kind: 'reconcileLots'; tickerId: TickerId }
  | { kind: 'sell'; sell: SellCallArgs }
  | { kind: 'withdraw'; to: Address; amount: bigint }
  | { kind: 'setKeeper'; keeper: Address }
  | { kind: 'installRecovery'; owner: Address }
  | { kind: 'uninstall' };

export type BatchStepKind = BatchStep['kind'];

/** A call list that already holds a bracket call for the module. A built op has exactly one bracket. */
export class NestedBracketCallError extends Error {
  constructor(readonly index: number) {
    super(`call ${index} is already a bracket call for the module`);
    this.name = 'NestedBracketCallError';
  }
}

/** callData the builder did not make: not a Kernel batch, or not opened and closed by the module's brackets. */
export class NotBracketedError extends Error {
  constructor(message: string) {
    super(`owner op is not bracketed (I14): ${message}`);
    this.name = 'NotBracketedError';
  }
}

function moduleCall(data: Hex): Call {
  return { to: SLEEVE_MODULE, value: 0n, data };
}

/** The calls one owner action makes, without brackets. */
export function stepCalls(account: Address, action: BatchStep): Call[] {
  switch (action.kind) {
    case 'setRule':
      return [moduleCall(encodeFunctionData({ abi: sleeveModuleAbi, functionName: 'setRule', args: [action.rule] }))];
    case 'pauseRule':
      return [moduleCall(encodeFunctionData({ abi: sleeveModuleAbi, functionName: 'pauseRule' }))];
    case 'resumeRule':
      return [moduleCall(encodeFunctionData({ abi: sleeveModuleAbi, functionName: 'resumeRule' }))];
    case 'split':
      return [
        moduleCall(
          encodeFunctionData({ abi: sleeveModuleAbi, functionName: 'split', args: [account, action.pool, action.quote] }),
        ),
      ];
    case 'settle':
      return [
        moduleCall(
          encodeFunctionData({
            abi: sleeveModuleAbi,
            functionName: 'settle',
            args: [account, action.tickerId, action.pool, action.quote],
          }),
        ),
      ];
    case 'release':
      return [moduleCall(encodeFunctionData({ abi: sleeveModuleAbi, functionName: 'release', args: [action.tickerId] }))];
    case 'reconcileLots':
      return [
        moduleCall(encodeFunctionData({ abi: sleeveModuleAbi, functionName: 'reconcileLots', args: [action.tickerId] })),
      ];
    case 'sell': {
      const sell = action.sell;
      // SPEC 12: lots come down to the balance before any sell in the batch, so tokens moved outside Sleeve never
      // make the sell revert ExceedsBalance. With nothing to trim it writes nothing.
      return [
        ...stepCalls(account, { kind: 'reconcileLots', tickerId: sell.tickerId }),
        moduleCall(
          encodeFunctionData({
            abi: sleeveModuleAbi,
            functionName: 'sell',
            args: [
              sell.tickerId,
              sell.tokenAmount,
              sell.lotId,
              sell.pool,
              sell.quote,
              sell.overrideClosed,
              sell.overrideCapBps,
            ],
          }),
        ),
      ];
    }
    case 'withdraw':
      return [
        {
          to: ADDRESSES.USDG,
          value: 0n,
          data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [action.to, action.amount] }),
        },
      ];
    case 'setKeeper':
      return [moduleCall(encodeFunctionData({ abi: sleeveModuleAbi, functionName: 'setKeeper', args: [action.keeper] }))];
    case 'installRecovery':
      return [installRecoverySignerCall(account, action.owner)];
    case 'uninstall':
      return [uninstallSleeveModuleCall(account, SLEEVE_MODULE)];
  }
}

/** Whether a call is beginOwnerOp or endOwnerOp on the module. */
export function isBracketCall(call: Call): boolean {
  if (!isAddressEqual(call.to, SLEEVE_MODULE) || call.data.length < 10) return false;
  const selector = call.data.slice(0, 10).toLowerCase();
  return selector === BEGIN_OWNER_OP || selector === END_OWNER_OP;
}

/** The owner's calls with beginOwnerOp first and endOwnerOp last. */
export function bracket(calls: readonly Call[]): Call[] {
  calls.forEach((call, index) => {
    if (isBracketCall(call)) throw new NestedBracketCallError(index);
  });
  return [moduleCall(BEGIN_OWNER_OP), ...calls, moduleCall(END_OWNER_OP)];
}

/**
 * Refuses callData that is not one Kernel batch opened by beginOwnerOp and closed by endOwnerOp on the module, with
 * no other bracket call inside. Runs on every owner op before it is signed.
 */
export function assertBracketed(callData: Hex): Call[] {
  const calls = decodeKernelBatch(callData);
  if (calls === null) throw new NotBracketedError('not a Kernel execute batch');
  const first = calls[0];
  const last = calls[calls.length - 1];
  if (calls.length < 2 || first === undefined || last === undefined) throw new NotBracketedError('fewer than two calls');
  const opens = isAddressEqual(first.to, SLEEVE_MODULE) && first.data.toLowerCase() === BEGIN_OWNER_OP && first.value === 0n;
  const closes = isAddressEqual(last.to, SLEEVE_MODULE) && last.data.toLowerCase() === END_OWNER_OP && last.value === 0n;
  if (!opens) throw new NotBracketedError('the first call is not beginOwnerOp on the module');
  if (!closes) throw new NotBracketedError('the last call is not endOwnerOp on the module');
  if (calls.slice(1, -1).some(isBracketCall)) throw new NotBracketedError('a bracket call sits inside the batch');
  return calls;
}

export interface OwnerOp {
  /** The bracketed batch, in order. */
  calls: Call[];
  /** execute(batch mode, calls): the UserOp's callData. */
  callData: Hex;
  /** Set when the op must not take the bundler's estimate (an uninstall). */
  callGasLimit: bigint | null;
}

/** One owner UserOp for these actions, checked bracketed before it leaves the builder. */
export function buildOwnerOp(account: Address, actions: readonly BatchStep[]): OwnerOp {
  if (actions.length === 0) throw new RangeError('an owner op needs at least one action');
  const calls = bracket(actions.flatMap((action) => stepCalls(account, action)));
  const callData = encodeKernelBatch(calls);
  assertBracketed(callData);
  const uninstalls = actions.some((action) => action.kind === 'uninstall');
  return { calls, callData, callGasLimit: uninstalls ? UNINSTALL_CALL_GAS_LIMIT : null };
}
