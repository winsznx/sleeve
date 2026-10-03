import { sleeveModuleAbi, type Address, type Hex, type Status, type TickerId } from '@sleeve/core';
import { decodeAbiParameters, getAbiItem, keccak256 } from 'viem';

import type { InboxItem, ReceiptPage, ReceiptRecord } from '../types';
import { receiptFromRaw, type RawReceipt } from './decode';

/**
 * Supabase first, the chain always behind it (supabase/README.md, PRD 13). The keeper's index answers through
 * app/api/index; this reads it and hands back null whenever it cannot be trusted for the question: no Supabase
 * configured on the server, the keeper not run yet, the index more than a couple of minutes behind the chain head, or
 * any failure. A null sends the data layer to the chain, which is the authority and gives the same shapes.
 */

export const INDEX_ROUTE = '/api/index';
/** About thirty seconds of Robinhood Chain blocks: a few keeper polls. Further behind, the chain answers. */
export const MAX_INDEX_LAG_BLOCKS = 300n;

interface IndexedRuleJson {
  version: number;
  equityBps: number;
  tickerId: number;
  premiumCapBps: number;
  slippageBps: number;
  minClip: string;
}

interface IndexedReceiptJson {
  eventData: Hex;
  receiptHash: Hex;
  txHash: Hex;
  blockNumber: string;
  logIndex: number;
  rule: IndexedRuleJson | null;
  reconciliation: { fromSpend: string; fromBuckets: string[] } | null;
  inbound: { txHash: Hex; logIndex: number; from: Address; amount: string }[];
}

interface IndexedPaymentJson {
  txHash: Hex;
  logIndex: number;
  blockNumber: string;
  timestamp: string;
  from: Address;
  amount: string;
  status: InboxItem['state'];
  graceEndsAt: string | null;
  sortedBy: { receiptId: string; lotId: string | null } | null;
}

const receiptTuple = [{ type: 'tuple', components: getAbiItem({ abi: sleeveModuleAbi, name: 'ReceiptWritten' }).inputs[3].components }] as const;

/** A receipt from the index, decoded from its event data and checked against the stored hash. */
export function recordFromIndex(json: IndexedReceiptJson): ReceiptRecord {
  if (keccak256(json.eventData) !== json.receiptHash.toLowerCase()) {
    throw new Error(`The index holds receipt data that does not hash to its stored hash (${json.txHash}:${json.logIndex})`);
  }
  const [raw] = decodeAbiParameters(receiptTuple, json.eventData);
  const receipt = receiptFromRaw(raw as RawReceipt);
  return {
    receipt,
    receiptHash: json.receiptHash,
    derived: {
      txHash: json.txHash,
      inbound: json.inbound.map((item) => ({ ...item, amount: BigInt(item.amount) })),
      rule: json.rule === null ? null : { ...json.rule, status: 'ACTIVE', minClip: BigInt(json.rule.minClip) },
    },
    reconciliation:
      json.reconciliation === null || receipt.status !== 'RECONCILED'
        ? null
        : {
            shortfall: receipt.usdgIn,
            fromSpend: BigInt(json.reconciliation.fromSpend),
            fromBuckets: json.reconciliation.fromBuckets
              .map((amount, tickerId) => ({ tickerId, amount: BigInt(amount) }))
              .filter((part) => part.amount > 0n),
          },
  };
}

export function inboxFromIndex(json: IndexedPaymentJson): InboxItem {
  return {
    id: `${json.txHash}:${json.logIndex}`,
    from: json.from,
    amount: BigInt(json.amount),
    txHash: json.txHash,
    logIndex: json.logIndex,
    l2Block: BigInt(json.blockNumber),
    timestamp: BigInt(json.timestamp),
    state: json.status,
    graceEndsAt: json.graceEndsAt === null ? null : BigInt(json.graceEndsAt),
    sortedBy:
      json.sortedBy === null
        ? null
        : { receiptId: BigInt(json.sortedBy.receiptId), lotId: json.sortedBy.lotId === null ? null : BigInt(json.sortedBy.lotId) },
  };
}

export interface IndexSource {
  receipts(query: { account: Address; tickerId?: TickerId; status?: Status; before: bigint | null; limit: number }, head: bigint): Promise<ReceiptPage | null>;
  /** Undefined when the chain must answer. */
  receipt(id: bigint, head: bigint): Promise<ReceiptRecord | undefined>;
  inbox(account: Address, head: bigint): Promise<InboxItem[] | null>;
}

/** The index through Sleeve's route. Every method answers null (or undefined for one receipt) when the chain must answer. */
export function routeIndexSource(fetcher: typeof fetch = (input, init) => fetch(input, init)): IndexSource {
  async function get<T extends { indexedTo: string }>(params: URLSearchParams, head: bigint): Promise<T | null> {
    try {
      const response = await fetcher(`${INDEX_ROUTE}?${params.toString()}`, { cache: 'no-store' });
      if (!response.ok) return null;
      const body = (await response.json()) as T;
      return head - BigInt(body.indexedTo) > MAX_INDEX_LAG_BLOCKS ? null : body;
    } catch {
      return null;
    }
  }

  return {
    async receipts(query, head) {
      const params = new URLSearchParams({ view: 'receipts', account: query.account, limit: String(query.limit) });
      if (query.tickerId !== undefined) params.set('tickerId', String(query.tickerId));
      if (query.status !== undefined) params.set('status', query.status);
      if (query.before !== null) params.set('before', query.before.toString());
      const body = await get<{ indexedTo: string; items: IndexedReceiptJson[]; more: boolean }>(params, head);
      if (body === null) return null;
      const items = body.items.map(recordFromIndex);
      const last = items[items.length - 1];
      return { items, nextCursor: body.more && last !== undefined ? last.receipt.id.toString() : null };
    },
    async receipt(id, head) {
      const body = await get<{ indexedTo: string; receipt: IndexedReceiptJson | null }>(new URLSearchParams({ view: 'receipt', id: id.toString() }), head);
      // Not in the index can mean written after its cursor, so only the chain may say a receipt does not exist.
      return body === null || body.receipt === null ? undefined : recordFromIndex(body.receipt);
    },
    async inbox(account, head) {
      const body = await get<{ indexedTo: string; payments: IndexedPaymentJson[] }>(new URLSearchParams({ view: 'inbox', account }), head);
      return body === null ? null : body.payments.map(inboxFromIndex);
    },
  };
}
