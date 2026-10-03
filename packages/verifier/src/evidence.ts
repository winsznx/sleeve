import type { Address, Hex, RuleStatus, SessionReason, SessionType, Status } from '@sleeve/core';

/**
 * Everything the verifier read from the chain for one receipt. gather.ts fills it through an RPC; check.ts turns it
 * into rows without touching the network, so every decision the verifier makes can be tested on a fixture.
 *
 * Reads of contract state are at the latest block. The public RPC keeps no old state (D-008), so nothing here comes
 * from a historical eth_call: the state at the receipt is rebuilt from the latest state and the events after the
 * receipt (history.ts).
 */

/** A log as eth_getLogs or a transaction receipt returns it. */
export interface RawLog {
  address: Address;
  topics: readonly Hex[];
  data: Hex;
  blockNumber: bigint;
  logIndex: number;
  transactionHash: Hex;
}

/** Where a log sits on the chain. Logs compare by block, then by index in the block. */
export interface LogPosition {
  blockNumber: bigint;
  logIndex: number;
}

/** A contract read that may have failed, with the failure in words. */
export type Reading<T> = { ok: true; value: T } | { ok: false; error: string };

/** getRoundData(roundId) on a feed proxy, read at the latest block. */
export interface RoundData {
  roundId: bigint;
  answer: bigint;
  startedAt: bigint;
  updatedAt: bigint;
}

/** The Rule a RuleSet event logged for (account, version). Rule versions only go up per account (D-019). */
export interface RuleRecord {
  version: number;
  status: RuleStatus;
  equityBps: number;
  tickerId: number;
  premiumCapBps: number;
  slippageBps: number;
  minClip: bigint;
}

/** TokenSource.ticker(id) at the latest block. Token, feed and session type never change for an id. */
export interface TickerReading {
  token: Address;
  feed: Address;
  sessionType: SessionType;
  active: boolean;
}

/**
 * SleeveModule.lot(id) at the latest block. tokensBought never changes; the status, a receipt Status, only moves
 * forward (I7). NONE when no lot has the id.
 */
export interface LotReading {
  account: Address;
  tickerId: number;
  status: Status | 'NONE';
  tokensBought: bigint;
  tokensRemaining: bigint;
}

/** One UIMultiplierUpdated log of the receipt's Stock Token. */
export interface MultiplierUpdate {
  oldMultiplier: bigint;
  newMultiplier: bigint;
  effectiveAt: bigint;
  position: LogPosition;
  transactionHash: Hex;
}

/**
 * The token's multiplier state: the three views now, every update after the receipt, and, when the state at the
 * receipt cannot follow from those, the last update before it (null when there was none since block 0).
 */
export interface MultiplierHistory {
  uiMultiplier: bigint;
  newUIMultiplier: bigint;
  effectiveAt: bigint;
  after: readonly MultiplierUpdate[];
  lastBefore: MultiplierUpdate | null | 'NOT_READ';
}

/** One switch of a pause flag: set true by Paused or OraclePaused, false by Unpaused or OracleUnpaused. */
export interface FlagChange {
  set: boolean;
  position: LogPosition;
  transactionHash: Hex;
}

/** A pause flag now and every switch of it after the receipt. */
export interface FlagHistory {
  now: boolean;
  after: readonly FlagChange[];
}

/** The Stock Token's guard state around the receipt. */
export interface TokenHistory {
  registry: Address;
  multiplier: MultiplierHistory;
  /** The token's own pause flag. */
  tokenPaused: FlagHistory;
  /** The access registry's global pause, which token.paused() includes. */
  registryPaused: FlagHistory;
  oraclePaused: FlagHistory;
}

/** The calendar extension now, and how many timelocked writes landed after the receipt. */
export interface CalendarReading {
  versionNow: number;
  writeCountNow: number;
  /** Writes after the receipt, counted from the extension's events. Zero without reading when writeCountNow is zero. */
  writesAfter: number;
  /** sessionState(block time of the receipt, ticker session type) on the deployed extension, when it has a ticker. */
  session: Reading<{ open: boolean; reason: SessionReason; openedAt: bigint }> | null;
}

/** USDG, Stock Token and feed decimals() read at the latest block. */
export interface DecimalsReading {
  usdg: Reading<number>;
  token: Reading<number> | null;
  feed: Reading<number> | null;
  usdgFeed: Reading<number>;
}

/** The guard parameters the module holds as immutables. */
export interface GuardParamsReading {
  stockFeedMaxAge: bigint;
  usdgFeedMaxAge: bigint;
  depegToleranceBps: number;
  multiplierWindow: bigint;
}

/** The account's own logs before the receipt, for the derived list of inbound transfers a split sorted. */
export interface AccountLogs {
  /** The scan started here, so nothing earlier is known. */
  fromBlock: bigint;
  installs: readonly RawLog[];
  /** The account's ReceiptWritten logs up to the receipt's block. */
  receipts: readonly RawLog[];
  /** OwnerOpEnded logs: their transactions held the account's own bracketed owner ops. */
  ownerOps: readonly RawLog[];
  /** USDG Transfer logs into the account. */
  inbound: readonly RawLog[];
}

export interface Evidence {
  /** The id asked for. */
  id: bigint;
  rpcUrl: string;
  chainId: number;
  module: Address;
  latestBlock: bigint;
  latestTimestamp: bigint;
  /** The first block the module scans covered. */
  fromBlock: bigint;

  receiptLog: RawLog;
  /** Other ReceiptWritten logs with the same id. A module writes each id once, so this should be empty. */
  duplicateLogs: readonly RawLog[];
  storedHash: Hex;
  block: { number: bigint; timestamp: bigint };
  transaction: { hash: Hex; from: Address; to: Address | null; logs: readonly RawLog[] };

  disclosureHash: Hex;
  guardParams: GuardParamsReading;
  calendar: CalendarReading;
  decimals: DecimalsReading;
  /** TokenSource.ticker(tickerId) for receipts that name a ticker, null for a ledger reconcile. */
  ticker: Reading<TickerReading> | null;
  /** Whether TokenSource removed the ticker after the receipt. Read only when the ticker is inactive now. */
  tickerRemovedAfter: boolean | null;
  tokenUid: Reading<Hex> | null;
  stockRound: Reading<RoundData> | null;
  usdgRound: Reading<RoundData> | null;
  /** The rule for (account, ruleVersion): null when the receipt's kind needs none or the version is 0. */
  rule: RuleRecord | 'NOT_FOUND' | null;
  lot: Reading<LotReading> | null;
  /**
   * The receipt's pool: its token0, whether TokenSource allowlists it now, and the `allowed` flag of the first
   * PoolSet log for it after the receipt (null when none). setPool reverts on a no-op, so that flag flipped it.
   */
  pool: { token0: Reading<Address>; allowedNow: Reading<boolean>; firstChangeAfter: boolean | null } | null;
  history: TokenHistory | null;
  account: AccountLogs | null;
}
