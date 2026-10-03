/**
 * Types that mirror docs/SPEC.md (draft 2) field for field.
 *
 * Integer widths follow how viem decodes the ABI, so decoded events and view results drop straight in:
 * uint8 to uint48 become `number`, anything wider becomes `bigint`. Enum fields carry the member name.
 * Each enum tuple lists its members in the contract's order, so a member's index is the uint8 a receipt
 * carries: contracts/src/types/SleeveTypes.sol for Status, Reason, Trigger and AccountingMode, and
 * contracts/src/libraries/SessionCalendar.sol for SessionType and the calendar Reason.
 */

export type Address = `0x${string}`;
export type Hex = `0x${string}`;

/** uint8 index into the TokenSource ticker list. Launch tickers are 0 to 3. */
export type TickerId = number;

/**
 * The member a decoded uint8 names in one of the enum tuples below. Throws on an index the contract cannot
 * produce, so a decoding mismatch is never shown as some other status.
 */
export function enumMember<const T extends readonly string[]>(members: T, index: number | bigint): T[number] {
  const position = typeof index === 'bigint' ? Number(index) : index;
  const member = Number.isInteger(position) ? members[position] : undefined;
  if (member === undefined) {
    throw new RangeError(`${String(index)} is not a member index of [${members.join(', ')}]`);
  }
  return member;
}

/** SPEC 13. */
export const STATUSES = [
  'FILLED',
  'QUEUED',
  'SETTLED',
  'REFUSED_TICKER',
  'REFUSED_ACCOUNT',
  'RELEASED',
  'PART_SOLD',
  'SOLD',
  'RECONCILED',
] as const;
export type Status = (typeof STATUSES)[number];

/** SPEC 13. Why an equity share waits; QUEUED receipts and buckets carry one, a fill carries NONE. */
export const REASONS = [
  'NONE',
  'PAUSED',
  'ORACLE_PAUSED',
  'SESSION',
  'MULTIPLIER',
  'STALE',
  'DEPEG',
  'CLIP',
  'PREMIUM',
] as const;
export type Reason = (typeof REASONS)[number];

/**
 * SPEC 8 and PRD 10. PAYLINK holds its slot in the contract enum, but the pay link is M1, so no M0 receipt
 * carries it and no screen may present it as live.
 */
export const TRIGGERS = ['KEEPER', 'OWNER', 'PAYLINK', 'PUBLIC'] as const;
export type Trigger = (typeof TRIGGERS)[number];

/** SPEC 13. Every M0 receipt is WRAPPED (PRD 7.2). */
export const ACCOUNTING_MODES = ['WRAPPED'] as const;
export type AccountingMode = (typeof ACCOUNTING_MODES)[number];

/** SPEC 5. */
export const RULE_STATUSES = ['NONE', 'ACTIVE', 'PAUSED'] as const;
export type RuleStatus = (typeof RULE_STATUSES)[number];

/** SPEC 14. A lot exists only for a buy and moves FILLED or SETTLED, then PART_SOLD, then SOLD. */
export const LOT_STATUSES = ['FILLED', 'SETTLED', 'PART_SOLD', 'SOLD'] as const;
export type LotStatus = (typeof LOT_STATUSES)[number];

/** SessionCalendar.SessionType in contracts/src/libraries/SessionCalendar.sol. The contract fixes this numbering. */
export const SESSION_TYPES = ['NONE', 'ALL_DAY', 'REGULAR'] as const;
export type SessionType = (typeof SESSION_TYPES)[number];

/** SessionCalendar.Reason. The contract fixes this numbering because the keeper, the app and the verifier read it. */
export const SESSION_REASONS = [
  'NO_SESSION',
  'OPEN',
  'WEEKEND',
  'HOLIDAY',
  'EARLY_CLOSE',
  'OUTSIDE_HOURS',
  'OUT_OF_RANGE',
] as const;
export type SessionReason = (typeof SESSION_REASONS)[number];

/** SPEC 5, `Rule`. One leg in M0. */
export interface Rule {
  /** uint32 */
  version: number;
  /** RuleStatus */
  status: RuleStatus;
  /** uint16 */
  equityBps: number;
  /** uint8 */
  tickerId: TickerId;
  /** uint16, default 100, owner range 0 to 500 (B2-5) */
  premiumCapBps: number;
  /** uint16, default 50, owner range 0 to 500 */
  slippageBps: number;
  /** uint128, USDG base units, default 25e6, at least 1e6 */
  minClip: bigint;
}

/** SPEC 6, the argument of `setRule`. spendBps plus equityBps must equal 10,000 (I9). */
export interface RuleInput {
  /** uint16 */
  spendBps: number;
  /** uint16 */
  equityBps: number;
  /** uint8 */
  tickerId: TickerId;
  /** uint16 */
  premiumCapBps: number;
  /** uint16 */
  slippageBps: number;
  /** uint128 */
  minClip: bigint;
}

/** SPEC 5, `Account`. Named AccountState to keep it apart from the smart account itself. */
export interface AccountState {
  installed: boolean;
  /** uint128, spend ledger */
  spend: bigint;
  /** uint128, sum of buckets */
  pendingTotal: bigint;
  /** address, per account, set at install, owner can change (B2-7) */
  keeper: Address;
  /** uint64, public-trigger clock (D-009 Q15) */
  observedAt: bigint;
  /** uint128 */
  observedUnsorted: bigint;
  rule: Rule;
}

/** SPEC 5, `Bucket[account][tickerId]`: pending equity waiting for the guard to clear. */
export interface Bucket {
  /** uint128, USDG base units */
  amount: bigint;
  /** uint64, unix seconds of the first queue into an empty bucket */
  since: bigint;
  /** uint8 Reason of the latest queue */
  reason: Reason;
}

/** SPEC 15, `ledger(account)`. unsorted = balance - spend - pendingTotal, floored at zero (LedgerMath.unsorted). */
export interface Ledger {
  balance: bigint;
  spend: bigint;
  pendingTotal: bigint;
  unsorted: bigint;
}

/**
 * SPEC 14. The lot id equals the FILLED or SETTLED receipt id. SPEC fixes the stored fields, not their widths;
 * amounts are 18-decimal Stock Token base units.
 */
export interface Lot {
  id: bigint;
  account: Address;
  tickerId: TickerId;
  status: LotStatus;
  tokensBought: bigint;
  tokensRemaining: bigint;
}

/** SPEC 3, `ticker(id)` on TokenSource. */
export interface TokenSourceTicker {
  token: Address;
  feed: Address;
  sessionType: SessionType;
  active: boolean;
}

/** The parts of a Chainlink `latestRoundData()` or `getRoundData()` answer that the guard and receipts use. */
export interface FeedRound {
  /** uint80 */
  roundId: bigint;
  /** int256, 8 decimals */
  answer: bigint;
  /** uint256, unix seconds */
  updatedAt: bigint;
}

/** SPEC 13, `Receipt`, in SPEC field order. Written in the same transaction as the action. */
export interface Receipt {
  id: bigint;
  account: Address;
  ruleVersion: number;
  trigger: Trigger;
  /** Zero in M0 (D-009 Q26). */
  payer: Address;
  status: Status;
  reason: Reason;
  mode: AccountingMode;
  tickerId: TickerId;
  token: Address;
  tokenUid: Hex;
  usdgIn: bigint;
  usdgToSpend: bigint;
  usdgToEquity: bigint;
  usdgSpent: bigint;
  usdgQueued: bigint;
  /** Sells only. */
  tokensIn: bigint;
  tokensOut: bigint;
  /** Sells only. */
  usdgOut: bigint;
  /** 18 decimals, read at fill. */
  uiMultiplier: bigint;
  /** USDG base units per 1e18 Stock Token base units. */
  execPrice: bigint;
  /** Signed basis points, rounded against the owner. */
  premiumBps: bigint;
  roundId: bigint;
  answer: bigint;
  updatedAt: bigint;
  usdgRoundId: bigint;
  usdgAnswer: bigint;
  /** Buys: raw token units per 1e6 USDG base units. Sells: USDG base units per 1e18 token units (D-009 Q21). */
  quote: bigint;
  minOut: bigint;
  /** 1 is Uniswap v3 through SwapRouter02. */
  venueId: number;
  pool: Address;
  calendarVersion: number;
  disclosureHash: Hex;
  /** ArbSys(0x64).arbBlockNumber(), not block.number. */
  l2Block: bigint;
  timestamp: bigint;
  lotId: bigint;
  queuedSince: bigint;
  overrideClosed: boolean;
  overrideCapBps: number;
}

/** The Solidity type of every Receipt field, in SPEC 13 order. Enum types ABI-encode as uint8. */
export const RECEIPT_FIELDS = {
  id: 'uint256',
  account: 'address',
  ruleVersion: 'uint32',
  trigger: 'Trigger',
  payer: 'address',
  status: 'Status',
  reason: 'Reason',
  mode: 'AccountingMode',
  tickerId: 'uint8',
  token: 'address',
  tokenUid: 'bytes32',
  usdgIn: 'uint256',
  usdgToSpend: 'uint256',
  usdgToEquity: 'uint256',
  usdgSpent: 'uint256',
  usdgQueued: 'uint256',
  tokensIn: 'uint256',
  tokensOut: 'uint256',
  usdgOut: 'uint256',
  uiMultiplier: 'uint256',
  execPrice: 'uint256',
  premiumBps: 'int256',
  roundId: 'uint80',
  answer: 'int256',
  updatedAt: 'uint256',
  usdgRoundId: 'uint80',
  usdgAnswer: 'int256',
  quote: 'uint256',
  minOut: 'uint256',
  venueId: 'uint8',
  pool: 'address',
  calendarVersion: 'uint32',
  disclosureHash: 'bytes32',
  l2Block: 'uint256',
  timestamp: 'uint256',
  lotId: 'uint256',
  queuedSince: 'uint64',
  overrideClosed: 'bool',
  overrideCapBps: 'uint16',
} as const satisfies { readonly [K in keyof Receipt]: ReceiptFieldType };

export type ReceiptFieldType = keyof SolidityToTs;

interface SolidityToTs {
  uint8: number;
  uint16: number;
  uint32: number;
  uint64: bigint;
  uint80: bigint;
  uint256: bigint;
  int256: bigint;
  address: Address;
  bytes32: Hex;
  bool: boolean;
  Trigger: Trigger;
  Status: Status;
  Reason: Reason;
  AccountingMode: AccountingMode;
}

type ReceiptFromFields = { -readonly [K in keyof typeof RECEIPT_FIELDS]: SolidityToTs[(typeof RECEIPT_FIELDS)[K]] };
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
// Compile-time guard: the interface and the Solidity type table must agree field for field.
export type ReceiptMatchesFields = Assert<Same<Receipt, ReceiptFromFields>>;
