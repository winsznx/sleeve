import { CHAIN_ID, type Receipt, type Rule } from '@sleeve/core';

import { lower } from '../chain/events';
import type {
  AccountRecord,
  BucketWaitRecord,
  PaymentRecord,
  ReceiptRecord,
  ReconciliationRecord,
  RuleVersionRecord,
  RunFinish,
  RunStart,
} from './store';

/**
 * Rows as the tables take them (supabase/README.md, values): addresses and hashes lowercase, every integer wider than
 * 32 bits as a decimal string, enums by name, and no indexed_at, created_at or updated_at, which the database sets.
 */
export type RowValue = string | number | boolean | null | readonly string[] | Readonly<Record<string, unknown>>;
export type Row = Record<string, RowValue>;

/** Each Receipt field's column: the field in snake case, except id, updatedAt and timestamp. */
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

const RECEIPT_FIELDS = Object.keys(RECEIPT_COLUMNS) as (keyof Receipt)[];

/** Integers as decimal strings, addresses and hashes lowercase, enum names as they are. */
function value(field: Receipt[keyof Receipt]): RowValue {
  if (typeof field === 'bigint') return field.toString();
  if (typeof field === 'string' && field.startsWith('0x')) return lower(field);
  return field;
}

/** accounts.rule: ruleOf(account) with packages/core Rule keys and minClip as a decimal string. */
export function ruleJson(rule: Rule): Record<string, unknown> {
  return {
    version: rule.version,
    status: rule.status,
    equityBps: rule.equityBps,
    tickerId: rule.tickerId,
    premiumCapBps: rule.premiumCapBps,
    slippageBps: rule.slippageBps,
    minClip: rule.minClip.toString(),
  };
}

/** The rule onInstall and onUninstall leave: ruleOf's zero value, the accounts.rule column default. */
export const EMPTY_RULE: Rule = {
  version: 0,
  status: 'NONE',
  equityBps: 0,
  tickerId: 0,
  premiumCapBps: 0,
  slippageBps: 0,
  minClip: 0n,
};

export function accountRow(account: AccountRecord): Row {
  return {
    address: lower(account.address),
    installed_at_block: account.installedAt.blockNumber.toString(),
    installed_at_log_index: account.installedAt.logIndex,
    uninstalled_at_block: account.uninstalledAtBlock === null ? null : account.uninstalledAtBlock.toString(),
    keeper: lower(account.keeper),
    rule: ruleJson(account.rule),
  };
}

export function ruleVersionRow(record: RuleVersionRecord): Row {
  return {
    account: lower(record.account),
    version: record.rule.version,
    equity_bps: record.rule.equityBps,
    ticker_id: record.rule.tickerId,
    premium_cap_bps: record.rule.premiumCapBps,
    slippage_bps: record.rule.slippageBps,
    min_clip: record.rule.minClip.toString(),
    tx_hash: lower(record.pos.txHash),
    block_number: record.pos.blockNumber.toString(),
    log_index: record.pos.logIndex,
  };
}

export function receiptRow(record: ReceiptRecord): Row {
  const row: Row = {};
  for (const field of RECEIPT_FIELDS) row[RECEIPT_COLUMNS[field]] = value(record.receipt[field]);
  row.receipt_hash = lower(record.hash);
  row.event_data = lower(record.data);
  row.tx_hash = lower(record.pos.txHash);
  row.block_number = record.pos.blockNumber.toString();
  row.log_index = record.pos.logIndex;
  return row;
}

export function reconciliationRow(record: ReconciliationRecord): Row {
  return {
    receipt_id: record.receiptId.toString(),
    balance: record.balance.toString(),
    from_spend: record.fromSpend.toString(),
    from_buckets: record.fromBuckets.map((amount) => amount.toString()),
    tx_hash: lower(record.pos.txHash),
    block_number: record.pos.blockNumber.toString(),
    log_index: record.pos.logIndex,
  };
}

export function paymentRow(record: PaymentRecord): Row {
  return {
    chain_id: CHAIN_ID,
    tx_hash: lower(record.pos.txHash),
    log_index: record.pos.logIndex,
    block_number: record.pos.blockNumber.toString(),
    block_timestamp: record.blockTimestamp.toString(),
    from_address: lower(record.from),
    to_address: lower(record.to),
    amount: record.amount.toString(),
    status: record.status,
    grace_ends_at: record.graceEndsAt === null ? null : record.graceEndsAt.toString(),
    sorted_by_receipt_id: record.sortedBy === null ? null : record.sortedBy.toString(),
  };
}

export function bucketWaitRow(record: BucketWaitRecord): Row {
  return {
    account: lower(record.account),
    ticker_id: record.tickerId,
    reason: record.reason,
    bucket_since: record.bucketSince.toString(),
    first_seen_at: record.firstSeenAt.toString(),
    last_seen_at: record.lastSeenAt.toString(),
  };
}

function plainDetail(detail: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const text = JSON.stringify(detail, (_key, field: unknown) => (typeof field === 'bigint' ? field.toString() : field));
  return JSON.parse(text) as Record<string, unknown>;
}

export function runStartRow(run: RunStart): Row {
  return {
    action: run.action,
    account: run.account === null ? null : lower(run.account),
    ticker_id: run.tickerId,
    started_at: run.startedAt.toISOString(),
    detail: plainDetail(run.detail),
  };
}

export function runFinishRow(finish: RunFinish): Row {
  return {
    finished_at: finish.finishedAt.toISOString(),
    outcome: finish.outcome,
    tx_hash: finish.txHash === null ? null : lower(finish.txHash),
    error: finish.error,
    detail: plainDetail(finish.detail),
  };
}
