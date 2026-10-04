import type {
  AccountingMode,
  Address,
  Bucket,
  FeedRound,
  Hex,
  Ledger,
  Lot,
  Reason,
  Receipt,
  Rule,
  RuleInput,
  RuleStatus,
  SessionReason,
  Status,
  TickerId,
} from '@sleeve/core';

import type { DataLayerErrorDetail } from './errors';

/**
 * The one surface every screen reads and writes through. Field names and widths follow @sleeve/core, which
 * mirrors docs/SPEC.md: amounts and timestamps are bigint (USDG 6 decimals, Stock Tokens 18, feeds 8, unix
 * seconds), basis points and small enums are number or string. The mock implements it now; the Robinhood Chain
 * implementation replaces the mock later without screen changes.
 *
 * Reads that concern an account take its address. Writes act for the signed-in owner, because only the
 * owner's passkey can sign them, and every owner write is one bracketed UserOp (I14), except the two an account
 * without the module needs, a send and turning Sleeve back on, which beginOwnerOp would refuse (D-040). Every method
 * rejects with a DataLayerError (./errors) on a named failure.
 */
export interface SleeveDataLayer {
  readonly source: DataSource;

  /** The signed-in owner, or null. */
  getSession(): Promise<Session | null>;
  /**
   * The WebAuthn registration for Sleeve's site: the passkey that will own a new account (D-003). Nothing goes
   * onchain and no account exists yet. Rejects PasskeyCancelled when the person closes the prompt, and
   * PasskeyUnavailable when this browser or this site cannot make one.
   */
  createPasskey(): Promise<PasskeyCredential>;
  /**
   * A Kernel account owned by a passkey or a wallet (D-022), deployed with the module installed in its first UserOp
   * (D-019), signed once by the owner. Resolves only after reading back that the account is deployed and the module
   * is installed, because the payment address is shown only then. Without a signer it makes a passkey first.
   */
  createAccount(input: CreateAccountInput): Promise<Session>;
  /** Passkey assertion for an existing account. */
  signIn(): Promise<Session>;
  signOut(): Promise<void>;

  getAccount(account: Address): Promise<AccountOverview>;
  /** Chain clock, sessions, feeds and pool prices. Pool and feed prices stay separate (PRD 7.11). */
  getMarket(): Promise<MarketSnapshot>;
  getLedger(account: Address): Promise<LedgerView>;
  getRule(account: Address): Promise<Rule>;
  /** Non-empty buckets, ascending ticker id. */
  getBuckets(account: Address): Promise<BucketView[]>;
  /** What a split would do now, read without a swap (SPEC 15 previewSplit). */
  previewSplit(account: Address): Promise<SplitPreview>;
  /** Tickers the account holds, ascending ticker id, with open lots oldest first. */
  getHoldings(account: Address): Promise<Holding[]>;
  /** Inbound USDG transfers, newest first. Built from logs, so every item is derived (PRD 10). */
  getInbox(account: Address): Promise<InboxItem[]>;
  /** Receipts newest first. */
  listReceipts(query: ReceiptQuery): Promise<ReceiptPage>;
  /** Any receipt by id. Receipts are public. */
  getReceipt(id: bigint): Promise<ReceiptRecord | null>;
  /**
   * A shared card by its opaque id. The id never encodes the receipt id or the address, because either one
   * reveals the account onchain; only what the owner chose to show comes back (PRD 7.10). Null when unknown.
   */
  getCard(cardId: string): Promise<CardData | null>;
  /** Recomputes a receipt from public chain data on the verifier's RPC (PRD 10). */
  verifyReceipt(id: bigint): Promise<VerifyResult>;
  /** Residency attestation plus the request's IP country (PRD 7.12). Blocks onboarding only (D-014). */
  checkEligibility(input: EligibilityInput): Promise<EligibilityResult>;

  /** setRule (SPEC 6): validates, writes version + 1 and ACTIVE. */
  setRule(input: RuleInput): Promise<Rule>;
  /** New USDG stays unsorted and spendable while paused (B2-6). */
  pauseRule(): Promise<Rule>;
  resumeRule(): Promise<Rule>;
  /**
   * Owner-triggered split of unsorted USDG, the owner's path when the keeper is down (PRD 9). Resolves to the
   * receipts written, RECONCILED first when there was one; empty when nothing was unsorted.
   */
  split(): Promise<ReceiptRecord[]>;
  /** Owner-triggered buy of a whole bucket once the guard clears (SPEC 10). Rejects GuardNotClear otherwise. */
  settle(tickerId: TickerId): Promise<ReceiptRecord>;
  /** Whole bucket to spend with a RELEASED receipt. No guard (I11). */
  release(tickerId: TickerId): Promise<ReceiptRecord>;
  /** What a sell would do now, including whether it waits for the session (B2-13). Never moves anything. */
  getSellQuote(request: SellRequest): Promise<SellQuote>;
  /** One PART_SOLD or SOLD receipt per lot touched, oldest lot first (SPEC 12). */
  sell(request: SellRequest): Promise<ReceiptRecord[]>;
  /** Makes a shareable card for one of the owner's buys or weeks. Amounts and proof are off unless asked for. */
  createCard(input: CreateCardInput): Promise<CardData>;
  /**
   * Sends USDG from the account to an address outside Sleeve in one bracketed owner op. The module takes it from the
   * ledgers in LedgerMath's outflow order: spend, then unsorted, then the buckets. Resolves after reading the balance
   * back, so the result's amount is a balance delta, never the request echoed. When the chain says the module is not
   * installed, the send is one plain USDG transfer without brackets, and its result names no ledger (D-040).
   */
  withdraw(request: WithdrawRequest): Promise<WithdrawResult>;
  /**
   * Removes Sleeve (PRD 7.1): one bracketed owner op that uninstalls the module, which moves every waiting bucket to
   * spend with its own RELEASED receipt. Resolves only after Kernel's ModuleUninstallResult for the module reads true
   * in the transaction and the account reads back without the module; rejects UninstallFailed otherwise.
   */
  removeSleeve(): Promise<RemoveResult>;
  /**
   * Turns Sleeve back on for an account whose module is not installed (D-040): the install op without brackets, the
   * one onboarding sends (D-019), with this rule. The module takes a fresh snapshot, so USDG already in the account is
   * never split (I5). Resolves with the rule read back once the account has the module again.
   */
  reinstallSleeve(rule: RuleInput): Promise<Rule>;
  /**
   * What an owner action would do if it ran now, read without moving anything: each movement with its place and
   * token, the price against the market reference for a buy or a sale, the network fee, and anything the owner should
   * know first. A preview never signs and never writes.
   */
  previewAction(action: OwnerAction): Promise<ActionPreview>;
}

export type DataSource = 'mock' | 'chain';

export interface ChainPoint {
  /** ArbSys arbBlockNumber, not block.number. */
  l2Block: bigint;
  /** Unix seconds. */
  timestamp: bigint;
}

export interface Session {
  account: Address;
  /** base64url WebAuthn credential id. */
  credentialId: string;
  signedInAt: bigint;
}

export interface CreateAccountInput {
  /** Installed with the module (SPEC 6 onInstall). Null leaves the rule unset (status NONE). */
  rule: RuleInput | null;
  /** Optional recovery signer (D-014). I11 is claimed only for accounts that set one. */
  recoverySigner: Address | null;
  /** Who owns the account. Left out, a passkey is made first, as before D-022. */
  signer?: AccountSignerInput;
  /** Called as each step starts, in order, so a screen can show where the setup is. */
  onStep?: (step: AccountSetupStep) => void;
}

/** How a new account's owner signs (D-003, D-022). */
export type SignerKind = 'passkey' | 'wallet';

/** A passkey made for Sleeve's site. Only its id leaves the device. */
export interface PasskeyCredential {
  /** base64url credential id. */
  credentialId: string;
  /** The site the passkey is bound to: Sleeve's domain in production, localhost while developing. */
  rpId: string;
  /** webauthn when the browser's own ceremony made it; simulated for sample accounts, tests and the server. */
  ceremony: 'webauthn' | 'simulated';
}

/** What the data layer needs from a connected wallet that owns an account (D-022). */
export interface WalletSigner {
  address: Address;
  /** personal_sign over a 32 byte hash, the way the Kernel ECDSA validator checks an owner op. */
  signHash(hash: Hex): Promise<Hex>;
}

export type AccountSignerInput = { kind: 'passkey'; credentialId: string } | { kind: 'wallet'; wallet: WalletSigner };

/**
 * createAccount's steps: the owner approves the first UserOp, the account deploys, the module installs, the recovery
 * signer installs when one was asked for, then both views are read back.
 */
export type AccountSetupStep = 'approve' | 'deploy' | 'install' | 'recovery' | 'check';

export interface AccountOverview {
  /** The smart account, which is the payment address. */
  address: Address;
  deployed: boolean;
  moduleInstalled: boolean;
  installedAt: bigint | null;
  keeper: Address;
  keeperIsDefault: boolean;
  recoverySigner: Address | null;
  accountingMode: AccountingMode;
}

export interface FeedReading extends FeedRound {
  feed: Address;
}

export interface SessionState {
  open: boolean;
  /** SessionCalendar.Reason at the snapshot. */
  reason: SessionReason;
  /** sessionOpenedAt: when the current open stretch began; null while closed. */
  openedAt: bigint | null;
  /** When the next session opens; null while open. */
  nextOpenAt: bigint | null;
}

/** A QuoterV2 reading for a reference size on the ticker's first allowlisted pool. */
export interface PoolPrice {
  pool: Address;
  usdgIn: bigint;
  tokensOut: bigint;
  /** USDG base units per whole token, as on receipts. */
  execPrice: bigint;
  at: ChainPoint;
}

export interface TickerMarket {
  tickerId: TickerId;
  /** False once the timelock removed the ticker from TokenSource. Removed tickers stay sellable. */
  active: boolean;
  session: SessionState;
  feed: FeedReading;
  /** 18 decimals. */
  uiMultiplier: bigint;
  /** A scheduled multiplier change, or null. */
  pendingMultiplier: { value: bigint; effectiveAt: bigint } | null;
  paused: boolean;
  oraclePaused: boolean;
  poolPrice: PoolPrice | null;
}

export interface MarketSnapshot {
  asOf: ChainPoint;
  tickers: TickerMarket[];
  usdgUsd: FeedReading;
}

export interface LedgerView extends Ledger {
  asOf: ChainPoint;
  /** The public-trigger clock (SPEC 8). Null when no observation is stored. */
  observation: { observedAt: bigint; observedUnsorted: bigint; graceEndsAt: bigint } | null;
}

export interface BucketView extends Bucket {
  tickerId: TickerId;
}

/** The first guard step a split would stop at, read without a swap. BUY means the premium check runs at fill. */
export type SplitOutcome =
  | { kind: 'BUY' }
  | { kind: 'QUEUE'; reason: Reason }
  | { kind: 'REFUSE'; status: Extract<Status, 'REFUSED_TICKER' | 'REFUSED_ACCOUNT'> };

export interface SplitPreview {
  asOf: ChainPoint;
  ruleStatus: RuleStatus;
  /** The rule's ticker. */
  tickerId: TickerId;
  /** USDG the ledgers would cut first, with a RECONCILED receipt. Zero when the balance covers them. */
  shortfall: bigint;
  /** Unsorted after any reconcile. */
  unsorted: bigint;
  spendPart: bigint;
  equityPart: bigint;
  /** Null when nothing is unsorted or the rule is not active. */
  outcome: SplitOutcome | null;
}

export interface LotView extends Lot {
  /** Timestamp of the FILLED or SETTLED receipt. */
  boughtAt: bigint;
  usdgSpent: bigint;
  execPrice: bigint;
  premiumBps: bigint;
  uiMultiplierAtFill: bigint;
}

export interface Holding {
  tickerId: TickerId;
  /** balanceOf(account), 18 decimals. Can exceed the lots when tokens arrived outside Sleeve. */
  balance: bigint;
  /** Sum of tokensRemaining over open lots. Only these are sellable through Sleeve in M0 (D-009 Q30). */
  inLots: bigint;
  /** balance times the feed answer, USDG base units (PRD 7.11). */
  value: bigint;
  feed: FeedReading;
  lots: LotView[];
}

/** Offchain view of an inbound transfer (PRD 9). */
export type InboundState = 'RECEIVED' | 'WAITING_GRACE' | 'SORTED';

export interface InboxItem {
  /** `${txHash}:${logIndex}` */
  id: string;
  from: Address;
  amount: bigint;
  txHash: Hex;
  logIndex: number;
  l2Block: bigint;
  timestamp: bigint;
  state: InboundState;
  /** WAITING_GRACE: when anyone may trigger the split. */
  graceEndsAt: bigint | null;
  /** SORTED: the receipt that sorted it, and the lot when that receipt bought. */
  sortedBy: { receiptId: bigint; lotId: bigint | null } | null;
}

export interface InboundRef {
  txHash: Hex;
  logIndex: number;
  from: Address;
  amount: bigint;
}

/**
 * How a RECONCILED receipt shrank the ledgers. SPEC 13 has no fields for it yet (D-009 Q4 and Q26 name the
 * per-bucket amounts), so the data layer carries it beside the receipt.
 */
export interface Reconciliation {
  shortfall: bigint;
  fromSpend: bigint;
  fromBuckets: { tickerId: TickerId; amount: bigint }[];
}

export interface ReceiptRecord {
  receipt: Receipt;
  /** receiptHash(id) as stored: keccak256(abi.encode(receipt)). */
  receiptHash: Hex;
  /** From logs, labeled derived wherever shown (PRD 10). */
  derived: {
    txHash: Hex;
    /** Inbound transfers this receipt sorted. Empty for receipts that sort nothing. */
    inbound: InboundRef[];
    /** The rule version the receipt names, from the module's rule events. Null when unknown. */
    rule: Rule | null;
  };
  reconciliation: Reconciliation | null;
}

export interface ReceiptQuery {
  account: Address;
  tickerId?: TickerId;
  status?: Status;
  /** nextCursor from the previous page. */
  cursor?: string;
  /** Default 20. */
  limit?: number;
}

export interface ReceiptPage {
  items: ReceiptRecord[];
  nextCursor: string | null;
}

export interface SellRequest {
  tickerId: TickerId;
  /** Stock Token base units. */
  amount: bigint;
  /** 0n sells by amount, oldest lot first; otherwise that lot only (SPEC 12). */
  lotId: bigint;
  /** Skip the session and feed-age steps for this sell only (B2-14). */
  overrideClosed: boolean;
  /** 0 keeps the rule's cap; otherwise the discount cap for this sell, at most 500. */
  overrideCapBps: number;
}

export type SellWaitReason = 'SESSION' | 'STALE';

export interface SellQuote {
  request: SellRequest;
  pool: Address;
  /** USDG base units per 1e18 token units. */
  quote: bigint;
  expectedUsdgOut: bigint;
  minOut: bigint;
  /** PriceGuard discountBps: basis points below the feed, rounded up against the owner. Negative means above it. */
  discountBps: bigint;
  /** The cap this sell must meet: the rule's premium cap, or the override. */
  capBps: number;
  feed: FeedReading;
  /** Lots the sell would draw from, oldest first. */
  lots: { lotId: bigint; tokens: bigint }[];
  /** Set when the sell would revert SellWaits without an override; the screen shows the reopen time. */
  waits: { reason: SellWaitReason; reopensAt: bigint | null } | null;
  /** Set when the sell cannot run as asked; an override does not help. */
  blocked: SellBlock | null;
}

export type SellBlock =
  | { code: 'ExceedsLots'; available: bigint }
  | { code: 'DiscountAboveCap'; discountBps: bigint; capBps: number }
  | { code: 'OverrideCapOutOfRange'; maxBps: number }
  | { code: 'AccountBlocked' }
  | { code: 'GuardNotClear'; reason: Reason };

/** Present only when the owner turned proof on, after being told it reveals the account (PRD 7.10). */
export interface CardProof {
  receiptIds: bigint[];
  account: Address;
}

export interface ReceiptCard {
  kind: 'receipt';
  cardId: string;
  tickerId: TickerId;
  status: Extract<Status, 'FILLED' | 'SETTLED'>;
  /** The rule's equity share for this receipt's rule version: the share of pay. */
  equityBps: number;
  timestamp: bigint;
  /** Null unless the owner chose to show amounts. */
  amounts: { usdgIn: bigint; usdgSpent: bigint; tokensOut: bigint } | null;
  proof: CardProof | null;
}

export interface WeekCard {
  kind: 'week';
  cardId: string;
  /** Monday 00:00 New York time, unix seconds. */
  weekStart: bigint;
  /** The next Monday 00:00 New York time; the week is [weekStart, weekEnd). */
  weekEnd: bigint;
  /** Splits in the week: FILLED, QUEUED and REFUSED receipts. */
  paydays: number;
  /** Tickers bought in the week, ascending. */
  tickerIds: TickerId[];
  /** Equity share of the latest rule version used that week. */
  equityBps: number;
  /** usdgIn summed over the week's splits, and usdgSpent over its FILLED and SETTLED buys. */
  amounts: { usdgIn: bigint; usdgBought: bigint } | null;
  proof: CardProof | null;
}

export type CardData = ReceiptCard | WeekCard;

export interface CreateCardInput {
  subject: { kind: 'receipt'; receiptId: bigint } | { kind: 'week'; weekStart: bigint };
  showAmounts: boolean;
  showProof: boolean;
}

export type VerifyStatus = 'MATCH' | 'MISMATCH' | 'NOT_FOUND' | 'PROVIDER_BLOCKED';

/** How the screen formats a check's raw values. */
export type VerifyUnit =
  | 'usdg'
  | 'token'
  | 'feed'
  | 'multiplier'
  | 'bps'
  | 'hash'
  | 'address'
  | 'block'
  | 'timestamp'
  | 'text';

export interface VerifyCheck {
  id: string;
  label: string;
  unit: VerifyUnit;
  /** Where the recomputed value came from, for example "Transfer log" or "getRoundData". */
  source: string;
  /** Raw decimal or hex strings; the screen formats them by unit. */
  expected: string;
  actual: string;
  ok: boolean;
}

export interface VerifyResult {
  receiptId: bigint;
  status: VerifyStatus;
  checkedAt: bigint;
  /** A different provider from the keeper's (D-008). */
  rpcUrl: string;
  storedHash: Hex | null;
  recomputedHash: Hex | null;
  /** Every check, failing ones included. A mismatch is shown, never smoothed (PRD 10). */
  checks: VerifyCheck[];
}

export interface EligibilityInput {
  /** ISO 3166-1 alpha-2 country of residence. */
  residence: string;
  /** The owner attests they are not a US person. */
  notUsPerson: boolean;
  /** The owner attests they are not subject to sanctions. */
  notSanctioned: boolean;
}

export type EligibilityBlock =
  | { kind: 'RESIDENCE_PROHIBITED'; country: string }
  | { kind: 'RESIDENCE_RESTRICTED'; country: string }
  | { kind: 'IP_PROHIBITED'; country: string }
  | { kind: 'IP_RESTRICTED'; country: string }
  | { kind: 'US_PERSON' }
  | { kind: 'SANCTIONS' };

export interface EligibilityResult {
  eligible: boolean;
  /** Country from the request IP, or null when unknown. */
  ipCountry: string | null;
  blocks: EligibilityBlock[];
}

/**
 * USDG leaving the account for an address outside Sleeve: one bracketed owner op (I14), or one plain transfer for an
 * account whose module is not installed (D-040).
 */
export interface WithdrawRequest {
  /** The destination. Never the account itself and never the zero address. */
  to: Address;
  /** USDG base units, 6 decimals. */
  amount: bigint;
}

/** Which ledgers an outflow comes from, in LedgerMath's order: spend, then unsorted, then buckets by ticker id. */
export interface OutflowSources {
  spend: bigint;
  unsorted: bigint;
  buckets: { tickerId: TickerId; amount: bigint }[];
}

export interface WithdrawResult {
  request: WithdrawRequest;
  /** The transaction that carried the owner op. */
  txHash: Hex;
  at: ChainPoint;
  /** The account's USDG balance read before and after. Their difference is what left (build contract rule 4). */
  balanceBefore: bigint;
  balanceAfter: bigint;
  /**
   * The ledgers the module took it from. Null when the module was not installed: the send was a plain transfer and
   * no ledger exists to take it from (D-040).
   */
  from: OutflowSources | null;
}

/** What removing Sleeve did, read from its transaction and from the account after it. */
export interface RemoveResult {
  /** The transaction that carried the owner op. */
  txHash: Hex;
  at: ChainPoint;
  /** One RELEASED receipt per bucket that waited, ascending ticker id. Empty when nothing waited. */
  released: ReceiptRecord[];
}

/**
 * Every write the owner signs, in the shape previewAction takes: one bracketed UserOp each (I14), except a send and
 * the reinstall for an account whose module is not installed, which go without brackets (D-040). Cards are not here:
 * making one moves nothing onchain.
 */
export type OwnerAction =
  | { kind: 'withdraw'; request: WithdrawRequest }
  | { kind: 'sell'; request: SellRequest }
  | { kind: 'release'; tickerId: TickerId }
  | { kind: 'settle'; tickerId: TickerId }
  | { kind: 'split' }
  | { kind: 'setRule'; input: RuleInput }
  | { kind: 'pauseRule' }
  | { kind: 'resumeRule' }
  | { kind: 'remove' }
  | { kind: 'reinstall'; rule: RuleInput };

export type OwnerActionKind = OwnerAction['kind'];

/** Where money sits, as a preview names it. Every place but outside is in the owner's own account. */
export type MoneyPlace =
  | { kind: 'spend' }
  | { kind: 'unsorted' }
  | { kind: 'waiting'; tickerId: TickerId }
  | { kind: 'holding'; tickerId: TickerId }
  | { kind: 'outside'; address: Address };

/** USDG in base units of 6 decimals, or a Stock Token in base units of 18. */
export type PreviewAsset = { kind: 'USDG' } | { kind: 'STOCK_TOKEN'; tickerId: TickerId };

export interface PreviewAmount {
  asset: PreviewAsset;
  amount: bigint;
}

/** One movement an action makes. A swap sends one asset and receives another; a move keeps its asset. */
export interface PreviewLeg {
  from: MoneyPlace;
  to: MoneyPlace;
  sends: PreviewAmount;
  /** A swap's quoted proceeds and the least it accepts. Null when the asset does not change. */
  receives: (PreviewAmount & { minimum: bigint }) | null;
}

/** A buy or a sale priced against the Chainlink reference, as the guard will judge it (PRD 7.11). */
export interface PreviewPrice {
  side: 'BUY' | 'SELL';
  tickerId: TickerId;
  /** USDG base units per whole token, from the pool quote. */
  execPrice: bigint;
  reference: FeedReading;
  /** Basis points above the reference for a buy, below it for a sale; negative means the other side of it. */
  differenceBps: bigint;
  /** The cap the action must meet: the rule's premium cap, or a sale's override. */
  capBps: number;
  withinCap: boolean;
}

export interface NetworkFee {
  /** Gas for the whole UserOp, estimated. */
  gas: bigint;
  gasPriceWei: bigint;
  /** gas times gasPriceWei, in wei of ETH. */
  wei: bigint;
  /** A paymaster pays it, so nothing leaves the account for gas. */
  sponsored: boolean;
}

/** Something the owner should know before signing. The screen words each one. */
export type PreviewWarning =
  /** A send takes USDG that arrived and is not sorted yet, so the rule never splits it. */
  | { code: 'SENDS_UNSORTED'; amount: bigint }
  /** A send takes USDG that waits to buy a Stock Token. */
  | { code: 'SENDS_WAITING'; tickerId: TickerId; amount: bigint }
  /** A release ends the wait: the USDG becomes spendable and will not buy. */
  | { code: 'RELEASE_ENDS_WAIT'; tickerId: TickerId }
  /** A split's equity share would wait as USDG instead of buying now. */
  | { code: 'EQUITY_WILL_WAIT'; tickerId: TickerId; reason: Reason; reopensAt: bigint | null }
  /** A split's equity share would go to spend, because the ticker or the account is refused. */
  | { code: 'EQUITY_TO_SPEND'; tickerId: TickerId; status: Extract<Status, 'REFUSED_TICKER' | 'REFUSED_ACCOUNT'> }
  /** USDG left outside Sleeve, so the split first lowers the ledgers by this much. */
  | { code: 'RECONCILES_FIRST'; shortfall: bigint }
  /** A sale skips the closed market's wait, so its price can sit far from where the market reopens. */
  | { code: 'SKIPS_MARKET_WAIT'; reopensAt: bigint | null }
  /** A sale accepts a wider discount than the rule's cap. */
  | { code: 'WIDER_CAP'; capBps: number; ruleCapBps: number }
  /** While paused, new payments stay unsorted and spendable. */
  | { code: 'PAUSE_LEAVES_UNSORTED' }
  /** On resume, USDG that arrived while paused splits at the next split. */
  | { code: 'RESUME_SPLITS_UNSORTED'; amount: bigint }
  /** Once Sleeve is removed, payments stay as USDG and nothing splits; the USDG and Stock Tokens stay in the account. */
  | { code: 'REMOVE_STOPS_SPLITS' }
  /** The install snapshot keeps the USDG already in the account spendable, so the rule never splits it (I5). */
  | { code: 'SNAPSHOT_KEEPS_BALANCE'; amount: bigint };

/**
 * Why an action would not go through now: the failure it would meet, named as the data layer names it. A send over
 * the balance is InsufficientBalance. Nothing moves when it is blocked.
 */
export type PreviewBlock = DataLayerErrorDetail | { code: 'InvalidDestination'; reason: 'ZERO' | 'SELF' };

export interface ActionPreview {
  action: OwnerAction;
  asOf: ChainPoint;
  /** What moves, in order. Empty for an action that moves no money, such as a rule change. */
  legs: PreviewLeg[];
  /** A buy or a sale: its price against the reference and the cap. */
  price: PreviewPrice | null;
  /** A rule change: the rule now and as it would read after. */
  rule: { before: Rule; after: Rule } | null;
  fee: NetworkFee;
  warnings: PreviewWarning[];
  blocked: PreviewBlock | null;
}
