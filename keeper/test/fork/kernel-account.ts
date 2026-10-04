import { ADDRESSES, type RuleInput, sleeveModuleAbi } from '@sleeve/core';
import {
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  concatHex,
  decodeEventLog,
  encodeAbiParameters,
  encodeFunctionData,
  parseAbiParameters,
  toHex,
  zeroAddress,
} from 'viem';
import type { LocalAccount } from 'viem/accounts';

import { USER_OPERATION_EVENT_TOPIC } from '../../src/chain/events';

/**
 * A Kernel v3.1 account on the fork, built the way contracts/test/utils/KernelHelpers.sol and the app build it: the
 * deployed factory through the meta factory, ZeroDev's ECDSA validator as root, the module installed in the first
 * UserOp's callData (D-019), and owner ops bracketed by beginOwnerOp and endOwnerOp (I14), all sent through
 * EntryPoint v0.7 handleOps with a root signature. ABIs are the few functions the test calls.
 */

export const KERNEL_FACTORY: Address = '0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419';
export const META_FACTORY: Address = '0xd703aaE79538628d27099B8c4f621bE4CCd142d5';
export const ECDSA_VALIDATOR: Address = '0x845ADb2C711129d4f3966735eD98a9F09fC4cE57';
const ENTRY_POINT: Address = ADDRESSES.ENTRY_POINT_V07;
const BATCH_EXEC_MODE: Hex = '0x0100000000000000000000000000000000000000000000000000000000000000';

const kernelAbi = [
  {
    type: 'function',
    name: 'initialize',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'rootValidator', type: 'bytes21' },
      { name: 'hook', type: 'address' },
      { name: 'validatorData', type: 'bytes' },
      { name: 'hookData', type: 'bytes' },
      { name: 'initConfig', type: 'bytes[]' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'installModule',
    stateMutability: 'payable',
    inputs: [
      { name: 'moduleType', type: 'uint256' },
      { name: 'module', type: 'address' },
      { name: 'initData', type: 'bytes' },
    ],
    outputs: [],
  },
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
] as const;

const factoryAbi = [
  {
    type: 'function',
    name: 'getAddress',
    stateMutability: 'view',
    inputs: [
      { name: 'data', type: 'bytes' },
      { name: 'salt', type: 'bytes32' },
    ],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;

const metaFactoryAbi = [
  {
    type: 'function',
    name: 'deployWithFactory',
    stateMutability: 'payable',
    inputs: [
      { name: 'factory', type: 'address' },
      { name: 'createData', type: 'bytes' },
      { name: 'salt', type: 'bytes32' },
    ],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;

const packedUserOperation = {
  type: 'tuple',
  components: [
    { name: 'sender', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'initCode', type: 'bytes' },
    { name: 'callData', type: 'bytes' },
    { name: 'accountGasLimits', type: 'bytes32' },
    { name: 'preVerificationGas', type: 'uint256' },
    { name: 'gasFees', type: 'bytes32' },
    { name: 'paymasterAndData', type: 'bytes' },
    { name: 'signature', type: 'bytes' },
  ],
} as const;

const entryPointAbi = [
  {
    type: 'function',
    name: 'handleOps',
    stateMutability: 'nonpayable',
    inputs: [
      { ...packedUserOperation, name: 'ops', type: 'tuple[]' },
      { name: 'beneficiary', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'getUserOpHash',
    stateMutability: 'view',
    inputs: [{ ...packedUserOperation, name: 'userOp' }],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'getNonce',
    stateMutability: 'view',
    inputs: [
      { name: 'sender', type: 'address' },
      { name: 'key', type: 'uint192' },
    ],
    outputs: [{ name: 'nonce', type: 'uint256' }],
  },
  {
    type: 'event',
    name: 'UserOperationEvent',
    inputs: [
      { name: 'userOpHash', type: 'bytes32', indexed: true },
      { name: 'sender', type: 'address', indexed: true },
      { name: 'paymaster', type: 'address', indexed: true },
      { name: 'nonce', type: 'uint256', indexed: false },
      { name: 'success', type: 'bool', indexed: false },
      { name: 'actualGasCost', type: 'uint256', indexed: false },
      { name: 'actualGasUsed', type: 'uint256', indexed: false },
    ],
    anonymous: false,
  },
] as const;

/** Kernel.initialize data: the ECDSA validator as root (0x01 then its address) for the owner, no hook, no initConfig. */
export function initData(owner: Address): Hex {
  return encodeFunctionData({
    abi: kernelAbi,
    functionName: 'initialize',
    args: [concatHex(['0x01', ECDSA_VALIDATOR]), zeroAddress, owner, '0x', []],
  });
}

export async function accountAddress(client: PublicClient, owner: Address, salt: Hex): Promise<Address> {
  return client.readContract({ address: KERNEL_FACTORY, abi: factoryAbi, functionName: 'getAddress', args: [initData(owner), salt] });
}

/** The first UserOp's initCode: the meta factory and deployWithFactory(factory, initData, salt), the SDK's default. */
export function initCode(owner: Address, salt: Hex): Hex {
  return concatHex([
    META_FACTORY,
    encodeFunctionData({ abi: metaFactoryAbi, functionName: 'deployWithFactory', args: [KERNEL_FACTORY, initData(owner), salt] }),
  ]);
}

/** SleeveModule.onInstall data: abi.encode(keeper, RuleInput), 224 bytes (SPEC 6). */
export function sleeveInstallData(keeper: Address, rule: RuleInput): Hex {
  return encodeAbiParameters(
    parseAbiParameters('address keeper, (uint16 spendBps, uint16 equityBps, uint8 tickerId, uint16 premiumCapBps, uint16 slippageBps, uint128 minClip) rule'),
    [keeper, rule],
  );
}

/** The account's installModule call: executor type 2, no hook, abi.encode(moduleData, hookData). */
export function installModuleCall(module: Address, moduleData: Hex): Hex {
  const executorInitData = concatHex([zeroAddress, encodeAbiParameters(parseAbiParameters('bytes executorData, bytes hookData'), [moduleData, '0x'])]);
  return encodeFunctionData({ abi: kernelAbi, functionName: 'installModule', args: [2n, module, executorInitData] });
}

export interface Call {
  to: Address;
  data: Hex;
}

/** execute(batch) with beginOwnerOp first and endOwnerOp last: an owner op as the app builds it (I14). */
export function bracketedOwnerOp(module: Address, calls: readonly Call[]): Hex {
  const bracket = [
    { target: module, value: 0n, callData: encodeFunctionData({ abi: sleeveModuleAbi, functionName: 'beginOwnerOp' }) },
    ...calls.map((call) => ({ target: call.to, value: 0n, callData: call.data })),
    { target: module, value: 0n, callData: encodeFunctionData({ abi: sleeveModuleAbi, functionName: 'endOwnerOp' }) },
  ];
  const batch = encodeAbiParameters(parseAbiParameters('(address target, uint256 value, bytes callData)[]'), [bracket]);
  return encodeFunctionData({ abi: kernelAbi, functionName: 'execute', args: [BATCH_EXEC_MODE, batch] });
}

/** The SDK's nonce key for a root validator: mode 0, type 0 (root), the validator, parallel key 0. */
function rootNonceKey(): bigint {
  return BigInt(ECDSA_VALIDATOR) << 16n;
}

function packed(high: bigint, low: bigint): Hex {
  return toHex((high << 128n) | low, { size: 32 });
}

export interface UserOpResult {
  success: boolean;
  txHash: Hex;
}

/** One root UserOp signed by the owner and sent alone through handleOps by the bundler. */
export async function sendUserOp(
  client: PublicClient,
  bundler: WalletClient,
  owner: LocalAccount,
  op: { sender: Address; initCode: Hex; callData: Hex },
): Promise<UserOpResult> {
  const nonce = await client.readContract({ address: ENTRY_POINT, abi: entryPointAbi, functionName: 'getNonce', args: [op.sender, rootNonceKey()] });
  const block = await client.getBlock();
  const userOp = {
    sender: op.sender,
    nonce,
    initCode: op.initCode,
    callData: op.callData,
    accountGasLimits: packed(2_000_000n, 2_000_000n),
    preVerificationGas: 100_000n,
    gasFees: packed(0n, (block.baseFeePerGas ?? 1n) * 2n),
    paymasterAndData: '0x' as Hex,
    signature: '0x' as Hex,
  };
  const userOpHash = await client.readContract({ address: ENTRY_POINT, abi: entryPointAbi, functionName: 'getUserOpHash', args: [userOp] });
  if (owner.signMessage === undefined) throw new Error('the owner cannot sign messages');
  const signature = await owner.signMessage({ message: { raw: userOpHash } });
  const account = bundler.account;
  if (account === undefined) throw new Error('the bundler has no account');
  const txHash = await bundler.writeContract({
    address: ENTRY_POINT,
    abi: entryPointAbi,
    functionName: 'handleOps',
    args: [[{ ...userOp, signature }], account.address],
    account,
    chain: bundler.chain ?? null,
    gas: 6_000_000n,
  });
  const receipt = await client.waitForTransactionReceipt({ hash: txHash });
  const outcome = receipt.logs.find(
    (log) => log.address.toLowerCase() === ENTRY_POINT.toLowerCase() && log.topics[0] === USER_OPERATION_EVENT_TOPIC && log.topics[1] === userOpHash,
  );
  if (outcome === undefined) throw new Error(`no UserOperationEvent for ${userOpHash} in ${txHash}`);
  const event = decodeEventLog({ abi: entryPointAbi, eventName: 'UserOperationEvent', data: outcome.data, topics: outcome.topics });
  return { success: event.args.success, txHash };
}
