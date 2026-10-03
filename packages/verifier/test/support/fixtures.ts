import {
  ADDRESSES,
  DEPLOYMENT_4663,
  DISCLOSURE,
  LAUNCH_TICKERS,
  RULE_STATUSES,
  STATUSES,
  erc20Abi,
  execPriceBuy,
  execPriceSell,
  discountBps,
  minOutForBuy,
  minOutForSell,
  premiumBps,
  sessionIsOpen,
  sessionOpenedAt,
  sleeveModuleAbi,
  type Address,
  type Hex,
  type Receipt,
} from '@sleeve/core';
import { encodeAbiParameters, encodeEventTopics, getAbiItem, numberToHex, pad, parseAbiParameters } from 'viem';

import { uniswapV3SwapAbi } from '../../src/abi';
import type { Evidence, RawLog, Reading, RoundData, RuleRecord, TokenHistory } from '../../src/evidence';
import { RECEIPT_WRITTEN_TOPIC, encodeReceipt, hashReceipt } from '../../src/receipt';

/**
 * Evidence built the way the deployed contracts write it, for the check tests: receipts filled field by field as
 * contracts/src/libraries/SleeveTrade.sol and SleeveSell.sol fill them, the logs a buy or a sell leaves in its
 * transaction, and the reads gather.ts would make. Each scenario is consistent, so a test changes one thing and sees
 * exactly the rows that change.
 */

export const MODULE = DEPLOYMENT_4663.contracts.SleeveModule.address;
export const ACCOUNT: Address = '0x4127E4e117Cc01bef1d596B21438d547471e9ED7';
export const PAYER: Address = '0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3';
export const KEEPER: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
export const ROUTER = ADDRESSES.SWAP_ROUTER_02;
export const USDG = ADDRESSES.USDG;

const spyTicker = LAUNCH_TICKERS[0];
const spyPool = spyTicker.pools[0];
export const SPY = { id: spyTicker.id, token: spyTicker.token, feed: spyTicker.feed, uid: spyTicker.tokenUid, pool: spyPool.address };

/** Monday 5 October 2026, 15:00 UTC, 11:00 New York: the ALL_DAY session opened Sunday 20:00 New York time. */
export const MONDAY = 1_791_212_400n;
/** Its opening: Sunday 4 October 2026, 20:00 New York, 00:00 UTC on the 5th. */
export const MONDAY_OPENED = 1_791_158_400n;
/** Saturday 3 October 2026, 23:32 UTC: weekend closure. */
export const SATURDAY = 1_791_070_332n;

export const BLOCK = 79_500_000n;
export const TX: Hex = `0x${'ab'.repeat(32)}`;
export const MULTIPLIER = 1_001_717_991_187_472_003n;
export const STOCK_ROUND = 18_446_744_073_709_551_771n;
export const USDG_ROUND = 18_446_744_073_709_551_738n;
export const PAYMENT = 1_000_000_000n;
export const EQUITY = 100_000_000n;
export const TOKENS = 129_405_328_380_230_006n;

export const RULE: RuleRecord = {
  version: 1,
  status: 'ACTIVE',
  equityBps: 1_000,
  tickerId: 0,
  premiumCapBps: 100,
  slippageBps: 50,
  minClip: 25_000_000n,
};

export function ok<T>(value: T): Reading<T> {
  return { ok: true, value };
}

function word(value: bigint | number): Hex {
  return pad(numberToHex(value), { size: 32 });
}

function addressWord(address: Address): Hex {
  return pad(address, { size: 32 });
}

export interface LogPlace {
  logIndex: number;
  blockNumber?: bigint;
  transactionHash?: Hex;
}

function place(at: LogPlace): Pick<RawLog, 'blockNumber' | 'logIndex' | 'transactionHash'> {
  return { blockNumber: at.blockNumber ?? BLOCK, logIndex: at.logIndex, transactionHash: at.transactionHash ?? TX };
}

export function receiptLog(receipt: Receipt, at: LogPlace): RawLog {
  return {
    address: MODULE,
    topics: [RECEIPT_WRITTEN_TOPIC, word(receipt.id), addressWord(receipt.account), word(STATUSES.indexOf(receipt.status))],
    data: encodeReceipt(receipt),
    ...place(at),
  };
}

const TRANSFER = encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer' })[0];
const APPROVAL = encodeEventTopics({ abi: erc20Abi, eventName: 'Approval' })[0];
const SWAP = encodeEventTopics({ abi: uniswapV3SwapAbi, eventName: 'Swap' })[0];

export function transferLog(token: Address, from: Address, to: Address, value: bigint, at: LogPlace): RawLog {
  return { address: token, topics: [TRANSFER, addressWord(from), addressWord(to)], data: word(value), ...place(at) };
}

export function approvalLog(token: Address, owner: Address, spender: Address, value: bigint, at: LogPlace): RawLog {
  return { address: token, topics: [APPROVAL, addressWord(owner), addressWord(spender)], data: word(value), ...place(at) };
}

/** A v3 Swap log. amount0 and amount1 are the pool's deltas, positive for what it received. */
export function swapLog(pool: Address, recipient: Address, amount0: bigint, amount1: bigint, at: LogPlace): RawLog {
  return {
    address: pool,
    topics: [SWAP, addressWord(ROUTER), addressWord(recipient)],
    data: encodeAbiParameters(parseAbiParameters('int256, int256, uint160, uint128, int24'), [amount0, amount1, 2n ** 96n, 10n ** 18n, -1]),
    ...place(at),
  };
}

export function moduleLog(eventName: 'Installed' | 'OwnerOpEnded', account: Address, at: LogPlace): RawLog {
  const topic = encodeEventTopics({ abi: sleeveModuleAbi, eventName })[0];
  return { address: MODULE, topics: [topic, addressWord(account)], data: '0x', ...place(at) };
}

export function reconciledLog(account: Address, receiptId: bigint, balance: bigint, fromSpend: bigint, fromBuckets: readonly bigint[], at: LogPlace): RawLog {
  const topic = encodeEventTopics({ abi: sleeveModuleAbi, eventName: 'Reconciled' })[0];
  return {
    address: MODULE,
    topics: [topic, addressWord(account), word(receiptId)],
    data: encodeAbiParameters(parseAbiParameters('uint256, uint256, uint256[]'), [balance, fromSpend, [...fromBuckets]]),
    ...place(at),
  };
}

const ruleSetEvent = getAbiItem({ abi: sleeveModuleAbi, name: 'RuleSet' });

export function ruleSetLog(account: Address, rule: RuleRecord, at: LogPlace): RawLog {
  const topics = encodeEventTopics({ abi: sleeveModuleAbi, eventName: 'RuleSet', args: { account, version: rule.version } });
  const data = encodeAbiParameters(
    [ruleSetEvent.inputs[2]],
    [
      {
        version: rule.version,
        status: RULE_STATUSES.indexOf(rule.status),
        equityBps: rule.equityBps,
        tickerId: rule.tickerId,
        premiumCapBps: rule.premiumCapBps,
        slippageBps: rule.slippageBps,
        minClip: rule.minClip,
      },
    ],
  );
  return { address: MODULE, topics: topics.filter((topic): topic is Hex => topic !== null), data, ...place(at) };
}

export function lotsReconciledLog(account: Address, tickerId: number, balance: bigint, trimmed: bigint, at: LogPlace): RawLog {
  const topic = encodeEventTopics({ abi: sleeveModuleAbi, eventName: 'LotsReconciled' })[0];
  return {
    address: MODULE,
    topics: [topic, addressWord(account), word(tickerId)],
    data: encodeAbiParameters(parseAbiParameters('uint256, uint256'), [balance, trimmed]),
    ...place(at),
  };
}

/** Every field zero, as a Solidity memory struct starts, with what SleeveReceipts.write fills on every receipt. */
export function blankReceipt(overrides: Partial<Receipt> = {}): Receipt {
  return {
    id: 1n,
    account: ACCOUNT,
    ruleVersion: 1,
    trigger: 'KEEPER',
    payer: '0x0000000000000000000000000000000000000000',
    status: 'FILLED',
    reason: 'NONE',
    mode: 'WRAPPED',
    tickerId: 0,
    token: '0x0000000000000000000000000000000000000000',
    tokenUid: `0x${'0'.repeat(64)}`,
    usdgIn: 0n,
    usdgToSpend: 0n,
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
    pool: '0x0000000000000000000000000000000000000000',
    calendarVersion: 65_536,
    disclosureHash: DISCLOSURE.keccak256,
    l2Block: BLOCK,
    timestamp: MONDAY,
    lotId: 0n,
    queuedSince: 0n,
    overrideClosed: false,
    overrideCapBps: 0,
    ...overrides,
  };
}

/** The answer at which buying `tokens` for `usdg` pays no premium: ceil(usdg * 10^20 / tokens). */
export function evenAnswer(usdg: bigint, tokens: bigint): bigint {
  return (usdg * 10n ** 20n + tokens - 1n) / tokens;
}

function quiet(now: boolean): { now: boolean; after: [] } {
  return { now, after: [] };
}

export function quietHistory(): TokenHistory {
  return {
    registry: ADDRESSES.ACCESS_CONTROLS_REGISTRY,
    multiplier: { uiMultiplier: MULTIPLIER, newUIMultiplier: MULTIPLIER, effectiveAt: 1_789_690_233n, after: [], lastBefore: 'NOT_READ' },
    tokenPaused: quiet(false),
    registryPaused: quiet(false),
    oraclePaused: quiet(false),
  };
}

function round(roundId: bigint, answer: bigint, updatedAt: bigint): Reading<RoundData> {
  return ok({ roundId, answer, startedAt: updatedAt - 12n, updatedAt });
}

/** The deployed calendar's answer, which agrees with the port while no write is in force. */
function extensionSession(timestamp: bigint): Evidence['calendar']['session'] {
  const { open, reason } = sessionIsOpen(timestamp, 'ALL_DAY');
  return ok({ open, reason, openedAt: open ? sessionOpenedAt(timestamp, 'ALL_DAY') : 0n });
}

/** Evidence for one receipt, with every read a gather would make for it set to what the chain holds. */
export function evidenceFor(receipt: Receipt, logs: readonly RawLog[], overrides: Partial<Evidence> = {}): Evidence {
  const receiptLogFound = logs.find((log) => log.topics[0] === RECEIPT_WRITTEN_TOPIC && log.topics[1] === word(receipt.id));
  if (receiptLogFound === undefined) throw new Error(`no ReceiptWritten log for ${receipt.id} in the fixture`);
  const market = receipt.token !== '0x0000000000000000000000000000000000000000';
  return {
    id: receipt.id,
    rpcUrl: 'https://rpc.test',
    chainId: 4663,
    module: MODULE,
    latestBlock: receiptLogFound.blockNumber + 1_000n,
    latestTimestamp: receipt.timestamp + 3_600n,
    fromBlock: BigInt(DEPLOYMENT_4663.firstBlock),
    receiptLog: receiptLogFound,
    duplicateLogs: [],
    storedHash: hashReceipt(receipt),
    block: { number: receiptLogFound.blockNumber, timestamp: receipt.timestamp },
    transaction: { hash: receiptLogFound.transactionHash, from: KEEPER, to: MODULE, logs },
    disclosureHash: DISCLOSURE.keccak256,
    guardParams: { stockFeedMaxAge: 90_000n, usdgFeedMaxAge: 90_000n, depegToleranceBps: 50, multiplierWindow: 86_400n },
    calendar: { versionNow: 65_536, writeCountNow: 0, writesAfter: 0, session: market ? extensionSession(receipt.timestamp) : null },
    decimals: { usdg: ok(6), token: market ? ok(18) : null, feed: market ? ok(8) : null, usdgFeed: ok(8) },
    ticker: market ? ok({ token: SPY.token, feed: SPY.feed, sessionType: 'ALL_DAY', active: true }) : null,
    tickerRemovedAfter: null,
    tokenUid: receipt.tokenUid === `0x${'0'.repeat(64)}` ? null : ok(SPY.uid),
    stockRound: receipt.roundId === 0n ? null : round(receipt.roundId, receipt.answer, receipt.updatedAt),
    usdgRound: receipt.usdgRoundId === 0n ? null : round(receipt.usdgRoundId, receipt.usdgAnswer, receipt.timestamp - 3_600n),
    rule: receipt.ruleVersion === 0 ? null : RULE,
    lot: null,
    pool: receipt.pool === '0x0000000000000000000000000000000000000000' ? null : { token0: ok(USDG), allowedNow: ok(true), firstChangeAfter: null },
    history: market ? quietHistory() : null,
    account: null,
    ...overrides,
  };
}

/** A payment's Installed log and inbound transfer, before the receipt, for the derived inbound rows. */
function accountBefore(receiptBlock: bigint, inbound: bigint): Evidence['account'] {
  return {
    fromBlock: BigInt(DEPLOYMENT_4663.firstBlock),
    installs: [moduleLog('Installed', ACCOUNT, { logIndex: 0, blockNumber: receiptBlock - 10n, transactionHash: `0x${'01'.repeat(32)}` })],
    receipts: [],
    ownerOps: [],
    inbound: [transferLog(USDG, PAYER, ACCOUNT, inbound, { logIndex: 0, blockNumber: receiptBlock - 5n, transactionHash: `0x${'02'.repeat(32)}` })],
  };
}

export interface Scenario {
  receipt: Receipt;
  evidence: Evidence;
}

/** A keeper split that filled on SPY (SPEC 9): 1,000 USDG in, 10 percent bought through the fee-500 pool. */
export function filledSplit(options: { answer?: bigint; tokens?: bigint; timestamp?: bigint; updatedAt?: bigint } = {}): Scenario {
  const tokens = options.tokens ?? TOKENS;
  const answer = options.answer ?? evenAnswer(EQUITY, tokens);
  const timestamp = options.timestamp ?? MONDAY;
  const quote = (TOKENS * 1_000_000n) / EQUITY;
  const receipt = blankReceipt({
    id: 3n,
    status: 'FILLED',
    token: SPY.token,
    tokenUid: SPY.uid,
    usdgIn: PAYMENT,
    usdgToSpend: PAYMENT - EQUITY,
    usdgToEquity: EQUITY,
    usdgSpent: EQUITY,
    tokensOut: tokens,
    uiMultiplier: MULTIPLIER,
    execPrice: execPriceBuy(EQUITY, tokens),
    premiumBps: premiumBps(EQUITY, tokens, answer),
    roundId: STOCK_ROUND,
    answer,
    updatedAt: options.updatedAt ?? timestamp - 600n,
    usdgRoundId: USDG_ROUND,
    usdgAnswer: 100_000_000n,
    quote,
    minOut: minOutForBuy(EQUITY, quote, RULE.slippageBps),
    venueId: 1,
    pool: SPY.pool,
    timestamp,
    lotId: 3n,
  });
  const logs = [
    approvalLog(USDG, ACCOUNT, ROUTER, EQUITY, { logIndex: 0 }),
    transferLog(SPY.token, SPY.pool, ACCOUNT, tokens, { logIndex: 1 }),
    transferLog(USDG, ACCOUNT, SPY.pool, EQUITY, { logIndex: 2 }),
    swapLog(SPY.pool, ACCOUNT, EQUITY, -tokens, { logIndex: 3 }),
    approvalLog(USDG, ACCOUNT, ROUTER, 0n, { logIndex: 4 }),
    receiptLog(receipt, { logIndex: 5 }),
  ];
  const evidence = evidenceFor(receipt, logs, {
    lot: ok({ account: ACCOUNT, tickerId: 0, status: 'FILLED', tokensBought: tokens, tokensRemaining: tokens }),
    account: accountBefore(BLOCK, PAYMENT),
  });
  return { receipt, evidence };
}

/** A keeper settle of a 100 USDG bucket that waited for SESSION since the weekend (SPEC 10). */
export function settledBucket(): Scenario {
  const answer = evenAnswer(EQUITY, TOKENS);
  const quote = (TOKENS * 1_000_000n) / EQUITY;
  const receipt = blankReceipt({
    id: 2n,
    status: 'SETTLED',
    reason: 'SESSION',
    token: SPY.token,
    tokenUid: SPY.uid,
    usdgToEquity: EQUITY,
    usdgSpent: EQUITY,
    tokensOut: TOKENS,
    uiMultiplier: MULTIPLIER,
    execPrice: execPriceBuy(EQUITY, TOKENS),
    premiumBps: premiumBps(EQUITY, TOKENS, answer),
    roundId: STOCK_ROUND,
    answer,
    updatedAt: MONDAY - 600n,
    usdgRoundId: USDG_ROUND,
    usdgAnswer: 100_000_000n,
    quote,
    minOut: minOutForBuy(EQUITY, quote, RULE.slippageBps),
    venueId: 1,
    pool: SPY.pool,
    lotId: 2n,
    queuedSince: SATURDAY,
  });
  const logs = [
    approvalLog(USDG, ACCOUNT, ROUTER, EQUITY, { logIndex: 0 }),
    transferLog(SPY.token, SPY.pool, ACCOUNT, TOKENS, { logIndex: 1 }),
    transferLog(USDG, ACCOUNT, SPY.pool, EQUITY, { logIndex: 2 }),
    swapLog(SPY.pool, ACCOUNT, EQUITY, -TOKENS, { logIndex: 3 }),
    approvalLog(USDG, ACCOUNT, ROUTER, 0n, { logIndex: 4 }),
    receiptLog(receipt, { logIndex: 5 }),
  ];
  return {
    receipt,
    evidence: evidenceFor(receipt, logs, {
      lot: ok({ account: ACCOUNT, tickerId: 0, status: 'SETTLED', tokensBought: TOKENS, tokensRemaining: TOKENS }),
    }),
  };
}

/** A keeper split on a Saturday: the guard stops at the calendar, so no round is read (SPEC 9 step 5). */
export function queuedSplit(overrides: Partial<Receipt> = {}): Scenario {
  const receipt = blankReceipt({
    id: 1n,
    status: 'QUEUED',
    reason: 'SESSION',
    token: SPY.token,
    usdgIn: PAYMENT,
    usdgToSpend: PAYMENT - EQUITY,
    usdgToEquity: EQUITY,
    usdgQueued: EQUITY,
    timestamp: SATURDAY,
    ...overrides,
  });
  const logs = [receiptLog(receipt, { logIndex: 0 })];
  return { receipt, evidence: evidenceFor(receipt, logs, { account: accountBefore(BLOCK, receipt.usdgIn) }) };
}

export interface SellPart {
  id: bigint;
  lotId: bigint;
  tokensIn: bigint;
  status: 'PART_SOLD' | 'SOLD';
}

/**
 * The receipts one sell writes (SPEC 12 and 13): the whole sell's price, discount, rounds and caps on every receipt,
 * each lot's part as tokensIn, and the proceeds pro rata, rounded down, with the last lot taking the rest.
 */
export function sellReceipts(parts: readonly SellPart[], usdgOut: bigint, quote: bigint, answer: bigint, options: { overrideCapBps?: number } = {}): Receipt[] {
  const tokenAmount = parts.reduce((sum, part) => sum + part.tokensIn, 0n);
  let paid = 0n;
  return parts.map((part, index) => {
    const share = index === parts.length - 1 ? usdgOut - paid : (usdgOut * part.tokensIn) / tokenAmount;
    paid += share;
    return blankReceipt({
      id: part.id,
      trigger: 'OWNER',
      status: part.status,
      token: SPY.token,
      tokenUid: SPY.uid,
      tokensIn: part.tokensIn,
      usdgOut: share,
      usdgToSpend: share,
      uiMultiplier: MULTIPLIER,
      execPrice: execPriceSell(usdgOut, tokenAmount),
      premiumBps: discountBps(usdgOut, tokenAmount, answer),
      roundId: STOCK_ROUND,
      answer,
      updatedAt: MONDAY - 600n,
      usdgRoundId: USDG_ROUND,
      usdgAnswer: 100_000_000n,
      quote,
      minOut: minOutForSell(tokenAmount, quote, RULE.slippageBps),
      venueId: 1,
      pool: SPY.pool,
      lotId: part.lotId,
      overrideCapBps: options.overrideCapBps ?? 0,
    });
  });
}

/** The logs of one sell's swap: approval, USDG paid out, tokens taken in, Swap, approval reset. */
export function sellSwapLogs(tokenAmount: bigint, usdgOut: bigint, firstIndex: number): RawLog[] {
  return [
    approvalLog(SPY.token, ACCOUNT, ROUTER, tokenAmount, { logIndex: firstIndex }),
    transferLog(USDG, SPY.pool, ACCOUNT, usdgOut, { logIndex: firstIndex + 1 }),
    transferLog(SPY.token, ACCOUNT, SPY.pool, tokenAmount, { logIndex: firstIndex + 2 }),
    swapLog(SPY.pool, ACCOUNT, -usdgOut, tokenAmount, { logIndex: firstIndex + 3 }),
    approvalLog(SPY.token, ACCOUNT, ROUTER, 0n, { logIndex: firstIndex + 4 }),
  ];
}

/**
 * One owner batch with two sells of SPY: lot 10 sold by id, then lots 11 and 12 by amount, at different prices. SPEC
 * 13's grouping must keep each sell's run apart.
 */
export function twoSells(): { receipts: Receipt[]; logs: RawLog[]; answer: bigint } {
  const answer = evenAnswer(EQUITY, TOKENS);
  const first = sellReceipts([{ id: 20n, lotId: 10n, tokensIn: TOKENS, status: 'SOLD' }], 99_901_158n, 772_001_892n, answer);
  const second = sellReceipts(
    [
      { id: 21n, lotId: 11n, tokensIn: TOKENS, status: 'SOLD' },
      { id: 22n, lotId: 12n, tokensIn: TOKENS / 2n, status: 'PART_SOLD' },
    ],
    149_801_000n,
    771_500_000n,
    answer,
  );
  const [a] = first;
  const [b, c] = second;
  if (a === undefined || b === undefined || c === undefined) throw new Error('fixture');
  const logs = [
    ...sellSwapLogs(TOKENS, 99_901_158n, 0),
    receiptLog(a, { logIndex: 5 }),
    ...sellSwapLogs(TOKENS + TOKENS / 2n, 149_801_000n, 6),
    receiptLog(b, { logIndex: 11 }),
    receiptLog(c, { logIndex: 12 }),
    moduleLog('OwnerOpEnded', ACCOUNT, { logIndex: 13 }),
  ];
  return { receipts: [a, b, c], logs, answer };
}

/** Evidence for one receipt of twoSells(), with its lot read now. */
export function sellEvidence(receipt: Receipt, logs: readonly RawLog[], lotStatus: 'PART_SOLD' | 'SOLD' = receipt.status === 'SOLD' ? 'SOLD' : 'PART_SOLD'): Evidence {
  return evidenceFor(receipt, logs, {
    transaction: { hash: TX, from: KEEPER, to: ADDRESSES.ENTRY_POINT_V07, logs },
    lot: ok({ account: ACCOUNT, tickerId: 0, status: lotStatus, tokensBought: TOKENS, tokensRemaining: lotStatus === 'SOLD' ? 0n : TOKENS / 2n }),
  });
}
