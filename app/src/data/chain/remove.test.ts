// @vitest-environment node
import {
  ADDRESSES,
  DISCLOSURE,
  RULE_DEFAULTS,
  RULE_STATUSES,
  STATUSES,
  erc20Abi,
  sleeveModuleAbi,
  tickerById,
  type Receipt,
  type Rule,
  type TickerId,
} from '@sleeve/core';
import {
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionResult,
  formatLog,
  getAddress,
  isAddressEqual,
  multicall3Abi,
  numberToHex,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
  type RpcLog,
} from 'viem';
import type { UserOperation } from 'viem/account-abstraction';
import { describe, expect, it } from 'vitest';

import { sleeveChain } from '@/lib/chain/chain';
import { ECDSA_VALIDATOR, WEBAUTHN_VALIDATOR, ecdsaValidatorAbi, kernelAbi, uninstallSleeveModuleCall } from '@/lib/chain/kernel';
import {
  NotBracketedError,
  SLEEVE_MODULE,
  UNINSTALL_CALL_GAS_LIMIT,
  assertBracketed,
  buildUnbracketedOp,
} from '@/lib/chain/owner-ops';
import { encodePublicKey } from '@/lib/chain/webauthn';

import { DataLayerError } from '../errors';
import type { MarketSnapshot, SleeveDataLayer } from '../types';
import { kernelAccountFor } from './accounts';
import { CONTRACTS } from './context';
import { createChainDataLayer } from './data-layer';
import { encodeReceipt } from './decode';
import { runUnbracketedOp } from './owner-op';
import { previewOnChain, previewUnbracketed } from './preview';
import { localCredentialStore, memorySessionStore, type StoredSession } from './session';
import type { PreparedOp, PrepareRequest, UserOpRoute } from './user-ops';

/**
 * Remove Sleeve, the send of an account without the module and the reinstall, run through the chain data layer itself
 * (D-040): a fake RPC answers the reads the layer makes, a recording route stands in for the bundler, and each op
 * "lands" by changing the fake chain's state and returning the transaction's logs. Every assertion reads what the layer
 * read back, the way the chain would answer it.
 */

const ACCOUNT = getAddress('0x5ee1e00000000000000000000000000000c0ffee');
const PAYEE = getAddress('0x15373ca332fbb73a8559de6e2bb32974dc68d613');
const KEEPER = getAddress('0x8649275ca7ce63d2f9e6487570ec0dce14b6bf46');
const MULTICALL3 = getAddress('0xca11bde05977b3631167028862be2a173976ca11');
const HEAD = 80_000_100n;
const OP_BLOCK = 80_000_050n;
const BLOCK_TIME = 1_790_445_600n;
const TX_HASH: Hex = `0x${'cd'.repeat(32)}`;
const BLOCK_HASH: Hex = `0x${'ab'.repeat(32)}`;
const USER_OP_HASH: Hex = `0x${'ef'.repeat(32)}`;
const STORED_HASH: Hex = `0x${'aa'.repeat(32)}`;

const SESSION: StoredSession = {
  account: ACCOUNT,
  signer: { kind: 'passkey', credentialId: 'c2xlZXZlLXRlc3Q', rpId: 'localhost', publicKey: encodePublicKey({ x: 1n, y: 2n }) },
  signedInAt: BLOCK_TIME.toString(),
};

const NO_RULE: Rule = { version: 0, status: 'NONE', equityBps: 0, tickerId: 0, premiumCapBps: 0, slippageBps: 0, minClip: 0n };

/** The suggested rule as the module reads it back at a version: 10 percent to SPY. */
function suggestedRule(version: number): Rule {
  const { equityBps, tickerId, premiumCapBps, slippageBps, minClip } = RULE_DEFAULTS;
  return { version, status: 'ACTIVE', equityBps, tickerId, premiumCapBps, slippageBps, minClip };
}

const ACTIVE_RULE = suggestedRule(2);

interface ChainState {
  deployed: boolean;
  initialized: boolean;
  listed: boolean;
  rule: Rule;
  /** USDG before the op's block, and from that block on. */
  balanceBefore: bigint;
  balanceAfter: bigint;
}

function installed(): ChainState {
  return { deployed: true, initialized: true, listed: true, rule: ACTIVE_RULE, balanceBefore: 500_000_000n, balanceAfter: 500_000_000n };
}

function removed(): ChainState {
  return { deployed: true, initialized: false, listed: false, rule: NO_RULE, balanceBefore: 500_000_000n, balanceAfter: 500_000_000n };
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
  if (isAddressEqual(to, ACCOUNT)) return kernelAnswer(state, data);
  if (isAddressEqual(to, ECDSA_VALIDATOR)) {
    return encodeFunctionResult({ abi: ecdsaValidatorAbi, functionName: 'ecdsaValidatorStorage', result: zeroAddress });
  }
  if (isAddressEqual(to, CONTRACTS.usdg)) {
    return encodeFunctionResult({ abi: erc20Abi, functionName: 'balanceOf', result: balanceAt(state, block) });
  }
  throw new Error(`the fake chain has no contract at ${to}`);
}

interface Simulation {
  success: boolean;
  logs: RpcLog[];
}

/** A viem client on a fake RPC: the reads the chain layer makes, and eth_simulateV1 answering `simulation`. */
function fakeClient(state: ChainState, simulation: Simulation = { success: true, logs: [] }): PublicClient {
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
          case 'eth_getCode':
            return state.deployed ? '0xef0100' : '0x';
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
            return answer(state, call.to, call.data, block);
          }
          default:
            throw new Error(`the fake chain does not answer ${method}`);
        }
      },
    }),
  });
}

function rpcLog(address: Address, topics: RpcLog['topics'], data: Hex, logIndex: number): RpcLog {
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

function releasedReceipt(id: bigint, tickerId: TickerId, amount: bigint): Receipt {
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

function releasedLog(receipt: Receipt, logIndex: number): RpcLog {
  const topics = encodeEventTopics({
    abi: sleeveModuleAbi,
    eventName: 'ReceiptWritten',
    args: { id: receipt.id, account: receipt.account, status: STATUSES.indexOf(receipt.status) },
  });
  return rpcLog(CONTRACTS.module, topics as RpcLog['topics'], encodeReceipt(receipt), logIndex);
}

function uninstallResultLog(result: boolean, logIndex: number): RpcLog {
  const topics = encodeEventTopics({ abi: kernelAbi, eventName: 'ModuleUninstallResult' });
  return rpcLog(ACCOUNT, topics as RpcLog['topics'], encodeAbiParameters([{ type: 'address' }, { type: 'bool' }], [CONTRACTS.module, result]), logIndex);
}

function ownerOpEndedLog(ownerDelta: bigint, fromSpend: bigint, logIndex: number): RpcLog {
  const topics = encodeEventTopics({ abi: sleeveModuleAbi, eventName: 'OwnerOpEnded', args: { account: ACCOUNT } });
  const data = encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'int256' }, { type: 'int256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256[]' }],
    [500_000_000n, 0n, ownerDelta, fromSpend, 0n, [0n, 0n, 0n, 0n]],
  );
  return rpcLog(CONTRACTS.module, topics as RpcLog['topics'], data, logIndex);
}

function usdgTransferLog(from: Address, to: Address, amount: bigint, logIndex: number): RpcLog {
  const topics = encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer', args: { from, to } });
  return rpcLog(ADDRESSES.USDG, topics as RpcLog['topics'], encodeAbiParameters([{ type: 'uint256' }], [amount]), logIndex);
}

interface RecordingRoute extends UserOpRoute {
  readonly prepared: PrepareRequest[];
}

/**
 * The bundler's part: records what it was asked to prepare, prepares it sponsored with the request's call gas limit as
 * a route that keeps it does, and on send lands the op: `land` changes the chain and `logs` are the transaction's.
 */
function landingRoute(state: ChainState, land: (state: ChainState) => void, logs: RpcLog[]): RecordingRoute {
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

const PASSKEY_SIGNATURE: Hex = `0x${'5a'.repeat(96)}`;

function chainLayer(client: PublicClient, route: UserOpRoute): SleeveDataLayer {
  const noCeremony = () => Promise.reject(new Error('this test makes no passkey'));
  return createChainDataLayer({
    config: { readRpcUrl: 'http://127.0.0.1:9', readRpcIsPublic: false, zeroDevRpcUrl: null, passkeyRpId: 'localhost', supabase: null },
    client,
    route,
    sessions: memorySessionStore(SESSION),
    credentials: localCredentialStore(),
    webauthn: { register: noCeremony, discover: noCeremony, sign: async () => PASSKEY_SIGNATURE },
    index: null,
    logsFromBlock: HEAD - 10n,
  });
}

async function failure(promise: Promise<unknown>): Promise<DataLayerError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DataLayerError) return error;
    throw error;
  }
  throw new Error('expected the call to reject with a DataLayerError');
}

function sendOut(amount: bigint): (state: ChainState) => void {
  return (state) => {
    state.balanceAfter = state.balanceBefore - amount;
  };
}

function takeModuleOff(state: ChainState): void {
  state.initialized = false;
  state.listed = false;
  state.rule = NO_RULE;
}

describe('removeSleeve on chain', () => {
  it('uninstalls in one bracketed op with the fixed call gas, and resolves with each RELEASED receipt once the module reads back off', async () => {
    // #given an installed account with 75 USDG waiting to buy SPY, and an uninstall that releases it
    const state = installed();
    const released = releasedReceipt(700n, 0, 75_000_000n);
    const route = landingRoute(state, takeModuleOff, [releasedLog(released, 2), uninstallResultLog(true, 3)]);
    const client = fakeClient(state);
    const layer = chainLayer(client, route);

    // #when the owner removes Sleeve
    const result = await layer.removeSleeve();

    // #then the op was the bracketed uninstall with the fixed call gas limit
    const [request] = route.prepared;
    expect(request?.callGasLimit).toBe(UNINSTALL_CALL_GAS_LIMIT);
    const calls = assertBracketed(request?.callData ?? '0x');
    expect(calls.slice(1, -1).map((call) => call.data)).toEqual([uninstallSleeveModuleCall(ACCOUNT, SLEEVE_MODULE).data]);
    // #then the result is read from the transaction and the account after it
    expect(result.txHash).toBe(TX_HASH);
    expect(result.at).toEqual({ l2Block: OP_BLOCK, timestamp: BLOCK_TIME });
    expect(result.released.map(({ receipt }) => [receipt.id, receipt.status, receipt.tickerId, receipt.usdgToSpend])).toEqual([
      [700n, 'RELEASED', 0, 75_000_000n],
    ]);
    expect(result.released[0]?.receiptHash).toBe(STORED_HASH);
    expect((await layer.getAccount(ACCOUNT)).moduleInstalled).toBe(false);
  });

  it('refuses with UninstallFailed when Kernel reports that the module did not release', async () => {
    // #given an uninstall whose onUninstall reverted: Kernel took the module off the list and went on
    const state = installed();
    const route = landingRoute(
      state,
      (chain) => {
        chain.listed = false;
      },
      [uninstallResultLog(false, 3)],
    );
    const layer = chainLayer(fakeClient(state), route);
    // #when / #then the removal is refused by name, with the result Kernel gave
    expect((await failure(layer.removeSleeve())).detail).toEqual({ code: 'UninstallFailed', result: false });
  });

  it('refuses with UninstallFailed when the transaction carries no result for the module', async () => {
    const state = installed();
    const route = landingRoute(state, takeModuleOff, []);
    const layer = chainLayer(fakeClient(state), route);
    expect((await failure(layer.removeSleeve())).detail).toEqual({ code: 'UninstallFailed', result: null });
  });

  it('refuses when the account still reads back with the module, whatever the logs say', async () => {
    const state = installed();
    const route = landingRoute(state, () => undefined, [uninstallResultLog(true, 3)]);
    const layer = chainLayer(fakeClient(state), route);
    expect((await failure(layer.removeSleeve())).code).toBe('SourceUnavailable');
  });
});

describe('a send from an account without the module', () => {
  it('sends one plain transfer without brackets and measures it by the balance before and after', async () => {
    // #given an account Sleeve was removed from, holding 500 USDG
    const state = removed();
    const route = landingRoute(state, sendOut(120_000_000n), [usdgTransferLog(ACCOUNT, PAYEE, 120_000_000n, 1)]);
    const layer = chainLayer(fakeClient(state), route);

    // #when the owner sends 120 USDG
    const result = await layer.withdraw({ to: PAYEE, amount: 120_000_000n });

    // #then the op was the bare transfer, which the bracket check refuses, and the amount is the balance delta
    const callData = route.prepared[0]?.callData ?? '0x';
    expect(callData).toBe(buildUnbracketedOp(ACCOUNT, { kind: 'send', to: PAYEE, amount: 120_000_000n }).callData);
    expect(() => assertBracketed(callData)).toThrow(NotBracketedError);
    expect([result.balanceBefore, result.balanceAfter, result.from]).toEqual([500_000_000n, 380_000_000n, null]);
  });

  it('refuses the unbracketed path for an account the module is installed on, before anything is prepared', async () => {
    // #given an installed account and its Kernel account
    const state = installed();
    const client = fakeClient(state);
    const route = landingRoute(state, () => undefined, []);
    const kernel = await kernelAccountFor(
      client,
      { kind: 'passkey', credentialId: 'c2xlZXZlLXRlc3Q', publicKey: { x: 1n, y: 2n }, sign: async () => PASSKEY_SIGNATURE },
      ACCOUNT,
    );
    // #when an op without brackets is asked for
    const error = await failure(runUnbracketedOp(client, route, kernel, { kind: 'send', to: PAYEE, amount: 1n }));
    // #then it is refused by name and nothing reached the bundler
    expect(error.code).toBe('ModuleInstalled');
    expect(route.prepared).toEqual([]);
  });

  it('keeps a send from an installed account in the bracketed owner op', async () => {
    const state = installed();
    const route = landingRoute(state, sendOut(120_000_000n), [ownerOpEndedLog(-120_000_000n, 120_000_000n, 4)]);
    const layer = chainLayer(fakeClient(state), route);
    const result = await layer.withdraw({ to: PAYEE, amount: 120_000_000n });
    expect(() => assertBracketed(route.prepared[0]?.callData ?? '0x')).not.toThrow();
    expect(result.from).toEqual({ spend: 120_000_000n, unsorted: 0n, buckets: [] });
  });
});

describe('turning Sleeve back on', () => {
  it('sends the install op without brackets and resolves with the rule once the module reads back installed', async () => {
    // #given an account Sleeve was removed from, whose last rule was version 2
    const state = removed();
    const installedRule = suggestedRule(3);
    const route = landingRoute(
      state,
      (chain) => {
        chain.initialized = true;
        chain.listed = true;
        chain.rule = installedRule;
      },
      [],
    );
    const layer = chainLayer(fakeClient(state), route);

    // #when the owner turns it back on with the suggested rule
    const rule = await layer.reinstallSleeve({ ...RULE_DEFAULTS });

    // #then the op was onboarding's install op, sent as built, and the rule read back is the one asked for
    expect(route.prepared).toEqual([{ callData: buildUnbracketedOp(ACCOUNT, { kind: 'install', rule: { ...RULE_DEFAULTS } }).callData, callGasLimit: null }]);
    expect(rule).toEqual(installedRule);
    expect((await layer.getAccount(ACCOUNT)).moduleInstalled).toBe(true);
  });

  it('refuses an account the module is installed on', async () => {
    const state = installed();
    const route = landingRoute(state, () => undefined, []);
    const layer = chainLayer(fakeClient(state), route);
    expect((await failure(layer.reinstallSleeve({ ...RULE_DEFAULTS }))).code).toBe('ModuleInstalled');
    expect(route.prepared).toEqual([]);
  });
});

describe('previews on chain', () => {
  const MARKET: MarketSnapshot = {
    asOf: { l2Block: HEAD, timestamp: BLOCK_TIME },
    tickers: [],
    usdgUsd: { feed: ADDRESSES.USDG_USD_FEED, roundId: 1n, answer: 100_000_000n, updatedAt: BLOCK_TIME },
  };

  function preparing(requests: PrepareRequest[]) {
    return async (callData: Hex, callGasLimit: bigint | null): Promise<PreparedOp> => {
      requests.push({ callData, callGasLimit });
      const userOp: UserOperation<'0.7'> = {
        sender: ACCOUNT,
        nonce: 0n,
        callData,
        callGasLimit: callGasLimit ?? 300_000n,
        verificationGasLimit: 700_000n,
        preVerificationGas: 60_000n,
        maxFeePerGas: 2n,
        maxPriorityFeePerGas: 0n,
        signature: '0x',
      };
      return { userOp, sponsored: true, gas: 1_000_000n, maxCostWei: 2_000_000n };
    };
  }

  function simulating(success: boolean, logs: RpcLog[]) {
    return async () => ({ success, revertData: null, gasUsed: 200_000n, logs: logs.map((log) => formatLog(log)) });
  }

  it('previews a removal from its simulation: each waiting bucket to spend, prepared with the fixed call gas', async () => {
    const requests: PrepareRequest[] = [];
    const preview = await previewOnChain({
      action: { kind: 'remove' },
      account: ACCOUNT,
      asOf: MARKET.asOf,
      market: MARKET,
      rule: ACTIVE_RULE,
      unsorted: 0n,
      steps: [{ kind: 'uninstall' }],
      sellPlan: null,
      prepare: preparing(requests),
      gasPrice: async () => 1n,
      simulate: simulating(true, [releasedLog(releasedReceipt(700n, 0, 75_000_000n), 2), uninstallResultLog(true, 3)]),
      client: fakeClient(installed()),
    });
    expect(preview.legs).toEqual([
      { from: { kind: 'waiting', tickerId: 0 }, to: { kind: 'spend' }, sends: { asset: { kind: 'USDG' }, amount: 75_000_000n }, receives: null },
    ]);
    expect(preview.warnings).toEqual([{ code: 'REMOVE_STOPS_SPLITS' }, { code: 'RELEASE_ENDS_WAIT', tickerId: 0 }]);
    expect(preview.blocked).toBeNull();
    expect(requests.map((request) => request.callGasLimit)).toEqual([UNINSTALL_CALL_GAS_LIMIT]);
  });

  it('blocks a removal whose simulated uninstall would not release, and prepares nothing', async () => {
    const requests: PrepareRequest[] = [];
    const preview = await previewOnChain({
      action: { kind: 'remove' },
      account: ACCOUNT,
      asOf: MARKET.asOf,
      market: MARKET,
      rule: ACTIVE_RULE,
      unsorted: 0n,
      steps: [{ kind: 'uninstall' }],
      sellPlan: null,
      prepare: preparing(requests),
      gasPrice: async () => 1n,
      simulate: simulating(true, [uninstallResultLog(false, 3)]),
      client: fakeClient(installed()),
    });
    expect(preview.blocked).toEqual({ code: 'UninstallFailed', result: false });
    expect(requests).toEqual([]);
  });

  it('previews a send without the module from the USDG transfer its simulation emits', async () => {
    const preview = await previewUnbracketed({
      action: { kind: 'withdraw', request: { to: PAYEE, amount: 120_000_000n } },
      account: ACCOUNT,
      asOf: MARKET.asOf,
      balance: 500_000_000n,
      rule: null,
      step: { kind: 'send', to: PAYEE, amount: 120_000_000n },
      prepare: preparing([]),
      gasPrice: async () => 1n,
      simulate: simulating(true, [usdgTransferLog(ACCOUNT, PAYEE, 120_000_000n, 1)]),
      client: fakeClient(removed()),
    });
    expect(preview.legs).toEqual([
      { from: { kind: 'spend' }, to: { kind: 'outside', address: PAYEE }, sends: { asset: { kind: 'USDG' }, amount: 120_000_000n }, receives: null },
    ]);
    expect([preview.warnings, preview.blocked]).toEqual([[], null]);
  });

  it('previews the reinstall as the rule it installs, with the balance staying spendable', async () => {
    const after = suggestedRule(3);
    const preview = await previewUnbracketed({
      action: { kind: 'reinstall', rule: { ...RULE_DEFAULTS } },
      account: ACCOUNT,
      asOf: MARKET.asOf,
      balance: 500_000_000n,
      rule: { before: NO_RULE, after },
      step: { kind: 'install', rule: { ...RULE_DEFAULTS } },
      prepare: preparing([]),
      gasPrice: async () => 1n,
      simulate: simulating(true, []),
      client: fakeClient(removed()),
    });
    expect([preview.legs, preview.rule, preview.blocked]).toEqual([[], { before: NO_RULE, after }, null]);
    expect(preview.warnings).toEqual([{ code: 'SNAPSHOT_KEEPS_BALANCE', amount: 500_000_000n }]);
  });
});
