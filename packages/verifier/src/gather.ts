import {
  ADDRESSES,
  CHAIN_ID,
  DEPLOYMENT_4663,
  RULE_STATUSES,
  SESSION_REASONS,
  SESSION_TYPES,
  STATUSES,
  aggregatorV3Abi,
  enumMember,
  erc20Abi,
  sessionCalendarExtensionAbi,
  sleeveModuleAbi,
  stockTokenAbi,
  tokenSourceAbi,
  uniswapV3PoolAbi,
  type Address,
  type Hex,
} from '@sleeve/core';
import { decodeEventLog, decodeFunctionResult, encodeEventTopics, encodeFunctionData, getAddress, numberToHex, pad } from 'viem';

import { accessRegistryPauseAbi, stockTokenEventsAbi, stockTokenPauseAbi } from './abi';
import { ChainMismatchError, ReadFailedError, ReceiptLogMissingError } from './errors';
import type {
  AccountLogs,
  Evidence,
  FlagChange,
  LogPosition,
  LotReading,
  MultiplierHistory,
  MultiplierUpdate,
  RawLog,
  Reading,
  RoundData,
  RuleRecord,
  TickerReading,
  TokenHistory,
} from './evidence';
import { comparePositions } from './history';
import { LogScanner } from './logs';
import type { CallOutcome, ChainReader, ContractCall, LogFilter } from './reader';
import { RECEIPT_WRITTEN_TOPIC, decodeReceiptLog, receiptKind, type ReceiptKind } from './receipt';

/**
 * Reads everything one receipt's verification needs, through a ChainReader, in as few requests as the public RPC
 * allows: state reads at the latest block batched through Multicall3, and log scans in the widest chunks the
 * provider takes. Nothing reads old state (D-008): the state at the receipt is rebuilt in history.ts from the state
 * now and the events after the receipt.
 */

export interface GatherOptions {
  /**
   * A block at or before the receipt's block. The module's log scans start here instead of at the deployment block,
   * which a caller who knows roughly when the receipt was written can use to scan less.
   */
  fromBlock?: bigint;
  /** Called before each step, for a progress line. */
  onProgress?: (step: string) => void;
}

export type Gathered =
  | { found: true; evidence: Evidence }
  | { found: false; id: bigint; chainId: number; module: Address; latestBlock: bigint; latestTimestamp: bigint };

const MODULE = DEPLOYMENT_4663.contracts.SleeveModule.address;
const TOKEN_SOURCE = DEPLOYMENT_4663.contracts.TokenSource.address;
const CALENDAR = DEPLOYMENT_4663.contracts.SessionCalendarExtension.address;
const USDG = ADDRESSES.USDG;
const USDG_FEED = ADDRESSES.USDG_USD_FEED;

/** With a list in a topic, the public RPC allows 100,000 blocks a query (chain-constants.md section 8). */
const OR_LIST_SPAN = 100_000n;

const MULTIPLIER_TOPIC = encodeEventTopics({ abi: stockTokenEventsAbi, eventName: 'UIMultiplierUpdated' })[0];
const PAUSED_TOPIC = encodeEventTopics({ abi: stockTokenEventsAbi, eventName: 'Paused' })[0];
const UNPAUSED_TOPIC = encodeEventTopics({ abi: stockTokenEventsAbi, eventName: 'Unpaused' })[0];
const ORACLE_PAUSED_TOPIC = encodeEventTopics({ abi: stockTokenEventsAbi, eventName: 'OraclePaused' })[0];
const ORACLE_UNPAUSED_TOPIC = encodeEventTopics({ abi: stockTokenEventsAbi, eventName: 'OracleUnpaused' })[0];

function topicOf(value: bigint | number): Hex {
  return pad(numberToHex(value), { size: 32 });
}

function addressTopic(address: Address): Hex {
  return pad(address, { size: 32 });
}

function positionOf(log: RawLog): LogPosition {
  return { blockNumber: log.blockNumber, logIndex: log.logIndex };
}

function isAfter(log: RawLog, reference: LogPosition): boolean {
  return comparePositions(positionOf(log), reference) > 0;
}

function topicsOf(log: RawLog): [Hex, ...Hex[]] {
  const [signature, ...rest] = log.topics;
  if (signature === undefined) throw new RangeError('a log without topics');
  return [signature, ...rest];
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Decodes one call's result, turning a failed call or undecodable data into a Reading failure. */
function read<T>(outcome: CallOutcome | undefined, decode: (data: Hex) => T): Reading<T> {
  if (outcome === undefined) return { ok: false, error: 'not called' };
  if (!outcome.ok) return outcome;
  try {
    return { ok: true, value: decode(outcome.data) };
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
}

/** A read the verification cannot go on without. */
function must<T>(name: string, reading: Reading<T>): T {
  if (!reading.ok) throw new ReadFailedError(name, reading.error);
  return reading.value;
}

/** Collects calls, runs them in one batch, and hands each caller its outcome by index. */
class CallBatch {
  private readonly calls: ContractCall[] = [];

  add(to: Address, data: Hex): number {
    this.calls.push({ to, data });
    return this.calls.length - 1;
  }

  async run(reader: ChainReader, blockNumber: bigint): Promise<CallOutcome[]> {
    return this.calls.length === 0 ? [] : reader.callMany(this.calls, blockNumber);
  }
}

/** Kinds whose checks need the token, its feeds and the session: every buy, sell and guard outcome. */
const MARKET_KINDS: ReadonlySet<ReceiptKind> = new Set(['SPLIT_FILL', 'SPLIT_QUEUE', 'SPLIT_REFUSAL', 'SETTLE_FILL', 'SETTLE_REFUSAL', 'SELL']);

function needsRule(kind: ReceiptKind): boolean {
  return kind !== 'RELEASE' && kind !== 'LEDGER_RECONCILE' && kind !== 'LOT_RECONCILE';
}

function isZeroAddress(address: string): boolean {
  return /^0x0{40}$/i.test(address);
}

/** getRoundData's answer. A proxy answers a round it never had with zeros, so updatedAt zero is no round. */
function roundOf([roundId, answer, startedAt, updatedAt]: readonly [bigint, bigint, bigint, bigint, bigint]): RoundData {
  if (updatedAt === 0n) throw new RangeError('no data present for the round');
  return { roundId, answer, startedAt, updatedAt };
}

export async function gatherEvidence(id: bigint, reader: ChainReader, options: GatherOptions = {}): Promise<Gathered> {
  const progress = options.onProgress ?? (() => undefined);
  const fromBlock = options.fromBlock ?? BigInt(DEPLOYMENT_4663.firstBlock);
  const scanner = new LogScanner(reader);

  progress('chain');
  const chainId = await reader.chainId();
  if (chainId !== CHAIN_ID) throw new ChainMismatchError(CHAIN_ID, chainId);
  const latest = await reader.latestBlock();

  progress('module');
  const head = new CallBatch();
  const nextIdCall = head.add(MODULE, encodeFunctionData({ abi: sleeveModuleAbi, functionName: 'nextReceiptId' }));
  const hashCall = head.add(MODULE, encodeFunctionData({ abi: sleeveModuleAbi, functionName: 'receiptHash', args: [id] }));
  const disclosureCall = head.add(MODULE, encodeFunctionData({ abi: sleeveModuleAbi, functionName: 'disclosureHash' }));
  const paramsCall = head.add(MODULE, encodeFunctionData({ abi: sleeveModuleAbi, functionName: 'guardParams' }));
  const versionCall = head.add(CALENDAR, encodeFunctionData({ abi: sessionCalendarExtensionAbi, functionName: 'version' }));
  const writesCall = head.add(CALENDAR, encodeFunctionData({ abi: sessionCalendarExtensionAbi, functionName: 'writeCount' }));
  const usdgDecimalsCall = head.add(USDG, encodeFunctionData({ abi: erc20Abi, functionName: 'decimals' }));
  const usdgFeedDecimalsCall = head.add(USDG_FEED, encodeFunctionData({ abi: aggregatorV3Abi, functionName: 'decimals' }));
  const heads = await head.run(reader, latest.number);
  const nextId = must('nextReceiptId()', read(heads[nextIdCall], (data) => decodeFunctionResult({ abi: sleeveModuleAbi, functionName: 'nextReceiptId', data })));
  if (id === 0n || id >= nextId) {
    return { found: false, id, chainId, module: MODULE, latestBlock: latest.number, latestTimestamp: latest.timestamp };
  }
  const storedHash = must('receiptHash(id)', read(heads[hashCall], (data) => decodeFunctionResult({ abi: sleeveModuleAbi, functionName: 'receiptHash', data })));
  const disclosureHash = must('disclosureHash()', read(heads[disclosureCall], (data) => decodeFunctionResult({ abi: sleeveModuleAbi, functionName: 'disclosureHash', data })));
  const guardParams = must('guardParams()', read(heads[paramsCall], (data) => decodeFunctionResult({ abi: sleeveModuleAbi, functionName: 'guardParams', data })));
  const versionNow = must('version() on the calendar', read(heads[versionCall], (data) => decodeFunctionResult({ abi: sessionCalendarExtensionAbi, functionName: 'version', data })));
  const writeCountNow = must('writeCount() on the calendar', read(heads[writesCall], (data) => decodeFunctionResult({ abi: sessionCalendarExtensionAbi, functionName: 'writeCount', data })));

  progress('receipt log');
  const receiptLogs = await scanner.newest({ address: MODULE, topics: [RECEIPT_WRITTEN_TOPIC, topicOf(id)] }, fromBlock, latest.number);
  const [receiptLog, ...duplicateLogs] = receiptLogs;
  if (receiptLog === undefined) throw new ReceiptLogMissingError(id, fromBlock, latest.number);
  const here = positionOf(receiptLog);

  progress('transaction');
  const block = await reader.block(receiptLog.blockNumber);
  const transaction = await reader.transaction(receiptLog.transactionHash);

  const evidence: Evidence = {
    id,
    rpcUrl: reader.url,
    chainId,
    module: MODULE,
    latestBlock: latest.number,
    latestTimestamp: latest.timestamp,
    fromBlock,
    receiptLog,
    duplicateLogs,
    storedHash,
    block,
    transaction,
    disclosureHash,
    guardParams,
    calendar: { versionNow, writeCountNow, writesAfter: 0, session: null },
    decimals: {
      usdg: read(heads[usdgDecimalsCall], (data) => decodeFunctionResult({ abi: erc20Abi, functionName: 'decimals', data })),
      token: null,
      feed: null,
      usdgFeed: read(heads[usdgFeedDecimalsCall], (data) => decodeFunctionResult({ abi: aggregatorV3Abi, functionName: 'decimals', data })),
    },
    ticker: null,
    tickerRemovedAfter: null,
    tokenUid: null,
    stockRound: null,
    usdgRound: null,
    rule: null,
    lot: null,
    pool: null,
    history: null,
    account: null,
  };

  const decoded = decodeReceiptLog(receiptLog);
  if (!decoded.ok) return { found: true, evidence };
  const r = decoded.value.receipt;
  const kind = receiptKind(r);
  const market = MARKET_KINDS.has(kind);
  const priced = kind === 'SPLIT_FILL' || kind === 'SETTLE_FILL' || kind === 'SELL';
  const hasPool = !isZeroAddress(r.pool);

  progress('ticker');
  const first = new CallBatch();
  const tickerCall =
    kind === 'LEDGER_RECONCILE' ? -1 : first.add(TOKEN_SOURCE, encodeFunctionData({ abi: tokenSourceAbi, functionName: 'ticker', args: [r.tickerId] }));
  const lotCall = r.lotId === 0n ? -1 : first.add(MODULE, encodeFunctionData({ abi: sleeveModuleAbi, functionName: 'lot', args: [r.lotId] }));
  const token0Call = hasPool ? first.add(r.pool, encodeFunctionData({ abi: uniswapV3PoolAbi, functionName: 'token0' })) : -1;
  const allowedCall = hasPool
    ? first.add(TOKEN_SOURCE, encodeFunctionData({ abi: tokenSourceAbi, functionName: 'isPoolAllowed', args: [r.tickerId, r.pool] }))
    : -1;
  const firsts = await first.run(reader, latest.number);
  if (tickerCall >= 0) {
    evidence.ticker = read(firsts[tickerCall], (data): TickerReading => {
      const [token, feed, sessionType, active] = decodeFunctionResult({ abi: tokenSourceAbi, functionName: 'ticker', data });
      return { token: getAddress(token), feed: getAddress(feed), sessionType: enumMember(SESSION_TYPES, sessionType), active };
    });
  }
  if (lotCall >= 0) {
    evidence.lot = read(firsts[lotCall], (data): LotReading => {
      const lot = decodeFunctionResult({ abi: sleeveModuleAbi, functionName: 'lot', data });
      return {
        account: lot.account,
        tickerId: lot.tickerId,
        status: isZeroAddress(lot.account) ? 'NONE' : enumMember(STATUSES, lot.status),
        tokensBought: lot.tokensBought,
        tokensRemaining: lot.tokensRemaining,
      };
    });
  }

  const ticker = evidence.ticker !== null && evidence.ticker.ok ? evidence.ticker.value : null;
  if (ticker !== null && market) {
    progress('token and feeds');
    await readMarket(evidence, reader, scanner, { r, ticker, priced, here, latest, progress, timestamp: block.timestamp });
  }

  if (hasPool && market) {
    progress('pool allowlist');
    const changes = await scanner.collect(
      { address: TOKEN_SOURCE, topics: [encodeEventTopics({ abi: tokenSourceAbi, eventName: 'PoolSet' })[0], topicOf(r.tickerId), addressTopic(r.pool)] },
      receiptLog.blockNumber,
      latest.number,
    );
    const change = changes.find((log) => isAfter(log, here));
    evidence.pool = {
      token0: read(firsts[token0Call], (data) => getAddress(decodeFunctionResult({ abi: uniswapV3PoolAbi, functionName: 'token0', data }))),
      allowedNow: read(firsts[allowedCall], (data) => decodeFunctionResult({ abi: tokenSourceAbi, functionName: 'isPoolAllowed', data })),
      firstChangeAfter:
        change === undefined ? null : decodeEventLog({ abi: tokenSourceAbi, eventName: 'PoolSet', topics: topicsOf(change), data: change.data }).args.allowed,
    };
  }

  if (writeCountNow > 0) {
    progress('calendar writes');
    evidence.calendar = { ...evidence.calendar, writesAfter: await calendarWritesAfter(scanner, here, latest.number) };
  }

  if (needsRule(kind) && r.ruleVersion > 0) {
    progress('rule');
    evidence.rule = await ruleFor(scanner, r.account, r.ruleVersion, fromBlock, receiptLog.blockNumber);
  }

  if (kind === 'SPLIT_FILL' || kind === 'SPLIT_QUEUE' || kind === 'SPLIT_REFUSAL') {
    progress('account history');
    evidence.account = await accountLogs(scanner, r.account, fromBlock, receiptLog.blockNumber);
  }

  return { found: true, evidence };
}

/** The token, its feeds, the session, the pause and multiplier history, and a removal of the ticker since. */
async function readMarket(
  evidence: Evidence,
  reader: ChainReader,
  scanner: LogScanner,
  input: {
    r: { roundId: bigint; usdgRoundId: bigint; tickerId: number };
    /** The block time of the receipt, at which the session and the history are judged. */
    timestamp: bigint;
    ticker: TickerReading;
    priced: boolean;
    here: LogPosition;
    latest: { number: bigint; timestamp: bigint };
    progress: (step: string) => void;
  },
): Promise<void> {
  const { r, ticker, here, latest } = input;
  const { token, feed } = ticker;
  const batch = new CallBatch();
  const calls = {
    tokenDecimals: batch.add(token, encodeFunctionData({ abi: stockTokenAbi, functionName: 'decimals' })),
    uid: input.priced ? batch.add(token, encodeFunctionData({ abi: stockTokenAbi, functionName: 'uid' })) : -1,
    uiMultiplier: batch.add(token, encodeFunctionData({ abi: stockTokenAbi, functionName: 'uiMultiplier' })),
    newUIMultiplier: batch.add(token, encodeFunctionData({ abi: stockTokenAbi, functionName: 'newUIMultiplier' })),
    effectiveAt: batch.add(token, encodeFunctionData({ abi: stockTokenAbi, functionName: 'effectiveAt' })),
    oraclePaused: batch.add(token, encodeFunctionData({ abi: stockTokenAbi, functionName: 'oraclePaused' })),
    tokenPaused: batch.add(token, encodeFunctionData({ abi: stockTokenPauseAbi, functionName: 'tokenPaused' })),
    registry: batch.add(token, encodeFunctionData({ abi: stockTokenAbi, functionName: 'ACCESS_CONTROLLED_REGISTRY' })),
    registryPaused: batch.add(ADDRESSES.ACCESS_CONTROLS_REGISTRY, encodeFunctionData({ abi: accessRegistryPauseAbi, functionName: 'paused' })),
    feedDecimals: batch.add(feed, encodeFunctionData({ abi: aggregatorV3Abi, functionName: 'decimals' })),
    stockRound: r.roundId === 0n ? -1 : batch.add(feed, encodeFunctionData({ abi: aggregatorV3Abi, functionName: 'getRoundData', args: [r.roundId] })),
    usdgRound:
      r.usdgRoundId === 0n ? -1 : batch.add(USDG_FEED, encodeFunctionData({ abi: aggregatorV3Abi, functionName: 'getRoundData', args: [r.usdgRoundId] })),
    session: batch.add(
      CALENDAR,
      encodeFunctionData({ abi: sessionCalendarExtensionAbi, functionName: 'sessionState', args: [input.timestamp, SESSION_TYPES.indexOf(ticker.sessionType)] }),
    ),
  };
  const out = await batch.run(reader, latest.number);
  evidence.decimals.token = read(out[calls.tokenDecimals], (data) => decodeFunctionResult({ abi: stockTokenAbi, functionName: 'decimals', data }));
  evidence.decimals.feed = read(out[calls.feedDecimals], (data) => decodeFunctionResult({ abi: aggregatorV3Abi, functionName: 'decimals', data }));
  if (calls.uid >= 0) evidence.tokenUid = read(out[calls.uid], (data) => decodeFunctionResult({ abi: stockTokenAbi, functionName: 'uid', data }));
  if (calls.stockRound >= 0) {
    evidence.stockRound = read(out[calls.stockRound], (data) => roundOf(decodeFunctionResult({ abi: aggregatorV3Abi, functionName: 'getRoundData', data })));
  }
  if (calls.usdgRound >= 0) {
    evidence.usdgRound = read(out[calls.usdgRound], (data) => roundOf(decodeFunctionResult({ abi: aggregatorV3Abi, functionName: 'getRoundData', data })));
  }
  evidence.calendar.session = read(out[calls.session], (data) => {
    const [open, reason, openedAt] = decodeFunctionResult({ abi: sessionCalendarExtensionAbi, functionName: 'sessionState', data });
    return { open, reason: enumMember(SESSION_REASONS, reason), openedAt };
  });

  const registry = getAddress(
    must('ACCESS_CONTROLLED_REGISTRY() on the token', read(out[calls.registry], (data) => decodeFunctionResult({ abi: stockTokenAbi, functionName: 'ACCESS_CONTROLLED_REGISTRY', data }))),
  );
  // The batch read the pause of the registry every launch token reports (D-011); a token that reports another one
  // costs one more read.
  const registryOutcome =
    registry.toLowerCase() === ADDRESSES.ACCESS_CONTROLS_REGISTRY.toLowerCase()
      ? out[calls.registryPaused]
      : (await reader.callMany([{ to: registry, data: encodeFunctionData({ abi: accessRegistryPauseAbi, functionName: 'paused' }) }], latest.number))[0];
  const now: TokenNow = {
    uiMultiplier: must('uiMultiplier()', read(out[calls.uiMultiplier], (data) => decodeFunctionResult({ abi: stockTokenAbi, functionName: 'uiMultiplier', data }))),
    newUIMultiplier: must('newUIMultiplier()', read(out[calls.newUIMultiplier], (data) => decodeFunctionResult({ abi: stockTokenAbi, functionName: 'newUIMultiplier', data }))),
    effectiveAt: must('effectiveAt()', read(out[calls.effectiveAt], (data) => decodeFunctionResult({ abi: stockTokenAbi, functionName: 'effectiveAt', data }))),
    tokenPaused: must('tokenPaused()', read(out[calls.tokenPaused], (data) => decodeFunctionResult({ abi: stockTokenPauseAbi, functionName: 'tokenPaused', data }))),
    oraclePaused: must('oraclePaused()', read(out[calls.oraclePaused], (data) => decodeFunctionResult({ abi: stockTokenAbi, functionName: 'oraclePaused', data }))),
    registryPaused: must('paused() on the registry', read(registryOutcome, (data) => decodeFunctionResult({ abi: accessRegistryPauseAbi, functionName: 'paused', data }))),
  };

  input.progress('token history');
  evidence.history = await tokenHistory(scanner, { token, registry, here, timestamp: input.timestamp, latest, now });

  if (!ticker.active) {
    const removals = await scanner.collect(
      { address: TOKEN_SOURCE, topics: [encodeEventTopics({ abi: tokenSourceAbi, eventName: 'TickerRemoved' })[0], topicOf(r.tickerId)] },
      here.blockNumber,
      latest.number,
    );
    evidence.tickerRemovedAfter = removals.some((log) => isAfter(log, here));
  }
}

async function ruleFor(scanner: LogScanner, account: Address, version: number, fromBlock: bigint, toBlock: bigint): Promise<RuleRecord | 'NOT_FOUND'> {
  const signature = encodeEventTopics({ abi: sleeveModuleAbi, eventName: 'RuleSet' })[0];
  const logs = await scanner.collect({ address: MODULE, topics: [signature, addressTopic(account), topicOf(version)] }, fromBlock, toBlock);
  const log = logs[0];
  if (log === undefined) return 'NOT_FOUND';
  const { rule } = decodeEventLog({ abi: sleeveModuleAbi, eventName: 'RuleSet', topics: topicsOf(log), data: log.data }).args;
  return {
    version: rule.version,
    status: enumMember(RULE_STATUSES, rule.status),
    equityBps: rule.equityBps,
    tickerId: rule.tickerId,
    premiumCapBps: rule.premiumCapBps,
    slippageBps: rule.slippageBps,
    minClip: rule.minClip,
  };
}

async function calendarWritesAfter(scanner: LogScanner, here: LogPosition, latest: bigint): Promise<number> {
  const topics = (['YearAppended', 'ClosureAdded', 'EarlyCloseAdded', 'SwitchReplaced'] as const).map(
    (eventName) => encodeEventTopics({ abi: sessionCalendarExtensionAbi, eventName })[0],
  );
  const logs = await scanner.collect({ address: CALENDAR, topics: [topics] }, here.blockNumber, latest);
  return logs.filter((log) => isAfter(log, here)).length;
}

async function accountLogs(scanner: LogScanner, account: Address, fromBlock: bigint, toBlock: bigint): Promise<AccountLogs> {
  const accountTopic = addressTopic(account);
  const installed = encodeEventTopics({ abi: sleeveModuleAbi, eventName: 'Installed' })[0];
  const ownerOpEnded = encodeEventTopics({ abi: sleeveModuleAbi, eventName: 'OwnerOpEnded' })[0];
  const transfer = encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer' })[0];
  return {
    fromBlock,
    installs: await scanner.collect({ address: MODULE, topics: [installed, accountTopic] }, fromBlock, toBlock),
    receipts: await scanner.collect({ address: MODULE, topics: [RECEIPT_WRITTEN_TOPIC, null, accountTopic] }, fromBlock, toBlock),
    ownerOps: await scanner.collect({ address: MODULE, topics: [ownerOpEnded, accountTopic] }, fromBlock, toBlock),
    inbound: await scanner.collect({ address: USDG, topics: [transfer, null, accountTopic] }, fromBlock, toBlock),
  };
}

interface TokenNow {
  uiMultiplier: bigint;
  newUIMultiplier: bigint;
  effectiveAt: bigint;
  tokenPaused: boolean;
  oraclePaused: boolean;
  registryPaused: boolean;
}

/**
 * The token's and registry's pause and multiplier logs from the receipt's block to the latest. A short range goes in
 * one query with an address list and a topic list; a long one as one query per address and topic, which the public
 * RPC lets span a hundred times more blocks.
 */
async function historyLogs(scanner: LogScanner, token: Address, registry: Address, from: bigint, to: bigint): Promise<RawLog[]> {
  const tokenTopics = [MULTIPLIER_TOPIC, PAUSED_TOPIC, UNPAUSED_TOPIC, ORACLE_PAUSED_TOPIC, ORACLE_UNPAUSED_TOPIC];
  if (to - from + 1n <= OR_LIST_SPAN) {
    return scanner.collect({ address: [token, registry], topics: [tokenTopics] }, from, to);
  }
  const queries: LogFilter[] = [
    ...tokenTopics.map((topic) => ({ address: token, topics: [topic] })),
    { address: registry, topics: [PAUSED_TOPIC] },
    { address: registry, topics: [UNPAUSED_TOPIC] },
  ];
  const found: RawLog[] = [];
  for (const query of queries) found.push(...(await scanner.collect(query, from, to)));
  return found;
}

function flagChanges(logs: readonly RawLog[], address: Address, setTopic: Hex, clearTopic: Hex): FlagChange[] {
  return logs
    .filter((log) => log.address.toLowerCase() === address.toLowerCase() && (log.topics[0] === setTopic || log.topics[0] === clearTopic))
    .map((log) => ({ set: log.topics[0] === setTopic, position: positionOf(log), transactionHash: log.transactionHash }))
    .sort((a, b) => comparePositions(a.position, b.position));
}

function multiplierUpdate(log: RawLog): MultiplierUpdate {
  const { args } = decodeEventLog({ abi: stockTokenEventsAbi, eventName: 'UIMultiplierUpdated', topics: topicsOf(log), data: log.data });
  return {
    oldMultiplier: args.oldMultiplier,
    newMultiplier: args.newMultiplier,
    effectiveAt: args.effectiveAtTimestamp,
    position: positionOf(log),
    transactionHash: log.transactionHash,
  };
}

async function tokenHistory(
  scanner: LogScanner,
  input: { token: Address; registry: Address; here: LogPosition; timestamp: bigint; latest: { number: bigint; timestamp: bigint }; now: TokenNow },
): Promise<TokenHistory> {
  const { token, registry, here, latest, now } = input;
  const logs = (await historyLogs(scanner, token, registry, here.blockNumber, latest.number)).filter((log) => isAfter(log, here));
  const updates = logs
    .filter((log) => log.address.toLowerCase() === token.toLowerCase() && log.topics[0] === MULTIPLIER_TOPIC)
    .map(multiplierUpdate)
    .sort((a, b) => comparePositions(a.position, b.position));

  // The state at the receipt follows from the views now unless an update came after it, or a change scheduled before
  // it has taken effect since; only then is the last update before the receipt needed (history.ts).
  const needsLastBefore = updates.length > 0 || (input.timestamp < now.effectiveAt && latest.timestamp >= now.effectiveAt);
  let lastBefore: MultiplierHistory['lastBefore'] = 'NOT_READ';
  if (needsLastBefore) {
    const before = (log: RawLog): boolean => comparePositions(positionOf(log), here) < 0;
    const earlier = await scanner.newest({ address: token, topics: [MULTIPLIER_TOPIC] }, 0n, here.blockNumber, before);
    const last = earlier[earlier.length - 1];
    lastBefore = last === undefined ? null : multiplierUpdate(last);
  }
  return {
    registry,
    multiplier: { uiMultiplier: now.uiMultiplier, newUIMultiplier: now.newUIMultiplier, effectiveAt: now.effectiveAt, after: updates, lastBefore },
    tokenPaused: { now: now.tokenPaused, after: flagChanges(logs, token, PAUSED_TOPIC, UNPAUSED_TOPIC) },
    registryPaused: { now: now.registryPaused, after: flagChanges(logs, registry, PAUSED_TOPIC, UNPAUSED_TOPIC) },
    oraclePaused: { now: now.oraclePaused, after: flagChanges(logs, token, ORACLE_PAUSED_TOPIC, ORACLE_UNPAUSED_TOPIC) },
  };
}
