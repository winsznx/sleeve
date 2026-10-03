import type { RuleInput } from '@sleeve/core';
import {
  concatHex,
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseAbiParameters,
  stringToBytes,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem';

/**
 * ZeroDev Kernel v3.1 on Robinhood Chain (docs/research/zerodev-passkey.md sections 2 and 3, g6-notes.md): the
 * addresses the SDK uses, the account calls Sleeve makes, and the ERC-7579 batch encoding every owner op goes through.
 * ABIs are JSON because copy-lint reads the word "returns" in a human-readable ABI as a performance claim.
 */

export const KERNEL_V31 = {
  implementation: '0xBAC849bB641841b44E965fB01A4Bf5F074f84b4D',
  factory: '0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419',
  metaFactory: '0xd703aaE79538628d27099B8c4f621bE4CCd142d5',
} as const satisfies Record<string, Address>;

/** ZeroDev's ECDSA validator for Kernel 0.3.1 and later: a wallet owner's root, or a passkey account's recovery. */
export const ECDSA_VALIDATOR: Address = '0x845ADb2C711129d4f3966735eD98a9F09fC4cE57';
/** ZeroDev's passkey (WebAuthn) validator 0.0.3, the only passkey validator deployed on 4663. */
export const WEBAUTHN_VALIDATOR: Address = '0x7ab16Ff354AcB328452F1D445b3Ddee9a91e9e69';

export const MODULE_TYPE_VALIDATOR = 1n;
export const MODULE_TYPE_EXECUTOR = 2n;
export const KERNEL_EXECUTE_SELECTOR: Hex = '0xe9ae5c53';

/** ERC-7579 mode: batch call type, default exec type (revert on any failure), no selector, no payload. */
export const BATCH_EXEC_MODE: Hex = '0x0100000000000000000000000000000000000000000000000000000000000000';

/**
 * The CREATE2 salt of every wallet-owned Sleeve account. Without initConfig (D-019) the address commits only to the
 * owner and this salt, so the SDK default of 0 is the address every other ZeroDev Kernel v3.1 app gives the same
 * wallet. A Sleeve salt keeps a fresh account. It is part of every address: final before the first real user.
 */
export const SLEEVE_ACCOUNT_INDEX = BigInt(keccak256(stringToBytes('sleeve.wallet-account.v1')));

const moduleArgs = [
  { name: 'moduleType', type: 'uint256' },
  { name: 'module', type: 'address' },
] as const;

export const kernelAbi = [
  {
    type: 'function',
    name: 'execute',
    stateMutability: 'payable',
    inputs: [
      { name: 'execMode', type: 'bytes32' },
      { name: 'executionCalldata', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'installModule',
    stateMutability: 'payable',
    inputs: [...moduleArgs, { name: 'initData', type: 'bytes' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'uninstallModule',
    stateMutability: 'payable',
    inputs: [...moduleArgs, { name: 'deInitData', type: 'bytes' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'isModuleInstalled',
    stateMutability: 'view',
    inputs: [...moduleArgs, { name: 'additionalContext', type: 'bytes' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'rootValidator',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bytes21' }],
  },
  {
    type: 'event',
    name: 'ModuleUninstallResult',
    inputs: [
      { name: 'module', type: 'address', indexed: false },
      { name: 'result', type: 'bool', indexed: false },
    ],
  },
] as const;

export const ecdsaValidatorAbi = [
  {
    type: 'function',
    name: 'ecdsaValidatorStorage',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: 'owner', type: 'address' }],
  },
] as const;

export const webAuthnValidatorAbi = [
  {
    type: 'function',
    name: 'webAuthnValidatorStorage',
    stateMutability: 'view',
    inputs: [{ name: 'kernel', type: 'address' }],
    outputs: [
      { name: 'pubKeyX', type: 'uint256' },
      { name: 'pubKeyY', type: 'uint256' },
    ],
  },
] as const;

/** One call of an ERC-7579 batch. */
export interface Call {
  to: Address;
  value: bigint;
  data: Hex;
}

const EXECUTION_BATCH = parseAbiParameters('(address target, uint256 value, bytes callData)[]');

/** execute(batch mode, abi.encode(calls)): the callData of an owner UserOp. */
export function encodeKernelBatch(calls: readonly Call[]): Hex {
  const batch = encodeAbiParameters(EXECUTION_BATCH, [
    calls.map((call) => ({ target: call.to, value: call.value, callData: call.data })),
  ]);
  return encodeFunctionData({ abi: kernelAbi, functionName: 'execute', args: [BATCH_EXEC_MODE, batch] });
}

/** The calls of an execute(batch) callData, or null when the callData is anything else. */
export function decodeKernelBatch(callData: Hex): Call[] | null {
  let decoded;
  try {
    decoded = decodeFunctionData({ abi: kernelAbi, data: callData });
  } catch {
    return null;
  }
  if (decoded.functionName !== 'execute') return null;
  const [mode, executionCalldata] = decoded.args;
  if (mode.toLowerCase() !== BATCH_EXEC_MODE) return null;
  const [calls] = decodeAbiParameters(EXECUTION_BATCH, executionCalldata);
  return calls.map((call) => ({ to: call.target, value: call.value, data: call.callData }));
}

/** An all-zero rule: SleeveModule installs with status NONE (SPEC 6). */
export const NO_RULE: RuleInput = { spendBps: 0, equityBps: 0, tickerId: 0, premiumCapBps: 0, slippageBps: 0, minClip: 0n };

/** SleeveModule.onInstall data, abi.encode(keeper, RuleInput), 224 bytes (SPEC 6). A zero keeper is the default keeper. */
export function sleeveInstallData(keeper: Address, rule: RuleInput | null): Hex {
  return encodeAbiParameters(
    parseAbiParameters(
      'address keeper, (uint16 spendBps, uint16 equityBps, uint8 tickerId, uint16 premiumCapBps, uint16 slippageBps, uint128 minClip) rule',
    ),
    [keeper, rule ?? NO_RULE],
  );
}

/** Kernel v3.1 executor initData: no hook, then abi.encode(executorData, hookData), as KernelHelpers._executorInitData. */
export function executorInitData(moduleData: Hex): Hex {
  return concatHex([zeroAddress, encodeAbiParameters(parseAbiParameters('bytes executorData, bytes hookData'), [moduleData, '0x'])]);
}

/**
 * The account's call to itself that installs the module. As the only call of the first UserOp the SDK sends it
 * unwrapped, the shape of KernelHelpers._deployThenInstall (path (b), D-019). It is the one owner op without
 * brackets: beginOwnerOp needs the module installed, and the install snapshot books the balance (I5).
 */
export function installSleeveModuleCall(account: Address, sleeveModule: Address, installData: Hex): Call {
  return {
    to: account,
    value: 0n,
    data: encodeFunctionData({
      abi: kernelAbi,
      functionName: 'installModule',
      args: [MODULE_TYPE_EXECUTOR, sleeveModule, executorInitData(installData)],
    }),
  };
}

/** The account removes the module from itself. Sent inside a bracket: endOwnerOp tolerates it (SPEC 7). */
export function uninstallSleeveModuleCall(account: Address, sleeveModule: Address): Call {
  return {
    to: account,
    value: 0n,
    data: encodeFunctionData({ abi: kernelAbi, functionName: 'uninstallModule', args: [MODULE_TYPE_EXECUTOR, sleeveModule, '0x'] }),
  };
}

/**
 * The recovery wallet of a passkey account: ZeroDev's ECDSA validator as a secondary validator allowed to call
 * execute (zerodev-passkey.md 9.3). The deployed validator refuses a second owner on one account, so a wallet-owned
 * account cannot add one.
 */
export function installRecoverySignerCall(account: Address, recoveryOwner: Address): Call {
  return {
    to: account,
    value: 0n,
    data: encodeFunctionData({
      abi: kernelAbi,
      functionName: 'installModule',
      args: [
        MODULE_TYPE_VALIDATOR,
        ECDSA_VALIDATOR,
        concatHex([
          zeroAddress,
          encodeAbiParameters(parseAbiParameters('bytes validatorData, bytes hookData, bytes selectorData'), [
            recoveryOwner,
            '0x',
            KERNEL_EXECUTE_SELECTOR,
          ]),
        ]),
      ],
    }),
  };
}

/** Kernel's root validator id is 0x01 followed by the validator address. */
export function rootValidatorAddress(rootId: Hex): Address | null {
  if (rootId.length !== 44 || !rootId.toLowerCase().startsWith('0x01')) return null;
  return `0x${rootId.slice(4)}`;
}
