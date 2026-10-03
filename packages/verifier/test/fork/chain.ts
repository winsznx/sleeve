import {
  ADDRESSES,
  DEPLOYMENT_4663,
  aggregatorV3Abi,
  erc20Abi,
  quoterV2Abi,
  sleeveModuleAbi,
  tickerBySymbol,
  uniswapV3PoolAbi,
  type Address,
  type Hex,
} from '@sleeve/core';
import {
  concat,
  createTestClient,
  keccak256,
  decodeEventLog,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  http,
  numberToHex,
  pad,
  parseAbi,
  parseAbiParameters,
  publicActions,
  walletActions,
  type TransactionReceipt,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { robinhood } from 'viem/chains';

import { RECEIPT_WRITTEN_TOPIC, decodeReceiptLog } from '../../src/receipt';
import { ARB_SYS_RUNTIME, MOCK_AGGREGATOR_RUNTIME, mockAggregatorAbi } from './mock-aggregator';

/**
 * The fork test's chain actions: a Kernel v3.1 account made through the deployed factory with an ECDSA root and the
 * module installed in its first UserOp through EntryPoint v0.7 handleOps (D-019), bracketed owner ops, USDG from a
 * pool that holds it, keeper splits and settles, quotes from QuoterV2, and feed rounds placed with a mock where the
 * fork's frozen feeds cannot reach. The calldata follows contracts/test/utils/KernelHelpers.sol and OwnerOps.sol.
 */

/** Kernel v3.1 on chain 4663, as contracts/test/spike/KernelV31.sol pins it. */
export const KERNEL = {
  FACTORY: '0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419',
  META_FACTORY: '0xd703aaE79538628d27099B8c4f621bE4CCd142d5',
  ECDSA_VALIDATOR: '0x845ADb2C711129d4f3966735eD98a9F09fC4cE57',
} as const satisfies Record<string, Address>;

const kernelAbi = parseAbi([
  'function initialize(bytes21 rootValidator, address hook, bytes validatorData, bytes hookData, bytes[] initConfig)',
  'function installModule(uint256 moduleType, address module, bytes initData) payable',
  'function execute(bytes32 execMode, bytes executionCalldata) payable',
  'function isModuleInstalled(uint256 moduleType, address module, bytes additionalContext) view returns (bool)',
]);
const kernelFactoryAbi = parseAbi(['function getAddress(bytes data, bytes32 salt) view returns (address)']);
const metaFactoryAbi = parseAbi(['function deployWithFactory(address factory, bytes createData, bytes32 salt) payable returns (address)']);
const entryPointAbi = parseAbi([
  'struct PackedUserOperation { address sender; uint256 nonce; bytes initCode; bytes callData; bytes32 accountGasLimits; uint256 preVerificationGas; bytes32 gasFees; bytes paymasterAndData; bytes signature; }',
  'function getNonce(address sender, uint192 key) view returns (uint256)',
  'function getUserOpHash(PackedUserOperation userOp) view returns (bytes32)',
  'function handleOps(PackedUserOperation[] ops, address beneficiary)',
  'event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)',
  'event UserOperationRevertReason(bytes32 indexed userOpHash, address indexed sender, uint256 nonce, bytes revertReason)',
]);

const USER_OPERATION_EVENT = encodeEventTopics({ abi: entryPointAbi, eventName: 'UserOperationEvent' })[0];
const USER_OPERATION_REVERT_REASON = encodeEventTopics({ abi: entryPointAbi, eventName: 'UserOperationRevertReason' })[0];

const MODULE = DEPLOYMENT_4663.contracts.SleeveModule.address;
const EXECUTOR = 2n;
/** ERC-7579 batch call with the default exec type. */
const BATCH_MODE: Hex = `0x01${'0'.repeat(62)}`;

function launchTicker(symbol: string): { tickerId: number; token: Address; feed: Address; pool: Address } {
  const ticker = tickerBySymbol(symbol);
  const pool = ticker?.pools[0];
  if (ticker === undefined || pool === undefined) throw new Error(`${symbol} is not a launch ticker`);
  return { tickerId: ticker.id, token: ticker.token, feed: ticker.feed, pool: pool.address };
}

export const SPY = launchTicker('SPY');

/** A pool holding plenty of USDG pays the test's income: NVDA's fee-500 pool (D-010). */
const USDG_SOURCE: Address = launchTicker('NVDA').pool;

export type ForkClient = ReturnType<typeof forkClient>;

export function forkClient(url: string) {
  return createTestClient({ chain: robinhood, mode: 'anvil', transport: http(url, { timeout: 120_000 }) })
    .extend(publicActions)
    .extend(walletActions);
}

export interface Actors {
  bundler: Address;
  keeper: Address;
  feeder: Address;
  owner: PrivateKeyAccount;
}

export async function actors(client: ForkClient): Promise<Actors> {
  const [bundler, keeper, feeder] = await client.getAddresses();
  if (bundler === undefined || keeper === undefined || feeder === undefined) throw new Error('anvil gave fewer than three accounts');
  return { bundler, keeper, feeder, owner: privateKeyToAccount(generatePrivateKey()) };
}

async function mined(client: ForkClient, hash: Hex): Promise<TransactionReceipt> {
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`transaction ${hash} reverted`);
  return receipt;
}

/** Forge's EVM and anvil do not run ArbSys, which every receipt reads; this stand-in returns block.number. */
export async function installArbSys(client: ForkClient): Promise<void> {
  await client.setCode({ address: ADDRESSES.ARB_SYS, bytecode: ARB_SYS_RUNTIME });
}

function rootValidator(): Hex {
  return concat(['0x01', KERNEL.ECDSA_VALIDATOR]);
}

function initData(owner: Address): Hex {
  return encodeFunctionData({ abi: kernelAbi, functionName: 'initialize', args: [rootValidator(), '0x0000000000000000000000000000000000000000', owner, '0x', []] });
}

/** The SDK's root nonce key: mode 0, type root, the validator, parallel key 0 (KernelHelpers._rootNonceKey). */
function rootNonceKey(): bigint {
  return BigInt(KERNEL.ECDSA_VALIDATOR) << 16n;
}

export interface Rule {
  spendBps: number;
  equityBps: number;
  tickerId: number;
  premiumCapBps: number;
  slippageBps: number;
  minClip: bigint;
}

/** onInstall data: abi.encode(keeper, RuleInput), 224 bytes (SPEC 6). */
function installData(keeper: Address, rule: Rule): Hex {
  return encodeAbiParameters(parseAbiParameters('address, (uint16, uint16, uint8, uint16, uint16, uint128)'), [
    keeper,
    [rule.spendBps, rule.equityBps, rule.tickerId, rule.premiumCapBps, rule.slippageBps, rule.minClip],
  ]);
}

/** Kernel v3.1 executor initData: no hook, then abi.encode(moduleData, hookData). */
function executorInitData(moduleData: Hex): Hex {
  return concat(['0x0000000000000000000000000000000000000000', encodeAbiParameters(parseAbiParameters('bytes, bytes'), [moduleData, '0x'])]);
}

interface UserOp {
  sender: Address;
  nonce: bigint;
  initCode: Hex;
  callData: Hex;
  accountGasLimits: Hex;
  preVerificationGas: bigint;
  gasFees: Hex;
  paymasterAndData: Hex;
  signature: Hex;
}

function packed(high: bigint, low: bigint): Hex {
  return concat([pad(numberToHex(high), { size: 16 }), pad(numberToHex(low), { size: 16 })]);
}

async function sendOp(client: ForkClient, actors: Actors, sender: Address, initCode: Hex, callData: Hex, callGas = 2_000_000n): Promise<TransactionReceipt> {
  const block = await client.getBlock();
  const baseFee = block.baseFeePerGas ?? 0n;
  const op: UserOp = {
    sender,
    nonce: await client.readContract({ address: ADDRESSES.ENTRY_POINT_V07, abi: entryPointAbi, functionName: 'getNonce', args: [sender, rootNonceKey()] }),
    initCode,
    callData,
    accountGasLimits: packed(1_000_000n, callGas),
    preVerificationGas: 100_000n,
    gasFees: packed(0n, baseFee * 2n + 1n),
    paymasterAndData: '0x',
    signature: '0x',
  };
  const hash = await client.readContract({ address: ADDRESSES.ENTRY_POINT_V07, abi: entryPointAbi, functionName: 'getUserOpHash', args: [op] });
  op.signature = await actors.owner.signMessage({ message: { raw: hash } });
  const tx = await client.sendTransaction({
    account: actors.bundler,
    chain: robinhood,
    to: ADDRESSES.ENTRY_POINT_V07,
    data: encodeFunctionData({ abi: entryPointAbi, functionName: 'handleOps', args: [[op], actors.bundler] }),
    gas: 8_000_000n,
  });
  const receipt = await mined(client, tx);
  const outcomes = new Set([USER_OPERATION_EVENT, USER_OPERATION_REVERT_REASON]);
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== ADDRESSES.ENTRY_POINT_V07.toLowerCase()) continue;
    const [signature, ...rest] = log.topics;
    if (signature === undefined || !outcomes.has(signature)) continue;
    const event = decodeEventLog({ abi: entryPointAbi, topics: [signature, ...rest], data: log.data });
    if (event.eventName === 'UserOperationRevertReason') throw new Error(`UserOp reverted: ${event.args.revertReason}`);
    if (event.eventName === 'UserOperationEvent' && !event.args.success) throw new Error('UserOp failed');
  }
  return receipt;
}

/** Deploys a Kernel v3.1 account and installs the module with a keeper and a rule in its first UserOp (D-019). */
export async function createAccount(client: ForkClient, actors: Actors, rule: Rule): Promise<Address> {
  const salt = pad(numberToHex(Date.now()), { size: 32 });
  const data = initData(actors.owner.address);
  const account = await client.readContract({ address: KERNEL.FACTORY, abi: kernelFactoryAbi, functionName: 'getAddress', args: [data, salt] });
  await client.setBalance({ address: account, value: 10n ** 18n });
  const initCode = concat([KERNEL.META_FACTORY, encodeFunctionData({ abi: metaFactoryAbi, functionName: 'deployWithFactory', args: [KERNEL.FACTORY, data, salt] })]);
  const install = encodeFunctionData({ abi: kernelAbi, functionName: 'installModule', args: [EXECUTOR, MODULE, executorInitData(installData(actors.keeper, rule))] });
  await sendOp(client, actors, account, initCode, install);
  const listed = await client.readContract({ address: account, abi: kernelAbi, functionName: 'isModuleInstalled', args: [EXECUTOR, MODULE, '0x'] });
  const initialized = await client.readContract({ address: MODULE, abi: sleeveModuleAbi, functionName: 'isInitialized', args: [account] });
  if (!listed || !initialized) throw new Error('the module did not install');
  return account;
}

/** One owner UserOp: beginOwnerOp, the calls, endOwnerOp (PRD I14). */
export async function ownerOp(client: ForkClient, actors: Actors, account: Address, calls: readonly { target: Address; data: Hex }[]): Promise<TransactionReceipt> {
  const bracketed = [
    { target: MODULE, value: 0n, callData: encodeFunctionData({ abi: sleeveModuleAbi, functionName: 'beginOwnerOp' }) },
    ...calls.map((call) => ({ target: call.target, value: 0n, callData: call.data })),
    { target: MODULE, value: 0n, callData: encodeFunctionData({ abi: sleeveModuleAbi, functionName: 'endOwnerOp' }) },
  ];
  const batch = encodeAbiParameters(parseAbiParameters('(address target, uint256 value, bytes callData)[]'), [bracketed]);
  return sendOp(client, actors, account, '0x', encodeFunctionData({ abi: kernelAbi, functionName: 'execute', args: [BATCH_MODE, batch] }));
}

/** A USDG payment into the account from a pool that holds USDG. */
export async function pay(client: ForkClient, account: Address, amount: bigint): Promise<void> {
  await client.impersonateAccount({ address: USDG_SOURCE });
  await client.setBalance({ address: USDG_SOURCE, value: 10n ** 18n });
  const hash = await client.sendTransaction({
    account: USDG_SOURCE,
    chain: robinhood,
    to: ADDRESSES.USDG,
    data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [account, amount] }),
  });
  await mined(client, hash);
  await client.stopImpersonatingAccount({ address: USDG_SOURCE });
}

async function poolFee(client: ForkClient, pool: Address): Promise<number> {
  return client.readContract({ address: pool, abi: uniswapV3PoolAbi, functionName: 'fee' });
}

/** QuoterV2's buy quote as the keeper passes it: Stock Token base units per 1e6 USDG base units. */
export async function buyQuote(client: ForkClient, amountIn: bigint): Promise<{ quote: bigint; tokensOut: bigint }> {
  const { result } = await client.simulateContract({
    address: ADDRESSES.QUOTER_V2,
    abi: quoterV2Abi,
    functionName: 'quoteExactInputSingle',
    args: [{ tokenIn: ADDRESSES.USDG, tokenOut: SPY.token, amountIn, fee: await poolFee(client, SPY.pool), sqrtPriceLimitX96: 0n }],
  });
  const [tokensOut] = result;
  return { quote: (tokensOut * 1_000_000n) / amountIn, tokensOut };
}

/** QuoterV2's sell quote: USDG base units per 1e18 Stock Token base units. */
export async function sellQuote(client: ForkClient, tokensIn: bigint): Promise<bigint> {
  const { result } = await client.simulateContract({
    address: ADDRESSES.QUOTER_V2,
    abi: quoterV2Abi,
    functionName: 'quoteExactInputSingle',
    args: [{ tokenIn: SPY.token, tokenOut: ADDRESSES.USDG, amountIn: tokensIn, fee: await poolFee(client, SPY.pool), sqrtPriceLimitX96: 0n }],
  });
  const [usdgOut] = result;
  return (usdgOut * 10n ** 18n) / tokensIn;
}

/** The receipt id a call returned, from its ReceiptWritten logs. */
export function receiptIds(receipt: TransactionReceipt): bigint[] {
  const ids: bigint[] = [];
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== MODULE.toLowerCase() || log.topics[0] !== RECEIPT_WRITTEN_TOPIC) continue;
    const decoded = decodeReceiptLog(log);
    if (!decoded.ok) throw new Error(`a ReceiptWritten log did not decode: ${decoded.error}`);
    ids.push(decoded.value.receipt.id);
  }
  return ids;
}

export async function keeperCall(client: ForkClient, keeper: Address, data: Hex): Promise<TransactionReceipt> {
  const hash = await client.sendTransaction({ account: keeper, chain: robinhood, to: MODULE, data, gas: 3_000_000n });
  return mined(client, hash);
}

export function splitCall(account: Address, quote: bigint): Hex {
  return encodeFunctionData({ abi: sleeveModuleAbi, functionName: 'split', args: [account, SPY.pool, quote] });
}

export function settleCall(account: Address, quote: bigint): Hex {
  return encodeFunctionData({ abi: sleeveModuleAbi, functionName: 'settle', args: [account, SPY.tickerId, SPY.pool, quote] });
}

/** The real feed's latest round id, read before the mock replaces its code. */
export async function latestRoundId(client: ForkClient, feed: Address): Promise<bigint> {
  const [roundId] = await client.readContract({ address: feed, abi: aggregatorV3Abi, functionName: 'latestRoundData' });
  return roundId;
}

export async function mockFeed(client: ForkClient, feed: Address): Promise<void> {
  await client.setCode({ address: feed, bytecode: MOCK_AGGREGATOR_RUNTIME });
}

export async function setRound(
  client: ForkClient,
  sender: Address,
  feed: Address,
  round: { roundId: bigint; answer: bigint; startedAt: bigint; updatedAt: bigint },
  latest = true,
): Promise<void> {
  const hash = await client.sendTransaction({
    account: sender,
    chain: robinhood,
    to: feed,
    data: encodeFunctionData({
      abi: mockAggregatorAbi,
      functionName: latest ? 'setRound' : 'editRound',
      args: [round.roundId, round.answer, round.startedAt, round.updatedAt],
    }),
  });
  await mined(client, hash);
}

/** Moves the chain's clock to `timestamp` and mines a block there. */
export async function warpTo(client: ForkClient, timestamp: bigint): Promise<void> {
  await client.setNextBlockTimestamp({ timestamp });
  await client.mine({ blocks: 1 });
}

/** The storage slot of receiptHash[id]: _store at slot 0, its receipts.hashes mapping at slot 4 (forge inspect). */
export function receiptHashSlot(id: bigint): Hex {
  return keccakSlot(id, 4n);
}

function keccakSlot(key: bigint, slot: bigint): Hex {
  return keccak256(encodeAbiParameters(parseAbiParameters('uint256, uint256'), [key, slot]));
}
