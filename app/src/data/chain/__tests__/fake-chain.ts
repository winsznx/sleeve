import { ADDRESSES, DISCLOSURE, RULE_DEFAULTS, RULE_STATUSES, STATUSES, erc20Abi, sleeveModuleAbi, tickerById, tokenSourceAbi, type Receipt, type Rule, type TickerId } from '@sleeve/core';
import {
  RawContractError,
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeAbiParameters,
  encodeErrorResult,
  encodeEventTopics,
  encodeFunctionResult,
  formatLog,
  getAddress,
  isAddressEqual,
  multicall3Abi,
  numberToHex,
  parseAbi,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
  type RpcLog,
} from 'viem';
import type { UserOperation } from 'viem/account-abstraction';

import { sleeveChain } from '@/lib/chain/chain';
import { ECDSA_VALIDATOR, SLEEVE_ACCOUNT_INDEX, WEBAUTHN_VALIDATOR, ecdsaValidatorAbi, kernelAbi } from '@/lib/chain/kernel';
import { encodePublicKey } from '@/lib/chain/webauthn';

import { DataLayerError } from '../../errors';
import type { SleeveDataLayer } from '../../types';
import { CONTRACTS } from '../context';
import { createChainDataLayer } from '../data-layer';
import { encodeReceipt } from '../decode';
import { localCredentialStore, memorySessionStore, type StoredSession } from '../session';
import type { PreparedOp, PrepareRequest, UserOpRoute } from '../user-ops';

/**
 * A fake Robinhood Chain for the chain data layer's unit tests (D-040, D-041): a viem client on a fake RPC that answers
 * the reads the layer makes, and a recording route that stands in for the bundler, where each op "lands" by changing
 * the fake chain's state and returning the transaction's logs. Assertions read what the layer read back, the way the
 * chain would answer it.
 */

export const ACCOUNT = getAddress('0x5ee1e00000000000000000000000000000c0ffee');
export const PAYEE = getAddress('0x15373ca332fbb73a8559de6e2bb32974dc68d613');
/** Someone who pays the account, and in the send tests a token address that is not USDG. */
export const PAYER = getAddress('0x2222222222222222222222222222222222222222');
/** The wallet that owns ACCOUNT in the wallet session tests: the EntryPoint answers ACCOUNT for its init code. */
export const OWNER_WALLET = getAddress('0x05a1c0ffee00000000000000000000000000b92d');
/** What the EntryPoint answers for any other init code: an address nothing was deployed at. */
export const UNDEPLOYED = getAddress('0x000000000000000000000000000000000000dead');
const KEEPER = getAddress('0x8649275ca7ce63d2f9e6487570ec0dce14b6bf46');
const MULTICALL3 = getAddress('0xca11bde05977b3631167028862be2a173976ca11');
export const HEAD = 80_000_100n;
export const OP_BLOCK = 80_000_050n;
export const BLOCK_TIME = 1_790_445_600n;
export const TX_HASH: Hex = `0x${'cd'.repeat(32)}`;
const BLOCK_HASH: Hex = `0x${'ab'.repeat(32)}`;
const USER_OP_HASH: Hex = `0x${'ef'.repeat(32)}`;
export const STORED_HASH: Hex = `0x${'aa'.repeat(32)}`;

export const SESSION: StoredSession = {
  account: ACCOUNT,
  signer: { kind: 'passkey', credentialId: 'c2xlZXZlLXRlc3Q', rpId: 'localhost', publicKey: encodePublicKey({ x: 1n, y: 2n }) },
  signedInAt: BLOCK_TIME.toString(),
};

export const NO_RULE: Rule = { version: 0, status: 'NONE', equityBps: 0, tickerId: 0, premiumCapBps: 0, slippageBps: 0, minClip: 0n };

/** The suggested rule as the module reads it back at a version: 10 percent to SPY. */
export function suggestedRule(version: number): Rule {
  const { equityBps, tickerId, premiumCapBps, slippageBps, minClip } = RULE_DEFAULTS;
  return { version, status: 'ACTIVE', equityBps, tickerId, premiumCapBps, slippageBps, minClip };
}

export const ACTIVE_RULE = suggestedRule(2);

export interface ChainState {
  deployed: boolean;
  initialized: boolean;
  listed: boolean;
  rule: Rule;
  /** USDG before the op's block, and from that block on. */
  balanceBefore: bigint;
  balanceAfter: bigint;
  /** USDG waiting in each ticker's bucket, by ticker id; a ticker left out has none. */
  buckets?: Partial<Record<TickerId, bigint>>;
}

/** TokenSource lists the four launch tickers. */
const TICKER_COUNT = 4n;

export function installed(): ChainState {
  return { deployed: true, initialized: true, listed: true, rule: ACTIVE_RULE, balanceBefore: 500_000_000n, balanceAfter: 500_000_000n };
}

export function removed(): ChainState {
  return { deployed: true, initialized: false, listed: false, rule: NO_RULE, balanceBefore: 500_000_000n, balanceAfter: 500_000_000n };
}

/** Nothing deployed at ACCOUNT yet: the counterfactual address before its first UserOp. */
export function undeployed(): ChainState {
  return { deployed: false, initialized: false, listed: false, rule: NO_RULE, balanceBefore: 0n, balanceAfter: 0n };
}

function rawRule(rule: Rule) {
  return { ...rule, status: RULE_STATUSES.indexOf(rule.status) };
}

function moduleAnswer(state: ChainState, data: Hex): Hex {
  const call = decodeFunctionData({ abi: sleeveModuleAbi, data });
  switch (call.functionName) {
    case 'isInitialized':
      return encodeFunctionResult({ abi: sleeveModuleAbi, functionName: 'isInitialized', result: state.initialized });
    case 'keeperOf':
      return encodeFunctionResult({ abi: sleeveModuleAbi, functionName: 'keeperOf', result: state.initialized ? KEEPER : zeroAddress });
    case 'defaultKeeper':
      return encodeFunctionResult({ abi: sleeveModuleAbi, functionName: 'defaultKeeper', result: KEEPER });
    case 'ruleOf':
      return encodeFunctionResult({ abi: sleeveModuleAbi, functionName: 'ruleOf', result: rawRule(state.rule) });
    case 'receiptHash':
      return encodeFunctionResult({ abi: sleeveModuleAbi, functionName: 'receiptHash', result: STORED_HASH });
    case 'bucketOf': {
      const amount = state.buckets?.[Number(call.args[1])] ?? 0n;
      return encodeFunctionResult({ abi: sleeveModuleAbi, functionName: 'bucketOf', result: { amount, since: 0n, reason: 3 } });
    }
    default:
      throw new Error(`the fake module does not answer ${call.functionName}`);
  }
}

function kernelAnswer(state: ChainState, data: Hex): Hex {
  const call = decodeFunctionData({ abi: kernelAbi, data });
  if (call.functionName === 'isModuleInstalled') {
    return encodeFunctionResult({ abi: kernelAbi, functionName: 'isModuleInstalled', result: state.listed });
  }
  if (call.functionName === 'rootValidator') {
    return encodeFunctionResult({ abi: kernelAbi, functionName: 'rootValidator', result: `0x01${WEBAUTHN_VALIDATOR.slice(2)}` });
  }
  throw new Error(`the fake account does not answer ${call.functionName}`);
}

function balanceAt(state: ChainState, block: string): bigint {
  return block !== 'latest' && BigInt(block) < OP_BLOCK ? state.balanceBefore : state.balanceAfter;
}

function answer(state: ChainState, to: Address, data: Hex, block: string): Hex {
  if (isAddressEqual(to, MULTICALL3)) {
    const call = decodeFunctionData({ abi: multicall3Abi, data });
    if (call.functionName !== 'aggregate3') throw new Error(`the fake multicall does not answer ${call.functionName}`);
    const results = call.args[0].map((inner) => ({ success: true, returnData: answer(state, inner.target, inner.callData, block) }));
    return encodeFunctionResult({ abi: multicall3Abi, functionName: 'aggregate3', result: results });
  }
  if (isAddressEqual(to, CONTRACTS.module)) return moduleAnswer(state, data);
  if (isAddressEqual(to, CONTRACTS.tokenSource)) {
    const call = decodeFunctionData({ abi: tokenSourceAbi, data });
    if (call.functionName !== 'tickerCount') throw new Error(`the fake TokenSource does not answer ${call.functionName}`);
    return encodeFunctionResult({ abi: tokenSourceAbi, functionName: 'tickerCount', result: TICKER_COUNT });
  }
  if (isAddressEqual(to, ACCOUNT)) return kernelAnswer(state, data);
  if (isAddressEqual(to, ECDSA_VALIDATOR)) {
    return encodeFunctionResult({ abi: ecdsaValidatorAbi, functionName: 'ecdsaValidatorStorage', result: zeroAddress });
  }
  if (isAddressEqual(to, CONTRACTS.usdg)) {
    return encodeFunctionResult({ abi: erc20Abi, functionName: 'balanceOf', result: balanceAt(state, block) });
  }
  throw new Error(`the fake chain has no contract at ${to}`);
}

const entryPointAbi = parseAbi(['function getSenderAddress(bytes initCode)', 'error SenderAddressResult(address sender)']);

/** The Sleeve salt as it sits in a factory call: one 32-byte word. */
const SLEEVE_SALT_WORD = SLEEVE_ACCOUNT_INDEX.toString(16).padStart(64, '0');

/**
 * EntryPoint.getSenderAddress, which always reverts with the address an init code deploys to. ACCOUNT answers only the
 * init code of a Kernel account that OWNER_WALLET owns on the Sleeve salt, so any other owner or salt finds nothing.
 */
function senderAddressRevert(data: Hex): RawContractError {
  const { args } = decodeFunctionData({ abi: entryPointAbi, data });
  const initCode = args[0].toLowerCase();
  const sleeveAccount = initCode.includes(OWNER_WALLET.slice(2).toLowerCase()) && initCode.includes(SLEEVE_SALT_WORD);
  const sender = sleeveAccount ? ACCOUNT : UNDEPLOYED;
  return new RawContractError({ data: encodeErrorResult({ abi: entryPointAbi, errorName: 'SenderAddressResult', args: [sender] }) });
}

export interface Simulation {
  success: boolean;
  logs: RpcLog[];
}

/** A viem client on a fake RPC: the reads the chain layer makes, and eth_simulateV1 answering `simulation`. */
export function fakeClient(state: ChainState, simulation: Simulation = { success: true, logs: [] }): PublicClient {
  return createPublicClient({
    chain: sleeveChain,
    transport: custom({
      async request({ method, params }: { method: string; params?: unknown }) {
        const args = (params ?? []) as unknown[];
        switch (method) {
          case 'eth_chainId':
            return numberToHex(sleeveChain.id);
          case 'eth_blockNumber':
            return numberToHex(HEAD);
          case 'eth_getCode': {
            const [address] = args as [Address];
            return state.deployed && isAddressEqual(address, ACCOUNT) ? '0xef0100' : '0x';
          }
          case 'eth_getLogs':
            return [];
          case 'eth_getBlockByNumber':
            return {
              number: args[0] === 'latest' ? numberToHex(HEAD) : args[0],
              timestamp: numberToHex(BLOCK_TIME),
              hash: BLOCK_HASH,
              parentHash: BLOCK_HASH,
              transactions: [],
            };
          case 'eth_simulateV1':
            return [{ calls: [{ status: simulation.success ? '0x1' : '0x0', returnData: '0x', gasUsed: '0x30d40', logs: simulation.logs }] }];
          case 'eth_call': {
            const [call, block] = args as [{ to: Address; data: Hex }, string];
            if (isAddressEqual(call.to, ADDRESSES.ENTRY_POINT_V07)) throw senderAddressRevert(call.data);
            return answer(state, call.to, call.data, block);
          }
          default:
            throw new Error(`the fake chain does not answer ${method}`);
        }
      },
    }),
  });
}

export function rpcLog(address: Address, topics: RpcLog['topics'], data: Hex, logIndex: number): RpcLog {
  return {
    address,
    topics,
    data,
    blockNumber: numberToHex(OP_BLOCK),
    blockHash: BLOCK_HASH,
    logIndex: numberToHex(logIndex),
    transactionHash: TX_HASH,
    transactionIndex: '0x1',
    removed: false,
  };
}

export function releasedReceipt(id: bigint, tickerId: TickerId, amount: bigint): Receipt {
  const ticker = tickerById(tickerId);
  if (ticker === undefined) throw new Error(`no ticker ${tickerId}`);
  return {
    id,
    account: ACCOUNT,
    ruleVersion: 2,
    trigger: 'OWNER',
    payer: zeroAddress,
    status: 'RELEASED',
    reason: 'SESSION',
    mode: 'WRAPPED',
    tickerId,
    token: ticker.token,
    tokenUid: ticker.tokenUid,
    usdgIn: amount,
    usdgToSpend: amount,
    usdgToEquity: 0n,
    usdgSpent: 0n,
    usdgQueued: 0n,
    tokensIn: 0n,
    tokensOut: 0n,
    usdgOut: 0n,
    uiMultiplier: 0n,
    execPrice: 0n,
    premiumBps: 0n,
    roundId: 0n,
    answer: 0n,
    updatedAt: 0n,
    usdgRoundId: 0n,
    usdgAnswer: 0n,
    quote: 0n,
    minOut: 0n,
    venueId: 0,
    pool: zeroAddress,
    calendarVersion: 1 << 16,
    disclosureHash: DISCLOSURE.keccak256,
    l2Block: OP_BLOCK,
    timestamp: BLOCK_TIME,
    lotId: 0n,
    queuedSince: BLOCK_TIME - 3_600n,
    overrideClosed: false,
    overrideCapBps: 0,
  };
}

export function releasedLog(receipt: Receipt, logIndex: number): RpcLog {
  const topics = encodeEventTopics({
    abi: sleeveModuleAbi,
    eventName: 'ReceiptWritten',
    args: { id: receipt.id, account: receipt.account, status: STATUSES.indexOf(receipt.status) },
  });
  return rpcLog(CONTRACTS.module, topics as RpcLog['topics'], encodeReceipt(receipt), logIndex);
}

export function uninstallResultLog(result: boolean, logIndex: number): RpcLog {
  const topics = encodeEventTopics({ abi: kernelAbi, eventName: 'ModuleUninstallResult' });
  return rpcLog(ACCOUNT, topics as RpcLog['topics'], encodeAbiParameters([{ type: 'address' }, { type: 'bool' }], [CONTRACTS.module, result]), logIndex);
}

export function ownerOpEndedLog(ownerDelta: bigint, fromSpend: bigint, logIndex: number): RpcLog {
  const topics = encodeEventTopics({ abi: sleeveModuleAbi, eventName: 'OwnerOpEnded', args: { account: ACCOUNT } });
  const data = encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'int256' }, { type: 'int256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256[]' }],
    [500_000_000n, 0n, ownerDelta, fromSpend, 0n, [0n, 0n, 0n, 0n]],
  );
  return rpcLog(CONTRACTS.module, topics as RpcLog['topics'], data, logIndex);
}

/** A Transfer log, from USDG unless `token` says otherwise. */
export function usdgTransferLog(from: Address, to: Address, amount: bigint, logIndex: number, token: Address = ADDRESSES.USDG): RpcLog {
  const topics = encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer', args: { from, to } });
  return rpcLog(token, topics as RpcLog['topics'], encodeAbiParameters([{ type: 'uint256' }], [amount]), logIndex);
}

export interface RecordingRoute extends UserOpRoute {
  readonly prepared: PrepareRequest[];
}

/**
 * The bundler's part: records what it was asked to prepare, prepares it sponsored with the request's call gas limit as
 * a route that keeps it does, and on send lands the op: `land` changes the chain and `logs` are the transaction's.
 */
export function landingRoute(state: ChainState, land: (state: ChainState) => void, logs: RpcLog[]): RecordingRoute {
  const prepared: PrepareRequest[] = [];
  return {
    name: 'handle-ops',
    prepared,
    async prepare(account, request): Promise<PreparedOp> {
      prepared.push(request);
      const userOp: UserOperation<'0.7'> = {
        sender: account.address,
        nonce: 0n,
        callData: request.callData,
        callGasLimit: request.callGasLimit ?? 300_000n,
        verificationGasLimit: 700_000n,
        preVerificationGas: 60_000n,
        maxFeePerGas: 2n,
        maxPriorityFeePerGas: 0n,
        signature: '0x',
      };
      const gas = userOp.callGasLimit + userOp.verificationGasLimit + userOp.preVerificationGas;
      return { userOp, sponsored: true, gas, maxCostWei: gas * userOp.maxFeePerGas };
    },
    async send() {
      land(state);
      return USER_OP_HASH;
    },
    async wait(userOpHash) {
      return { userOpHash, success: true, revertData: null, txHash: TX_HASH, blockNumber: OP_BLOCK, logs: logs.map((log) => formatLog(log)) };
    },
  };
}

export const PASSKEY_SIGNATURE: Hex = `0x${'5a'.repeat(96)}`;

/** The chain layer on the fake chain, signed in as `session` (the passkey session unless given). */
export function chainLayer(client: PublicClient, route: UserOpRoute, session: StoredSession | null = SESSION): SleeveDataLayer {
  const noCeremony = () => Promise.reject(new Error('this test makes no passkey'));
  return createChainDataLayer({
    config: { readRpcUrl: 'http://127.0.0.1:9', readRpcIsPublic: false, zeroDevRpcUrl: null, passkeyRpId: 'localhost', supabase: null },
    client,
    route,
    sessions: memorySessionStore(session),
    credentials: localCredentialStore(),
    webauthn: { register: noCeremony, discover: noCeremony, sign: async () => PASSKEY_SIGNATURE },
    index: null,
    logsFromBlock: HEAD - 10n,
  });
}

export async function failure(promise: Promise<unknown>): Promise<DataLayerError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DataLayerError) return error;
    throw error;
  }
  throw new Error('expected the call to reject with a DataLayerError');
}
