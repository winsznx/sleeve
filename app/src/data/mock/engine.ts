import {
  ADDRESSES,
  DISCLOSURE,
  LAUNCH_TICKERS,
  MODULE_PARAMS,
  PRICE_UNIT,
  RULE_LIMITS,
  TOTAL_BPS,
  ZERO_ADDRESS,
  discountBps,
  exceedsDiscount,
  exceedsPremium,
  execPriceBuy,
  execPriceSell,
  isPoolAllowlisted,
  minOutForBuy,
  minOutForSell,
  premiumBps,
  tickerById,
  validateRuleInput,
  type Address,
  type Bucket,
  type FeedRound,
  type Hex,
  type Lot,
  type Reason,
  type Receipt,
  type Rule,
  type RuleInput,
  type TickerId,
  type Trigger,
} from '@sleeve/core';

import { DataLayerError } from '../errors';
import type {
  ChainPoint,
  FeedReading,
  InboundRef,
  InboxItem,
  ReceiptRecord,
  Reconciliation,
  SellBlock,
  SellQuote,
  SellRequest,
  Session,
  SplitOutcome,
  TickerMarket,
} from '../types';
import { pseudoAddress, pseudoHash } from './pseudo-hash';

/**
 * An in-memory model of SleeveModule for one or more accounts, written from docs/SPEC.md sections 6 to 14,
 * LedgerMath and PriceGuard. The fixtures replay a payment history through it and the mock data layer's writes
 * call it, so sample receipts and live writes follow the same rules: I2 on every split, reconcile spend first,
 * buckets that keep their first queue time, lots that only move FILLED or SETTLED to PART_SOLD to SOLD.
 */

const BPS = BigInt(TOTAL_BPS);
const ZERO_HASH: Hex = `0x${'0'.repeat(64)}`;
/** Blocks per second measured between the two D-008 blocks, times 1,000. */
const BLOCK_RATE_X1000 = 8_484n;

export interface MockAccount {
  address: Address;
  credentialId: string;
  deployed: boolean;
  installedAt: bigint | null;
  keeper: Address;
  recoverySigner: Address | null;
  usdgBalance: bigint;
  spend: bigint;
  buckets: Map<TickerId, Bucket>;
  rule: Rule;
  /** Every rule version written, oldest first. */
  ruleHistory: Rule[];
  observation: { observedAt: bigint; observedUnsorted: bigint } | null;
  tokenBalances: Map<TickerId, bigint>;
  /** Inbound transfers, oldest first. */
  inbox: InboxItem[];
}

export interface VenueQuote {
  /** All-in cost of a buy over the feed, in basis points. Negative when the pool sits below the feed. */
  buyPremiumBps: number;
  /** All-in shortfall of a sell under the feed, in basis points. */
  sellDiscountBps: number;
}

/** A Transfer log of a fill transaction, the record the verifier reads instead of the receipt (D-009 Q36). */
export interface TransferLog {
  token: Address;
  from: Address;
  to: Address;
  amount: bigint;
}

export interface MockWorld {
  clock: ChainPoint;
  nextReceiptId: bigint;
  /** Every receipt, ascending id. */
  receipts: ReceiptRecord[];
  lots: Map<bigint, Lot>;
  accounts: Map<Address, MockAccount>;
  session: Session | null;
  /** The account a sign-in returns to. */
  lastAccount: Address | null;
  /** Live market at the clock, one entry per launch ticker. */
  market: Map<TickerId, TickerMarket>;
  venue: Map<TickerId, VenueQuote>;
  usdgUsd: FeedReading;
  /** Every feed round a receipt read, by `${feed}:${roundId}` with the feed lower-cased: getRoundData's answers. */
  rounds: Map<string, FeedRound>;
  /** Transfer logs by transaction hash. */
  logs: Map<Hex, TransferLog[]>;
  calendarVersion: number;
  defaultKeeper: Address;
  /** Accounts on the issuer's blocklist; a buy for them is REFUSED_ACCOUNT. */
  blockedAccounts: Set<Address>;
  /** Shared cards by opaque id. Card contents are computed from receipts when read. */
  cards: Map<string, StoredCard>;
  ipCountry: string | null;
  createdAccounts: number;
}

export interface StoredCard {
  cardId: string;
  account: Address;
  subject: { kind: 'receipt'; receiptId: bigint } | { kind: 'week'; weekStart: bigint };
  showAmounts: boolean;
  showProof: boolean;
}

/** What the guard and the venue see at one moment. Fixtures pass it; live writes derive it from the clock. */
export interface GuardContext {
  at: ChainPoint;
  sessionOpen: boolean;
  /** When the next session opens, for SellWaits. */
  reopensAt: bigint | null;
  feed: FeedReading;
  usdgUsd: FeedReading;
  uiMultiplier: bigint;
  venue: VenueQuote;
  paused: boolean;
  oraclePaused: boolean;
  multiplierDue: boolean;
  feedStale: boolean;
  usdgDepegged: boolean;
  accountBlocked: boolean;
}

function minBig(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

export function roundKey(feed: Address, roundId: bigint): string {
  return `${feed.toLowerCase()}:${roundId}`;
}

export function pendingTotal(account: MockAccount): bigint {
  let total = 0n;
  for (const bucket of account.buckets.values()) total += bucket.amount;
  return total;
}

/** LedgerMath.unsorted: balance minus spend minus pending, floored at zero. */
export function unsortedOf(account: MockAccount): bigint {
  const covered = account.spend + pendingTotal(account);
  return account.usdgBalance > covered ? account.usdgBalance - covered : 0n;
}

/** LedgerMath.shortfall: how far the ledgers exceed the balance. */
export function shortfallOf(account: MockAccount): bigint {
  const covered = account.spend + pendingTotal(account);
  return covered > account.usdgBalance ? covered - account.usdgBalance : 0n;
}

export function lookupAccount(world: MockWorld, address: Address): MockAccount | undefined {
  for (const account of world.accounts.values()) {
    if (account.address.toLowerCase() === address.toLowerCase()) return account;
  }
  return undefined;
}

export function chainPointAfter(point: ChainPoint, seconds: bigint): ChainPoint {
  return { timestamp: point.timestamp + seconds, l2Block: point.l2Block + (seconds * BLOCK_RATE_X1000) / 1_000n };
}

export function advanceClock(world: MockWorld, seconds: bigint): ChainPoint {
  world.clock = chainPointAfter(world.clock, seconds);
  return world.clock;
}

function isFeedStale(feed: FeedRound, now: bigint, sessionOpenedAt: bigint | null): boolean {
  return (
    feed.answer <= 0n ||
    feed.updatedAt > now ||
    now - feed.updatedAt > MODULE_PARAMS.stockFeedMaxAgeSeconds ||
    (sessionOpenedAt !== null && feed.updatedAt < sessionOpenedAt)
  );
}

function isUsdgDepegged(usdgUsd: FeedRound, now: bigint): boolean {
  const one = 100_000_000n;
  const priceBps = usdgUsd.answer * BPS;
  const tolerance = BigInt(MODULE_PARAMS.depegToleranceBps);
  return (
    usdgUsd.answer <= 0n ||
    usdgUsd.updatedAt > now ||
    now - usdgUsd.updatedAt > MODULE_PARAMS.usdgFeedMaxAgeSeconds ||
    priceBps < one * (BPS - tolerance) ||
    priceBps > one * (BPS + tolerance)
  );
}

/** The guard's view at the mock clock, from the live market snapshot. */
export function contextAtClock(world: MockWorld, account: MockAccount, tickerId: TickerId): GuardContext {
  const market = world.market.get(tickerId);
  const venue = world.venue.get(tickerId);
  if (market === undefined || venue === undefined) {
    throw new DataLayerError({ code: 'NotFound' }, `No market for ticker ${tickerId}`);
  }
  const now = world.clock.timestamp;
  return {
    at: world.clock,
    sessionOpen: market.session.open,
    reopensAt: market.session.nextOpenAt,
    feed: market.feed,
    usdgUsd: world.usdgUsd,
    uiMultiplier: market.uiMultiplier,
    venue,
    paused: market.paused,
    oraclePaused: market.oraclePaused,
    multiplierDue:
      market.pendingMultiplier !== null &&
      market.pendingMultiplier.value !== market.uiMultiplier &&
      market.pendingMultiplier.effectiveAt > now &&
      market.pendingMultiplier.effectiveAt - now <= MODULE_PARAMS.multiplierWindowSeconds,
    feedStale: isFeedStale(market.feed, now, market.session.openedAt),
    usdgDepegged: isUsdgDepegged(world.usdgUsd, now),
    accountBlocked: world.blockedAccounts.has(account.address),
  };
}

function nextReceiptId(world: MockWorld): bigint {
  const id = world.nextReceiptId;
  world.nextReceiptId += 1n;
  return id;
}

type ReceiptOverrides = Partial<Omit<Receipt, 'id' | 'account' | 'mode' | 'l2Block' | 'timestamp'>>;

function buildReceipt(
  world: MockWorld,
  account: MockAccount,
  at: ChainPoint,
  base: { trigger: Trigger; status: Receipt['status']; tickerId: TickerId },
  overrides: ReceiptOverrides,
): Receipt {
  const ticker = tickerById(base.tickerId);
  return {
    id: nextReceiptId(world),
    account: account.address,
    ruleVersion: account.rule.version,
    trigger: base.trigger,
    payer: ZERO_ADDRESS,
    status: base.status,
    reason: 'NONE',
    mode: 'WRAPPED',
    tickerId: base.tickerId,
    token: ticker?.token ?? ZERO_ADDRESS,
    tokenUid: ticker?.tokenUid ?? ZERO_HASH,
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
    pool: ZERO_ADDRESS,
    calendarVersion: world.calendarVersion,
    disclosureHash: DISCLOSURE.keccak256,
    l2Block: at.l2Block,
    timestamp: at.timestamp,
    lotId: 0n,
    queuedSince: 0n,
    overrideClosed: false,
    overrideCapBps: 0,
    ...overrides,
  };
}

/**
 * Stands in for keccak256(abi.encode(receipt)) in sample data: a deterministic 32 bytes over every field in
 * SPEC 13 order. The chain implementation reads the real hash from receiptHash(id).
 */
export function sampleReceiptHash(receipt: Receipt): Hex {
  return pseudoHash(`receipt:${Object.values(receipt).map(String).join('|')}`);
}

function ruleAt(account: MockAccount, version: number): Rule | null {
  return account.ruleHistory.find((rule) => rule.version === version) ?? null;
}

function record(
  world: MockWorld,
  account: MockAccount,
  receipt: Receipt,
  txHash: Hex,
  inbound: InboundRef[],
  reconciliation: Reconciliation | null = null,
): ReceiptRecord {
  const entry: ReceiptRecord = {
    receipt,
    receiptHash: sampleReceiptHash(receipt),
    derived: { txHash, inbound, rule: ruleAt(account, receipt.ruleVersion) },
    reconciliation,
  };
  world.receipts.push(entry);
  return entry;
}

function txHashFor(account: MockAccount, at: ChainPoint, label: string): Hex {
  return pseudoHash(`tx:${label}:${account.address}:${at.l2Block}`);
}

/** Remembers the rounds a receipt read, as getRoundData would serve them later. */
function rememberRounds(world: MockWorld, ctx: GuardContext, fields: ReceiptOverrides): void {
  if (fields.roundId !== undefined && fields.roundId !== 0n) {
    world.rounds.set(roundKey(ctx.feed.feed, ctx.feed.roundId), ctx.feed);
  }
  if (fields.usdgRoundId !== undefined && fields.usdgRoundId !== 0n) {
    world.rounds.set(roundKey(ctx.usdgUsd.feed, ctx.usdgUsd.roundId), ctx.usdgUsd);
  }
}

function logTransfers(world: MockWorld, txHash: Hex, transfers: TransferLog[]): void {
  world.logs.set(txHash, [...(world.logs.get(txHash) ?? []), ...transfers]);
}

interface BuyFill {
  tokensOut: bigint;
  execPrice: bigint;
  premiumBps: bigint;
  /** Raw token units per 1e6 USDG base units, as the trigger quotes it (D-009 Q21). */
  quote: bigint;
}

/** The fill a pool `venuePremiumBps` over the feed gives for `usdgSpent`, priced as PriceGuard prices it. */
function buyFill(usdgSpent: bigint, answer: bigint, venuePremiumBps: number): BuyFill {
  const numerator = usdgSpent * 10n ** 20n * BPS;
  const denominator = answer * (BPS + BigInt(venuePremiumBps));
  const tokensOut = (numerator + denominator - 1n) / denominator;
  return {
    tokensOut,
    execPrice: execPriceBuy(usdgSpent, tokensOut),
    premiumBps: premiumBps(usdgSpent, tokensOut, answer),
    quote: (tokensOut * 1_000_000n) / usdgSpent,
  };
}

/** USDG a sale of `tokensIn` brings at `venueDiscountBps` under the feed. */
function sellProceeds(tokensIn: bigint, answer: bigint, venueDiscountBps: number): bigint {
  return (tokensIn * answer * (BPS - BigInt(venueDiscountBps))) / (10n ** 20n * BPS);
}

export function receivePayment(
  world: MockWorld,
  account: MockAccount,
  payment: { from: Address; amount: bigint; at: ChainPoint },
): InboxItem {
  const txHash = pseudoHash(`pay:${account.address}:${payment.from}:${payment.at.timestamp}:${payment.amount}`);
  const item: InboxItem = {
    id: `${txHash}:0`,
    from: payment.from,
    amount: payment.amount,
    txHash,
    logIndex: 0,
    l2Block: payment.at.l2Block,
    timestamp: payment.at.timestamp,
    state: 'RECEIVED',
    graceEndsAt: null,
    sortedBy: null,
  };
  account.usdgBalance += payment.amount;
  account.inbox.push(item);
  return item;
}

/** SPEC 8 observe(): starts or restarts the public-trigger clock. */
export function observe(account: MockAccount, at: ChainPoint): void {
  const unsorted = unsortedOf(account);
  if (unsorted === 0n && pendingTotal(account) === 0n) {
    throw new DataLayerError({ code: 'NothingWaiting' }, 'Nothing is waiting to be sorted');
  }
  if (account.observation === null || unsorted > account.observation.observedUnsorted) {
    account.observation = { observedAt: at.timestamp, observedUnsorted: unsorted };
  }
  const graceEndsAt = account.observation.observedAt + MODULE_PARAMS.graceSeconds;
  for (const item of account.inbox) {
    if (item.state === 'RECEIVED' && item.timestamp <= at.timestamp) {
      item.state = 'WAITING_GRACE';
      item.graceEndsAt = graceEndsAt;
    }
  }
}

/** USDG left the account outside Sleeve, for example through an old approval. Ledgers catch up at the next split. */
export function externalPull(account: MockAccount, amount: bigint): void {
  if (amount > account.usdgBalance) throw new Error('pull exceeds balance');
  account.usdgBalance -= amount;
}

/** A bracketed owner batch that sent USDG out: LedgerMath.allocateOutflow, spend then unsorted then buckets. */
export function ownerOutflow(account: MockAccount, amount: bigint): void {
  if (amount > account.usdgBalance) throw new Error('OutflowExceedsLedgers');
  let remaining = amount;
  const fromSpend = minBig(remaining, account.spend);
  remaining -= fromSpend;
  remaining -= minBig(remaining, unsortedOf(account));
  const cuts: { tickerId: TickerId; amount: bigint }[] = [];
  for (const tickerId of [...account.buckets.keys()].sort((a, b) => a - b)) {
    const bucket = account.buckets.get(tickerId);
    if (remaining === 0n || bucket === undefined) continue;
    const taken = minBig(remaining, bucket.amount);
    cuts.push({ tickerId, amount: taken });
    remaining -= taken;
  }
  if (remaining !== 0n) throw new Error('OutflowExceedsLedgers');
  account.spend -= fromSpend;
  for (const cut of cuts) takeFromBucket(account, cut.tickerId, cut.amount);
  account.usdgBalance -= amount;
}

function takeFromBucket(account: MockAccount, tickerId: TickerId, amount: bigint): void {
  const bucket = account.buckets.get(tickerId);
  if (bucket === undefined) return;
  if (amount >= bucket.amount) account.buckets.delete(tickerId);
  else account.buckets.set(tickerId, { ...bucket, amount: bucket.amount - amount });
}

/** LedgerMath.reconcile: cut spend first, then buckets in ascending ticker id, never below zero. */
function reconcile(account: MockAccount): Reconciliation | null {
  const shortfall = shortfallOf(account);
  if (shortfall === 0n) return null;
  const ids = [...account.buckets.keys()].sort((a, b) => a - b);
  let balanceLeft = account.usdgBalance;
  const fromBuckets: { tickerId: TickerId; amount: bigint }[] = [];
  for (const tickerId of [...ids].reverse()) {
    const bucket = account.buckets.get(tickerId);
    if (bucket === undefined) continue;
    const kept = minBig(bucket.amount, balanceLeft);
    balanceLeft -= kept;
    if (kept < bucket.amount) fromBuckets.unshift({ tickerId, amount: bucket.amount - kept });
  }
  const fromSpend = account.spend - minBig(account.spend, balanceLeft);
  account.spend -= fromSpend;
  for (const cut of fromBuckets) takeFromBucket(account, cut.tickerId, cut.amount);
  return { shortfall, fromSpend, fromBuckets };
}

type GuardStep =
  | 'TICKER'
  | 'ACCOUNT'
  | 'PAUSED'
  | 'ORACLE_PAUSED'
  | 'SESSION'
  | 'MULTIPLIER'
  | 'STALE'
  | 'DEPEG'
  | 'CLIP'
  | 'BUY';

/** SPEC 9 step 5, first failure wins. 'BUY' means every check before the swap passed. */
function firstGuardFailure(
  tickerId: TickerId,
  pool: Address,
  equityPart: bigint,
  minClip: bigint,
  ctx: GuardContext,
): GuardStep {
  const ticker = tickerById(tickerId);
  if (ticker === undefined || !isPoolAllowlisted(tickerId, pool)) return 'TICKER';
  if (ctx.accountBlocked) return 'ACCOUNT';
  if (ctx.paused) return 'PAUSED';
  if (ctx.oraclePaused) return 'ORACLE_PAUSED';
  if (!ctx.sessionOpen) return 'SESSION';
  if (ctx.multiplierDue) return 'MULTIPLIER';
  if (ctx.feedStale) return 'STALE';
  if (ctx.usdgDepegged) return 'DEPEG';
  if (equityPart < minClip) return 'CLIP';
  return 'BUY';
}

const STEP_ORDER: Record<GuardStep, number> = {
  TICKER: 1,
  ACCOUNT: 2,
  PAUSED: 3,
  ORACLE_PAUSED: 3,
  SESSION: 4,
  MULTIPLIER: 5,
  STALE: 6,
  DEPEG: 7,
  CLIP: 8,
  BUY: 9,
};

/** Fields the guard had read by the time it stopped. Steps it never reached stay zero on the receipt. */
function readFields(step: GuardStep, ctx: GuardContext): ReceiptOverrides {
  const order = STEP_ORDER[step];
  return {
    ...(order >= STEP_ORDER.MULTIPLIER ? { uiMultiplier: ctx.uiMultiplier } : {}),
    ...(order >= STEP_ORDER.STALE
      ? { roundId: ctx.feed.roundId, answer: ctx.feed.answer, updatedAt: ctx.feed.updatedAt }
      : {}),
    ...(order >= STEP_ORDER.DEPEG ? { usdgRoundId: ctx.usdgUsd.roundId, usdgAnswer: ctx.usdgUsd.answer } : {}),
  };
}

const QUEUE_REASON: Partial<Record<GuardStep, Reason>> = {
  PAUSED: 'PAUSED',
  ORACLE_PAUSED: 'ORACLE_PAUSED',
  SESSION: 'SESSION',
  MULTIPLIER: 'MULTIPLIER',
  STALE: 'STALE',
  DEPEG: 'DEPEG',
  CLIP: 'CLIP',
};

/** What a split would do right now for the rule's ticker, read without a swap (SPEC 15 previewSplit). */
export function previewOutcome(account: MockAccount, equityPart: bigint, ctx: GuardContext): SplitOutcome {
  const ticker = tickerById(account.rule.tickerId);
  const pool = ticker?.pools[0]?.address ?? ZERO_ADDRESS;
  const step = firstGuardFailure(account.rule.tickerId, pool, equityPart, account.rule.minClip, ctx);
  if (step === 'TICKER') return { kind: 'REFUSE', status: 'REFUSED_TICKER' };
  if (step === 'ACCOUNT') return { kind: 'REFUSE', status: 'REFUSED_ACCOUNT' };
  if (step === 'BUY') return { kind: 'BUY' };
  return { kind: 'QUEUE', reason: QUEUE_REASON[step] ?? 'NONE' };
}

function addToBucket(account: MockAccount, tickerId: TickerId, amount: bigint, reason: Reason, at: ChainPoint): void {
  if (amount === 0n) return;
  const existing = account.buckets.get(tickerId);
  account.buckets.set(tickerId, {
    amount: (existing?.amount ?? 0n) + amount,
    since: existing === undefined || existing.amount === 0n ? at.timestamp : existing.since,
    reason,
  });
}

function createLot(world: MockWorld, account: MockAccount, receipt: Receipt): void {
  world.lots.set(receipt.id, {
    id: receipt.id,
    account: account.address,
    tickerId: receipt.tickerId,
    status: receipt.status === 'SETTLED' ? 'SETTLED' : 'FILLED',
    tokensBought: receipt.tokensOut,
    tokensRemaining: receipt.tokensOut,
  });
  account.tokenBalances.set(receipt.tickerId, (account.tokenBalances.get(receipt.tickerId) ?? 0n) + receipt.tokensOut);
}

/** SPEC 8 trigger rules for split. Keeper and owner go first; anyone else waits out the grace period. */
function assertMaySplit(account: MockAccount, trigger: Trigger, at: ChainPoint): void {
  if (trigger !== 'PUBLIC') return;
  const observation = account.observation;
  const message = 'The keeper and the owner go first until the grace period ends';
  if (observation === null) throw new DataLayerError({ code: 'GracePeriodActive', readyAt: null }, message);
  const readyAt = observation.observedAt + MODULE_PARAMS.graceSeconds;
  if (at.timestamp < readyAt || unsortedOf(account) > observation.observedUnsorted) {
    throw new DataLayerError({ code: 'GracePeriodActive', readyAt }, message);
  }
}

/** SPEC 9 split(account, pool, quote). Returns the receipts written, RECONCILED first when there was one. */
export function split(
  world: MockWorld,
  account: MockAccount,
  trigger: Trigger,
  ctx: GuardContext,
  poolOverride?: Address,
): ReceiptRecord[] {
  if (account.rule.status !== 'ACTIVE') {
    throw new DataLayerError({ code: 'RuleNotActive' }, 'The rule is not active, so new USDG stays unsorted');
  }
  assertMaySplit(account, trigger, ctx.at);

  const at = ctx.at;
  const txHash = txHashFor(account, at, 'split');
  const waiting = account.inbox.filter((item) => item.state !== 'SORTED');
  const inbound: InboundRef[] = waiting.map(({ txHash: hash, logIndex, from, amount }) => ({
    txHash: hash,
    logIndex,
    from,
    amount,
  }));
  const written: ReceiptRecord[] = [];

  const reconciliation = reconcile(account);
  if (reconciliation !== null) {
    const receipt = buildReceipt(
      world,
      account,
      at,
      { trigger, status: 'RECONCILED', tickerId: account.rule.tickerId },
      { token: ZERO_ADDRESS, tokenUid: ZERO_HASH },
    );
    written.push(record(world, account, receipt, txHash, [], reconciliation));
  }

  const unsorted = unsortedOf(account);
  if (unsorted > 0n) {
    const rule = account.rule;
    const equityPart = (unsorted * BigInt(rule.equityBps)) / BPS;
    const spendPart = unsorted - equityPart;
    account.spend += spendPart;

    const ticker = tickerById(rule.tickerId);
    const pool = poolOverride ?? ticker?.pools[0]?.address ?? ZERO_ADDRESS;
    const step = firstGuardFailure(rule.tickerId, pool, equityPart, rule.minClip, ctx);
    const base = { trigger, tickerId: rule.tickerId };
    const quote = equityPart > 0n ? buyFill(equityPart, ctx.feed.answer, ctx.venue.buyPremiumBps).quote : 0n;
    const common: ReceiptOverrides = { usdgIn: unsorted, usdgToEquity: equityPart, pool, quote };

    let receipt: Receipt;
    if (step === 'TICKER' || step === 'ACCOUNT') {
      account.spend += equityPart;
      receipt = buildReceipt(
        world,
        account,
        at,
        { ...base, status: step === 'TICKER' ? 'REFUSED_TICKER' : 'REFUSED_ACCOUNT' },
        { ...common, usdgToSpend: unsorted },
      );
    } else if (step !== 'BUY') {
      const reason = QUEUE_REASON[step] ?? 'NONE';
      addToBucket(account, rule.tickerId, equityPart, reason, at);
      const read = readFields(step, ctx);
      rememberRounds(world, ctx, read);
      receipt = buildReceipt(
        world,
        account,
        at,
        { ...base, status: 'QUEUED' },
        { ...common, ...read, reason, usdgToSpend: spendPart, usdgQueued: equityPart },
      );
    } else {
      const fill = buyFill(equityPart, ctx.feed.answer, ctx.venue.buyPremiumBps);
      const minOut = minOutForBuy(equityPart, fill.quote, rule.slippageBps);
      const read = readFields('BUY', ctx);
      rememberRounds(world, ctx, read);
      if (exceedsPremium(equityPart, fill.tokensOut, ctx.feed.answer, rule.premiumCapBps)) {
        addToBucket(account, rule.tickerId, equityPart, 'PREMIUM', at);
        receipt = buildReceipt(
          world,
          account,
          at,
          { ...base, status: 'QUEUED' },
          { ...common, ...read, reason: 'PREMIUM', usdgToSpend: spendPart, usdgQueued: equityPart, minOut },
        );
      } else {
        account.usdgBalance -= equityPart;
        receipt = buildReceipt(
          world,
          account,
          at,
          { ...base, status: 'FILLED' },
          {
            ...common,
            ...read,
            usdgToSpend: spendPart,
            usdgSpent: equityPart,
            tokensOut: fill.tokensOut,
            execPrice: fill.execPrice,
            premiumBps: fill.premiumBps,
            minOut,
            venueId: MODULE_PARAMS.venueUniswapV3,
          },
        );
        receipt.lotId = receipt.id;
        createLot(world, account, receipt);
        logTransfers(world, txHash, [
          { token: ADDRESSES.USDG, from: account.address, to: pool, amount: equityPart },
          { token: receipt.token, from: pool, to: account.address, amount: fill.tokensOut },
        ]);
      }
    }
    written.push(record(world, account, receipt, txHash, inbound));
  } else if (written[0] !== undefined) {
    written[0].derived.inbound = inbound;
  }

  const primary = written[written.length - 1]?.receipt;
  for (const item of waiting) {
    item.state = 'SORTED';
    item.graceEndsAt = null;
    item.sortedBy =
      primary === undefined ? null : { receiptId: primary.id, lotId: primary.status === 'FILLED' ? primary.id : null };
  }
  if (trigger !== 'PUBLIC') account.observation = null;
  return written;
}

/** SPEC 10 settle(account, tickerId, pool, quote): buys a whole bucket once the guard clears. */
export function settle(
  world: MockWorld,
  account: MockAccount,
  tickerId: TickerId,
  trigger: Trigger,
  ctx: GuardContext,
): ReceiptRecord {
  const bucket = account.buckets.get(tickerId);
  if (bucket === undefined || bucket.amount === 0n) {
    throw new DataLayerError({ code: 'NothingWaiting' }, 'Nothing is waiting for this ticker');
  }
  if (bucket.amount < account.rule.minClip) {
    throw new DataLayerError(
      { code: 'BelowClip', minClip: account.rule.minClip },
      'The waiting amount is below the minimum clip',
    );
  }
  const ticker = tickerById(tickerId);
  const pool = ticker?.pools[0]?.address ?? ZERO_ADDRESS;
  const txHash = txHashFor(account, ctx.at, 'settle');
  const step = firstGuardFailure(tickerId, pool, bucket.amount, account.rule.minClip, ctx);
  if (step === 'TICKER' || step === 'ACCOUNT') {
    account.buckets.delete(tickerId);
    account.spend += bucket.amount;
    const refused = buildReceipt(
      world,
      account,
      ctx.at,
      { trigger, status: step === 'TICKER' ? 'REFUSED_TICKER' : 'REFUSED_ACCOUNT', tickerId },
      {
        usdgIn: bucket.amount,
        usdgToSpend: bucket.amount,
        usdgToEquity: bucket.amount,
        pool,
        queuedSince: bucket.since,
      },
    );
    return record(world, account, refused, txHash, []);
  }
  if (step !== 'BUY') {
    const reason = QUEUE_REASON[step] ?? 'NONE';
    throw new DataLayerError({ code: 'GuardNotClear', reason }, 'The guard has not cleared, so the USDG keeps waiting');
  }
  const fill = buyFill(bucket.amount, ctx.feed.answer, ctx.venue.buyPremiumBps);
  if (exceedsPremium(bucket.amount, fill.tokensOut, ctx.feed.answer, account.rule.premiumCapBps)) {
    throw new DataLayerError({ code: 'GuardNotClear', reason: 'PREMIUM' }, 'The price is above the premium cap');
  }
  account.buckets.delete(tickerId);
  account.usdgBalance -= bucket.amount;
  const read = readFields('BUY', ctx);
  rememberRounds(world, ctx, read);
  const receipt = buildReceipt(
    world,
    account,
    ctx.at,
    { trigger, status: 'SETTLED', tickerId },
    {
      ...read,
      usdgIn: bucket.amount,
      usdgToEquity: bucket.amount,
      usdgSpent: bucket.amount,
      tokensOut: fill.tokensOut,
      execPrice: fill.execPrice,
      premiumBps: fill.premiumBps,
      quote: fill.quote,
      minOut: minOutForBuy(bucket.amount, fill.quote, account.rule.slippageBps),
      venueId: MODULE_PARAMS.venueUniswapV3,
      pool,
      queuedSince: bucket.since,
    },
  );
  receipt.lotId = receipt.id;
  createLot(world, account, receipt);
  logTransfers(world, txHash, [
    { token: ADDRESSES.USDG, from: account.address, to: pool, amount: bucket.amount },
    { token: receipt.token, from: pool, to: account.address, amount: fill.tokensOut },
  ]);
  if (trigger !== 'PUBLIC') account.observation = null;
  return record(world, account, receipt, txHash, []);
}

/** SPEC 10 release(tickerId): the whole bucket to spend, no guard (I11). */
export function release(world: MockWorld, account: MockAccount, tickerId: TickerId, at: ChainPoint): ReceiptRecord {
  const bucket = account.buckets.get(tickerId);
  if (bucket === undefined || bucket.amount === 0n) {
    throw new DataLayerError({ code: 'NothingWaiting' }, 'Nothing is waiting for this ticker');
  }
  account.buckets.delete(tickerId);
  account.spend += bucket.amount;
  const receipt = buildReceipt(
    world,
    account,
    at,
    { trigger: 'OWNER', status: 'RELEASED', tickerId },
    { reason: bucket.reason, usdgIn: bucket.amount, usdgToSpend: bucket.amount, queuedSince: bucket.since },
  );
  return record(world, account, receipt, txHashFor(account, at, 'release'), []);
}

interface SellPlan {
  lots: { lot: Lot; tokens: bigint }[];
  available: bigint;
  capBps: number;
  pool: Address;
  quote: bigint;
  usdgOut: bigint;
  minOut: bigint;
  discountBps: bigint;
  waits: SellQuote['waits'];
  blocked: SellBlock | null;
}

function openLots(world: MockWorld, account: MockAccount, tickerId: TickerId): Lot[] {
  return [...world.lots.values()]
    .filter((lot) => lot.account === account.address && lot.tickerId === tickerId && lot.tokensRemaining > 0n)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

function firstBlockingReason(ctx: GuardContext): Reason | null {
  if (ctx.paused) return 'PAUSED';
  if (ctx.oraclePaused) return 'ORACLE_PAUSED';
  if (ctx.multiplierDue) return 'MULTIPLIER';
  if (ctx.usdgDepegged) return 'DEPEG';
  return null;
}

function planSell(world: MockWorld, account: MockAccount, request: SellRequest, ctx: GuardContext): SellPlan {
  const ticker = tickerById(request.tickerId);
  const pool = ticker?.pools[0]?.address ?? ZERO_ADDRESS;
  const capBps = request.overrideCapBps > 0 ? request.overrideCapBps : account.rule.premiumCapBps;
  const candidates =
    request.lotId === 0n
      ? openLots(world, account, request.tickerId)
      : openLots(world, account, request.tickerId).filter((lot) => lot.id === request.lotId);
  const available = candidates.reduce((sum, lot) => sum + lot.tokensRemaining, 0n);

  const lots: SellPlan['lots'] = [];
  let remaining = request.amount;
  for (const lot of candidates) {
    if (remaining === 0n) break;
    const tokens = minBig(remaining, lot.tokensRemaining);
    lots.push({ lot, tokens });
    remaining -= tokens;
  }

  const priced = request.amount > 0n && ctx.feed.answer > 0n;
  const usdgOut = priced ? sellProceeds(request.amount, ctx.feed.answer, ctx.venue.sellDiscountBps) : 0n;
  const quote = priced ? (usdgOut * PRICE_UNIT) / request.amount : 0n;
  const minOut = priced ? minOutForSell(request.amount, quote, account.rule.slippageBps) : 0n;
  const discount = priced ? discountBps(usdgOut, request.amount, ctx.feed.answer) : 0n;

  let blocked: SellBlock | null = null;
  const blockingReason = firstBlockingReason(ctx);
  const overrideCapValid =
    Number.isInteger(request.overrideCapBps) &&
    request.overrideCapBps >= 0 &&
    request.overrideCapBps <= RULE_LIMITS.sellOverrideCapBpsMax;
  if (!overrideCapValid) {
    blocked = { code: 'OverrideCapOutOfRange', maxBps: RULE_LIMITS.sellOverrideCapBpsMax };
  } else if (request.amount <= 0n || remaining > 0n) {
    blocked = { code: 'ExceedsLots', available };
  } else if (ctx.accountBlocked) {
    blocked = { code: 'AccountBlocked' };
  } else if (blockingReason !== null) {
    blocked = { code: 'GuardNotClear', reason: blockingReason };
  } else if (priced && exceedsDiscount(usdgOut, request.amount, ctx.feed.answer, capBps)) {
    blocked = { code: 'DiscountAboveCap', discountBps: discount, capBps };
  }

  let waits: SellQuote['waits'] = null;
  if (!request.overrideClosed) {
    if (!ctx.sessionOpen) waits = { reason: 'SESSION', reopensAt: ctx.reopensAt };
    else if (ctx.feedStale) waits = { reason: 'STALE', reopensAt: null };
  }

  return { lots, available, capBps, pool, quote, usdgOut, minOut, discountBps: discount, waits, blocked };
}

export function quoteSell(world: MockWorld, account: MockAccount, request: SellRequest, ctx: GuardContext): SellQuote {
  const plan = planSell(world, account, request, ctx);
  return {
    request,
    pool: plan.pool,
    quote: plan.quote,
    expectedUsdgOut: plan.usdgOut,
    minOut: plan.minOut,
    discountBps: plan.discountBps,
    capBps: plan.capBps,
    feed: ctx.feed,
    lots: plan.lots.map(({ lot, tokens }) => ({ lotId: lot.id, tokens })),
    waits: plan.waits,
    blocked: plan.blocked,
  };
}

/**
 * SPEC 12 sell(): proceeds to spend, one PART_SOLD or SOLD receipt per lot with its pro rata share. The receipt's
 * premiumBps holds the signed premium over the feed, so a sale below the feed reads negative (minus discountBps).
 */
export function sell(world: MockWorld, account: MockAccount, request: SellRequest, ctx: GuardContext): ReceiptRecord[] {
  const plan = planSell(world, account, request, ctx);
  if (plan.blocked !== null) {
    const block = plan.blocked;
    if (block.code === 'GuardNotClear') {
      throw new DataLayerError({ code: 'GuardNotClear', reason: block.reason }, 'A guard check failed for this sell');
    }
    throw new DataLayerError({ code: block.code }, `The sell cannot run: ${block.code}`);
  }
  if (plan.waits !== null) {
    throw new DataLayerError(
      { code: 'SellWaits', reason: plan.waits.reason, reopensAt: plan.waits.reopensAt },
      'The market reference is not live, so the sell waits',
    );
  }

  const txHash = txHashFor(account, ctx.at, 'sell');
  const execPrice = execPriceSell(plan.usdgOut, request.amount);
  const read = readFields('BUY', ctx);
  rememberRounds(world, ctx, read);
  const written: ReceiptRecord[] = [];
  let paidOut = 0n;
  plan.lots.forEach(({ lot, tokens }, index) => {
    const isLast = index === plan.lots.length - 1;
    const share = isLast ? plan.usdgOut - paidOut : (plan.usdgOut * tokens) / request.amount;
    paidOut += share;
    lot.tokensRemaining -= tokens;
    lot.status = lot.tokensRemaining === 0n ? 'SOLD' : 'PART_SOLD';
    const receipt = buildReceipt(
      world,
      account,
      ctx.at,
      { trigger: 'OWNER', status: lot.status, tickerId: request.tickerId },
      {
        ...read,
        usdgToSpend: share,
        tokensIn: tokens,
        usdgOut: share,
        execPrice,
        premiumBps: -plan.discountBps,
        quote: plan.quote,
        minOut: plan.minOut,
        venueId: MODULE_PARAMS.venueUniswapV3,
        pool: plan.pool,
        lotId: lot.id,
        overrideClosed: request.overrideClosed,
        overrideCapBps: request.overrideCapBps,
      },
    );
    written.push(record(world, account, receipt, txHash, []));
  });
  const token = tickerById(request.tickerId)?.token ?? ZERO_ADDRESS;
  logTransfers(world, txHash, [
    { token, from: account.address, to: plan.pool, amount: request.amount },
    { token: ADDRESSES.USDG, from: plan.pool, to: account.address, amount: plan.usdgOut },
  ]);

  account.tokenBalances.set(request.tickerId, (account.tokenBalances.get(request.tickerId) ?? 0n) - request.amount);
  account.usdgBalance += plan.usdgOut;
  account.spend += plan.usdgOut;
  return written;
}

/** SPEC 6 setRule: validate, then version + 1 and ACTIVE. */
export function setRule(account: MockAccount, input: RuleInput): Rule {
  const issues = validateRuleInput(
    input,
    LAUNCH_TICKERS.map((ticker) => ticker.id),
  );
  if (issues.length > 0) {
    throw new DataLayerError({ code: 'InvalidRule', issues }, `The rule was refused: ${issues.join(', ')}`);
  }
  const rule: Rule = {
    version: account.rule.version + 1,
    status: 'ACTIVE',
    equityBps: input.equityBps,
    tickerId: input.tickerId,
    premiumCapBps: input.premiumCapBps,
    slippageBps: input.slippageBps,
    minClip: input.minClip,
  };
  account.rule = rule;
  account.ruleHistory.push(rule);
  return rule;
}

export function pauseRule(account: MockAccount): Rule {
  if (account.rule.status !== 'ACTIVE') {
    throw new DataLayerError({ code: 'RuleNotActive' }, 'Only an active rule can be paused');
  }
  account.rule = { ...account.rule, status: 'PAUSED' };
  return account.rule;
}

export function resumeRule(account: MockAccount): Rule {
  if (account.rule.status !== 'PAUSED') {
    throw new DataLayerError({ code: 'RuleNotPaused' }, 'Only a paused rule can be resumed');
  }
  account.rule = { ...account.rule, status: 'ACTIVE' };
  return account.rule;
}

/** What ruleOf returns before any setRule: status NONE and zero fields. */
export function unsetRule(): Rule {
  return { version: 0, status: 'NONE', equityBps: 0, tickerId: 0, premiumCapBps: 0, slippageBps: 0, minClip: 0n };
}

/** onInstall with a fresh snapshot (SPEC 6): spend equals the balance, buckets empty. */
export function installAccount(
  world: MockWorld,
  input: {
    address: Address;
    credentialId: string;
    at: ChainPoint;
    rule: RuleInput | null;
    recoverySigner: Address | null;
    usdgBalance?: bigint;
  },
): MockAccount {
  const account: MockAccount = {
    address: input.address,
    credentialId: input.credentialId,
    deployed: true,
    installedAt: input.at.timestamp,
    keeper: world.defaultKeeper,
    recoverySigner: input.recoverySigner,
    usdgBalance: input.usdgBalance ?? 0n,
    spend: input.usdgBalance ?? 0n,
    buckets: new Map(),
    rule: unsetRule(),
    ruleHistory: [],
    observation: null,
    tokenBalances: new Map(),
    inbox: [],
  };
  if (input.rule !== null) setRule(account, input.rule);
  world.accounts.set(account.address, account);
  return account;
}

/** A new owner from onboarding: a fresh address, nothing in it yet. */
export function createAccount(world: MockWorld, rule: RuleInput | null, recoverySigner: Address | null): MockAccount {
  world.createdAccounts += 1;
  const label = `created:${world.createdAccounts}`;
  return installAccount(world, {
    address: pseudoAddress(`account:${label}`),
    credentialId: pseudoHash(`credential:${label}`).slice(2, 45),
    at: advanceClock(world, 30n),
    rule,
    recoverySigner,
  });
}
