import {
  ACCOUNTING_MODES,
  type Address,
  type Hex,
  type Receipt,
  REASONS,
  STATUSES,
  TRIGGERS,
  ZERO_ADDRESS,
  sleeveModuleAbi,
} from '@sleeve/core';
import {
  type DecodeAbiParametersReturnType,
  decodeAbiParameters,
  encodeAbiParameters,
  getAbiItem,
  keccak256,
  stringToHex,
} from 'viem';

import type { Param } from './database';

/**
 * Rows for the schema tests, built the way the keeper builds them: the receipt's event data is abi.encode of the
 * Receipt struct from the deployed module's ABI (packages/core), and its hash is keccak256 of that data.
 */

export const ZERO_BYTES32: Hex = `0x${'0'.repeat(64)}`;

/** Fictional lowercase addresses: the schema stores addresses in lowercase only. */
export const ADA: Address = '0xada0000000000000000000000000000000000001';
export const BO: Address = '0xb0b0000000000000000000000000000000000002';
export const PAYER: Address = '0xc11e000000000000000000000000000000000003';
export const KEEPER: Address = '0x4ee9000000000000000000000000000000000004';
export const SPY_TOKEN: Address = '0x117cc2133c37b721f49de2a7a74833232b3b4c0c';
export const SPY_POOL: Address = '0xa7bb1ac63bbab0c44316e6c8c455213441689167';

/** The ReceiptWritten event's `receipt` argument: the Receipt tuple in SPEC 13 order. */
export const RECEIPT_PARAMETER = getAbiItem({ abi: sleeveModuleAbi, name: 'ReceiptWritten' }).inputs[3];

/**
 * Each Receipt field's column. Three differ from the snake case of the field: id, updatedAt and timestamp
 * (supabase/README.md, receipts).
 */
export const RECEIPT_COLUMNS = {
  id: 'receipt_id',
  account: 'account',
  ruleVersion: 'rule_version',
  trigger: 'trigger',
  payer: 'payer',
  status: 'status',
  reason: 'reason',
  mode: 'mode',
  tickerId: 'ticker_id',
  token: 'token',
  tokenUid: 'token_uid',
  usdgIn: 'usdg_in',
  usdgToSpend: 'usdg_to_spend',
  usdgToEquity: 'usdg_to_equity',
  usdgSpent: 'usdg_spent',
  usdgQueued: 'usdg_queued',
  tokensIn: 'tokens_in',
  tokensOut: 'tokens_out',
  usdgOut: 'usdg_out',
  uiMultiplier: 'ui_multiplier',
  execPrice: 'exec_price',
  premiumBps: 'premium_bps',
  roundId: 'round_id',
  answer: 'answer',
  updatedAt: 'round_updated_at',
  usdgRoundId: 'usdg_round_id',
  usdgAnswer: 'usdg_answer',
  quote: 'quote',
  minOut: 'min_out',
  venueId: 'venue_id',
  pool: 'pool',
  calendarVersion: 'calendar_version',
  disclosureHash: 'disclosure_hash',
  l2Block: 'l2_block',
  timestamp: 'block_timestamp',
  lotId: 'lot_id',
  queuedSince: 'queued_since',
  overrideClosed: 'override_closed',
  overrideCapBps: 'override_cap_bps',
} as const satisfies { readonly [K in keyof Receipt]: string };

export type ReceiptColumn = (typeof RECEIPT_COLUMNS)[keyof Receipt];
export const RECEIPT_FIELD_NAMES = Object.keys(RECEIPT_COLUMNS) as (keyof Receipt)[];

/** Where a log sits on chain. */
export interface LogPosition {
  txHash: Hex;
  blockNumber: number;
  logIndex: number;
}

export function txHashFor(label: string): Hex {
  return keccak256(stringToHex(label));
}

/** A receipt with every field zero but the ones every receipt carries, for tests to fill in. */
export function blankReceipt(id: bigint, account: Address): Receipt {
  return {
    id,
    account,
    ruleVersion: 0,
    trigger: 'KEEPER',
    payer: ZERO_ADDRESS,
    status: 'QUEUED',
    reason: 'NONE',
    mode: 'WRAPPED',
    tickerId: 0,
    token: ZERO_ADDRESS,
    tokenUid: ZERO_BYTES32,
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
    calendarVersion: 0x0001_0000,
    disclosureHash: '0x8408c7a59df30d1b5dbec102c388048f2bf8bba21a2e91ac0806df7d68068e89',
    l2Block: 0n,
    timestamp: 0n,
    lotId: 0n,
    queuedSince: 0n,
    overrideClosed: false,
    overrideCapBps: 0,
  };
}

function enumIndex(members: readonly string[], member: string): number {
  const index = members.indexOf(member);
  if (index < 0) throw new RangeError(`${member} is not one of ${members.join(', ')}`);
  return index;
}

/** abi.encode(receipt): the ReceiptWritten log's data field. Enums encode as their member's position. */
export function encodeReceipt(receipt: Receipt): Hex {
  return encodeAbiParameters(
    [RECEIPT_PARAMETER],
    [
      {
        ...receipt,
        trigger: enumIndex(TRIGGERS, receipt.trigger),
        status: enumIndex(STATUSES, receipt.status),
        reason: enumIndex(REASONS, receipt.reason),
        mode: enumIndex(ACCOUNTING_MODES, receipt.mode),
      },
    ],
  );
}

/** The struct viem decodes from event data, enums still as numbers. */
export type DecodedReceipt = DecodeAbiParametersReturnType<[typeof RECEIPT_PARAMETER]>[0];

export function decodeReceiptData(data: Hex): DecodedReceipt {
  const [decoded] = decodeAbiParameters([RECEIPT_PARAMETER], data);
  return decoded;
}

function columnValue(value: Receipt[keyof Receipt]): Param {
  if (typeof value === 'bigint') return value.toString();
  return value;
}

/** A parameterized insert. Every bigint goes as a decimal string, the way the keeper must send it to PostgREST. */
export interface Insert {
  sql: string;
  params: Param[];
}

function insertInto(table: string, row: Readonly<Record<string, Param>>): Insert {
  const columns = Object.keys(row);
  const placeholders = columns.map((_, index) => `$${index + 1}`);
  return {
    sql: `insert into public.${table} (${columns.join(', ')}) values (${placeholders.join(', ')})`,
    params: columns.map((column) => row[column] ?? null),
  };
}

/** The receipts row the keeper writes for a ReceiptWritten log: typed columns, the raw data, the hash, the log. */
export function receiptRow(receipt: Receipt, log: LogPosition): Record<string, Param> {
  const eventData = encodeReceipt(receipt);
  const row: Record<string, Param> = {};
  for (const field of RECEIPT_FIELD_NAMES) row[RECEIPT_COLUMNS[field]] = columnValue(receipt[field]);
  row.receipt_hash = keccak256(eventData);
  row.event_data = eventData;
  row.tx_hash = log.txHash;
  row.block_number = log.blockNumber;
  row.log_index = log.logIndex;
  return row;
}

export function insertReceipt(receipt: Receipt, log: LogPosition): Insert {
  return insertInto('receipts', receiptRow(receipt, log));
}

export interface AccountInput {
  address: Address;
  installedAtBlock: number;
  installedAtLogIndex?: number;
  keeper?: Address;
  rule?: Record<string, unknown>;
}

export function insertAccount(input: AccountInput): Insert {
  const row: Record<string, Param> = {
    address: input.address,
    installed_at_block: input.installedAtBlock,
    installed_at_log_index: input.installedAtLogIndex ?? 0,
    keeper: input.keeper ?? KEEPER,
  };
  if (input.rule !== undefined) row.rule = JSON.stringify(input.rule);
  return insertInto('accounts', row);
}

/** The product default rule (PRD 7.3) as accounts.rule holds it. */
export function activeRule(version: number): Record<string, unknown> {
  return {
    version,
    status: 'ACTIVE',
    equityBps: 1_000,
    tickerId: 0,
    premiumCapBps: 100,
    slippageBps: 50,
    minClip: '25000000',
  };
}

export function insertRuleVersion(
  account: Address,
  version: number,
  log: LogPosition,
  terms: { equityBps?: number } = {},
): Insert {
  return insertInto('rule_versions', {
    account,
    version,
    equity_bps: terms.equityBps ?? 1_000,
    ticker_id: 0,
    premium_cap_bps: 100,
    slippage_bps: 50,
    min_clip: '25000000',
    tx_hash: log.txHash,
    block_number: log.blockNumber,
    log_index: log.logIndex,
  });
}

export interface PaymentInput {
  to: Address;
  amount: bigint;
  log: LogPosition;
  timestamp: number;
  from?: Address;
  status?: 'RECEIVED' | 'WAITING_GRACE' | 'SORTED';
  graceEndsAt?: number;
  sortedBy?: bigint;
}

export function insertPayment(input: PaymentInput): Insert {
  const row: Record<string, Param> = {
    tx_hash: input.log.txHash,
    log_index: input.log.logIndex,
    block_number: input.log.blockNumber,
    block_timestamp: input.timestamp,
    from_address: input.from ?? PAYER,
    to_address: input.to,
    amount: input.amount.toString(),
  };
  if (input.status !== undefined) row.status = input.status;
  if (input.graceEndsAt !== undefined) row.grace_ends_at = input.graceEndsAt;
  if (input.sortedBy !== undefined) row.sorted_by_receipt_id = input.sortedBy.toString();
  return insertInto('payments', row);
}

export function insertCard(row: Record<string, Param>): Insert {
  return insertInto('cards', row);
}

export function insertPasskey(row: Record<string, Param>): Insert {
  return insertInto('passkey_credentials', row);
}

export function insertRow(table: string, row: Record<string, Param>): Insert {
  return insertInto(table, row);
}

/** A log position with a transaction hash of its own. */
export function at(blockNumber: number, logIndex = 0): LogPosition {
  return { txHash: txHashFor(`${blockNumber}:${logIndex}`), blockNumber, logIndex };
}

/** A FILLED or SETTLED receipt: its lot takes the receipt's id and holds tokensOut. */
export function buyReceipt(
  id: bigint,
  account: Address,
  input: { tickerId: number; tokensOut: bigint; status?: 'FILLED' | 'SETTLED'; usdgIn?: bigint },
): Receipt {
  const status = input.status ?? 'FILLED';
  const equity = 50_000_000n;
  return {
    ...blankReceipt(id, account),
    ruleVersion: 1,
    status,
    reason: status === 'SETTLED' ? 'SESSION' : 'NONE',
    tickerId: input.tickerId,
    token: SPY_TOKEN,
    tokenUid: '0x000000000000000000000000000000001c6f27a62789417d8ed359ed3c2d3da1',
    usdgIn: status === 'FILLED' ? (input.usdgIn ?? 500_000_000n) : 0n,
    usdgToSpend: status === 'FILLED' ? (input.usdgIn ?? 500_000_000n) - equity : 0n,
    usdgToEquity: equity,
    usdgSpent: equity,
    tokensOut: input.tokensOut,
    uiMultiplier: 10n ** 18n,
    execPrice: 672_000_000n,
    premiumBps: 12n,
    roundId: (1n << 64n) + 152n,
    answer: 67_125_000_000n,
    quote: 1_487_900_000_000_000n,
    minOut: 1n,
    venueId: 1,
    pool: SPY_POOL,
    lotId: id,
  };
}

/** A receipt that changes a lot: a sale's PART_SOLD or SOLD, or a lot reconcile's RECONCILED. */
export function lotReceipt(
  id: bigint,
  account: Address,
  input: { status: 'PART_SOLD' | 'SOLD' | 'RECONCILED'; lotId: bigint; tickerId: number; tokensIn: bigint },
): Receipt {
  const sale = input.status !== 'RECONCILED';
  return {
    ...blankReceipt(id, account),
    ruleVersion: 1,
    trigger: 'OWNER',
    status: input.status,
    tickerId: input.tickerId,
    token: SPY_TOKEN,
    tokensIn: input.tokensIn,
    usdgOut: sale ? 25_000_000n : 0n,
    usdgToSpend: sale ? 25_000_000n : 0n,
    lotId: input.lotId,
  };
}

/** A split's QUEUED receipt: usdgIn sorted, the equity part waiting with the reason. */
export function queuedReceipt(id: bigint, account: Address, usdgIn: bigint): Receipt {
  const equity = usdgIn / 10n;
  return {
    ...blankReceipt(id, account),
    ruleVersion: 1,
    status: 'QUEUED',
    reason: 'SESSION',
    token: SPY_TOKEN,
    usdgIn,
    usdgToSpend: usdgIn - equity,
    usdgToEquity: equity,
    usdgQueued: equity,
  };
}

/**
 * The state the constraint tests start from. Ada holds lot 1 (0.1 SPY) from receipt 1, which sorted payment 1, and a
 * QUEUED receipt 2; payment 2 waits unsorted before it. Bo holds lot 3 (0.05 QQQ) from receipt 3.
 */
export const BASE = {
  adaInstall: at(1_000),
  boInstall: at(1_001),
  receipts: [
    { receipt: buyReceipt(1n, ADA, { tickerId: 0, tokensOut: 10n ** 17n }), log: at(2_000, 5) },
    { receipt: queuedReceipt(2n, ADA, 300_000_000n), log: at(2_100, 3) },
    {
      receipt: buyReceipt(3n, BO, { tickerId: 1, tokensOut: 5n * 10n ** 16n, usdgIn: 100_000_000n }),
      log: at(2_200, 4),
    },
  ],
  payment1: { to: ADA, amount: 500_000_000n, log: at(1_999, 2), timestamp: 1_791_554_400 },
  payment2: { to: ADA, amount: 300_000_000n, log: at(2_099, 1), timestamp: 1_791_646_200 },
  /** The first block after every base receipt, for receipts the tests add. */
  nextBlock: 2_201,
} as const;

export function baseWorldInserts(): Insert[] {
  return [
    insertAccount({ address: ADA, installedAtBlock: BASE.adaInstall.blockNumber, rule: activeRule(1) }),
    insertAccount({
      address: BO,
      installedAtBlock: BASE.boInstall.blockNumber,
      rule: { ...activeRule(1), equityBps: 5_000, tickerId: 1 },
    }),
    insertRuleVersion(ADA, 1, at(BASE.adaInstall.blockNumber, 1)),
    insertRuleVersion(BO, 1, at(BASE.boInstall.blockNumber, 1)),
    ...BASE.receipts.map(({ receipt, log }) => insertReceipt(receipt, log)),
    insertPayment({ ...BASE.payment1, status: 'SORTED', sortedBy: 1n }),
    insertPayment(BASE.payment2),
  ];
}
