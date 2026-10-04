import type { ServiceSupabase } from './server-records';

/**
 * Server only. The keeper's index of the module in Supabase (supabase/README.md), read with the service role for the
 * app's receipts and inbox: payments, rule versions and reconciliations are not open to the anon key, so the browser
 * reaches them through app/api/index. Receipts travel as their raw event data, abi.encode(receipt), which the browser
 * decodes itself, so no column mapping can change a value on the way. Every wide integer is read as text (README,
 * Values). The chain stays the authority: the answer carries how far the index has read, and the data layer reads the
 * chain instead when the index is behind.
 */

export const INDEX_STREAMS = ['sleeve_module', 'usdg_transfers'] as const;

export interface IndexedRule {
  version: number;
  equityBps: number;
  tickerId: number;
  premiumCapBps: number;
  slippageBps: number;
  minClip: string;
}

export interface IndexedInbound {
  txHash: string;
  logIndex: number;
  from: string;
  amount: string;
}

export interface IndexedReceipt {
  eventData: string;
  receiptHash: string;
  txHash: string;
  blockNumber: string;
  logIndex: number;
  rule: IndexedRule | null;
  reconciliation: { fromSpend: string; fromBuckets: string[] } | null;
  inbound: IndexedInbound[];
}

export interface IndexedPayment {
  txHash: string;
  logIndex: number;
  blockNumber: string;
  timestamp: string;
  from: string;
  amount: string;
  status: 'RECEIVED' | 'WAITING_GRACE' | 'SORTED';
  graceEndsAt: string | null;
  sortedBy: { receiptId: string; lotId: string | null } | null;
}

async function select<T>(config: ServiceSupabase, path: string): Promise<T[]> {
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    cache: 'no-store',
    headers: { apikey: config.key, authorization: `Bearer ${config.key}` },
  });
  if (!response.ok) throw new Error(`Supabase answered ${response.status}: ${await response.text()}`);
  return (await response.json()) as T[];
}

const inList = (values: readonly string[]): string => `(${values.map((value) => `"${value}"`).join(',')})`;

/**
 * A uint256[] column read as text, such as "{0,500000}", as its decimal strings. PostgREST's select takes a cast only
 * to a plain type, so `::text[]` fails to parse and the array comes back as Postgres array text instead.
 */
export function uintArrayFromText(text: string): string[] {
  const inner = text.replace(/^\{|\}$/g, '');
  return inner === '' ? [] : inner.split(',');
}

/** The last L2 block both log streams are indexed through, or null before the keeper has run. */
export async function indexedTo(config: ServiceSupabase): Promise<string | null> {
  const rows = await select<{ stream: string; last_block: number | string }>(
    config,
    `chain_cursor?stream=in.${inList(INDEX_STREAMS)}&select=stream,last_block`,
  );
  if (rows.length < INDEX_STREAMS.length) return null;
  return rows.map((row) => BigInt(row.last_block)).reduce((low, value) => (value < low ? value : low)).toString();
}

interface ReceiptRow {
  receipt_id: string;
  account: string;
  rule_version: number;
  status: string;
  lot_id: string;
  receipt_hash: string;
  event_data: string;
  tx_hash: string;
  block_number: number | string;
  log_index: number;
}

const RECEIPT_COLUMNS = 'receipt_id::text,account,rule_version,status,lot_id::text,receipt_hash,event_data,tx_hash,block_number::text,log_index';

async function withDerived(config: ServiceSupabase, rows: ReceiptRow[]): Promise<IndexedReceipt[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.receipt_id);
  const accounts = [...new Set(rows.map((row) => row.account))];
  const [rules, reconciliations, payments] = await Promise.all([
    select<{ account: string; version: number; equity_bps: number; ticker_id: number; premium_cap_bps: number; slippage_bps: number; min_clip: string }>(
      config,
      `rule_versions?account=in.${inList(accounts)}&select=account,version,equity_bps,ticker_id,premium_cap_bps,slippage_bps,min_clip::text`,
    ),
    select<{ receipt_id: string; from_spend: string; from_buckets: string }>(
      config,
      `reconciliations?receipt_id=in.${inList(ids)}&select=receipt_id::text,from_spend::text,from_buckets::text`,
    ),
    select<{ tx_hash: string; log_index: number; from_address: string; amount: string; sorted_by_receipt_id: string }>(
      config,
      `payments?sorted_by_receipt_id=in.${inList(ids)}&select=tx_hash,log_index,from_address,amount::text,sorted_by_receipt_id::text&order=block_number.asc,log_index.asc`,
    ),
  ]);
  return rows.map((row) => {
    const rule = rules.find((entry) => entry.account === row.account && entry.version === row.rule_version);
    const reconciled = reconciliations.find((entry) => entry.receipt_id === row.receipt_id);
    return {
      eventData: row.event_data,
      receiptHash: row.receipt_hash,
      txHash: row.tx_hash,
      blockNumber: String(row.block_number),
      logIndex: row.log_index,
      rule:
        rule === undefined
          ? null
          : {
              version: rule.version,
              equityBps: rule.equity_bps,
              tickerId: rule.ticker_id,
              premiumCapBps: rule.premium_cap_bps,
              slippageBps: rule.slippage_bps,
              minClip: rule.min_clip,
            },
      reconciliation:
        reconciled === undefined ? null : { fromSpend: reconciled.from_spend, fromBuckets: uintArrayFromText(reconciled.from_buckets) },
      inbound: payments
        .filter((payment) => payment.sorted_by_receipt_id === row.receipt_id)
        .map((payment) => ({ txHash: payment.tx_hash, logIndex: payment.log_index, from: payment.from_address, amount: payment.amount })),
    };
  });
}

export interface ReceiptListQuery {
  account: string;
  tickerId: number | null;
  status: string | null;
  /** Receipt ids below this one. */
  before: string | null;
  limit: number;
}

/** One page of an account's receipts, newest first, and whether more follow. */
export async function indexedReceipts(config: ServiceSupabase, query: ReceiptListQuery): Promise<{ items: IndexedReceipt[]; more: boolean }> {
  const filters = [
    `account=eq.${query.account.toLowerCase()}`,
    query.tickerId === null ? null : `ticker_id=eq.${query.tickerId}`,
    query.status === null ? null : `status=eq.${query.status}`,
    query.before === null ? null : `receipt_id=lt.${query.before}`,
  ].filter((part): part is string => part !== null);
  const rows = await select<ReceiptRow>(
    config,
    `receipts?${filters.join('&')}&select=${RECEIPT_COLUMNS}&order=receipt_id.desc&limit=${query.limit + 1}`,
  );
  return { items: await withDerived(config, rows.slice(0, query.limit)), more: rows.length > query.limit };
}

export async function indexedReceipt(config: ServiceSupabase, id: string): Promise<IndexedReceipt | null> {
  const rows = await select<ReceiptRow>(config, `receipts?receipt_id=eq.${id}&select=${RECEIPT_COLUMNS}`);
  return (await withDerived(config, rows))[0] ?? null;
}

/** The inbox: an account's payments, newest first, with the receipt that sorted each. */
export async function indexedInbox(config: ServiceSupabase, account: string): Promise<IndexedPayment[]> {
  const rows = await select<{
    tx_hash: string;
    log_index: number;
    block_number: number | string;
    block_timestamp: number | string;
    from_address: string;
    amount: string;
    status: IndexedPayment['status'];
    grace_ends_at: number | string | null;
    sorted_by_receipt_id: string | null;
  }>(
    config,
    `payments?to_address=eq.${account.toLowerCase()}&select=tx_hash,log_index,block_number::text,block_timestamp::text,from_address,amount::text,status,grace_ends_at::text,sorted_by_receipt_id::text&order=block_number.desc,log_index.desc`,
  );
  const sorterIds = [...new Set(rows.flatMap((row) => (row.sorted_by_receipt_id === null ? [] : [row.sorted_by_receipt_id])))];
  const sorters =
    sorterIds.length === 0
      ? []
      : await select<{ receipt_id: string; status: string; lot_id: string }>(
          config,
          `receipts?receipt_id=in.${inList(sorterIds)}&select=receipt_id::text,status,lot_id::text`,
        );
  return rows.map((row) => {
    const sorter = sorters.find((entry) => entry.receipt_id === row.sorted_by_receipt_id);
    return {
      txHash: row.tx_hash,
      logIndex: row.log_index,
      blockNumber: String(row.block_number),
      timestamp: String(row.block_timestamp),
      from: row.from_address,
      amount: row.amount,
      status: row.status,
      graceEndsAt: row.grace_ends_at === null ? null : String(row.grace_ends_at),
      sortedBy:
        row.sorted_by_receipt_id === null
          ? null
          : { receiptId: row.sorted_by_receipt_id, lotId: sorter?.status === 'FILLED' ? sorter.lot_id : null },
    };
  });
}
