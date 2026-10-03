import { MODULE_PARAMS, erc20Abi, sleeveModuleAbi, type Receipt, type Rule, type Status } from '@sleeve/core';
import { encodeEventTopics, isAddressEqual, type Address, type Hex, type Log } from 'viem';

import type { InboundRef, InboxItem, ReceiptRecord, Reconciliation } from '../types';
import { CONTRACTS, type ChainContext } from './context';
import {
  decodeReceiptLog,
  decodeReconciledLog,
  decodeRuleSetLog,
  type ReceiptLog,
  type ReconciledLog,
} from './decode';
import { compareLogs, scanLogs, type LogFilter } from './logs';

/**
 * An account's history from logs: receipts, rule versions, reconciles, owner ops, and the USDG that arrived. The
 * inbox and each receipt's sorted payments are derived, never stored, and every screen labels them that way (PRD 10).
 *
 * How a payment is matched to the split that sorted it: a split sorts all USDG unsorted at that moment, so each split
 * receipt sorts every inbound transfer that arrived before it and was not sorted yet.
 */

const SPLIT_STATUSES = new Set<Status>(['FILLED', 'QUEUED', 'REFUSED_TICKER', 'REFUSED_ACCOUNT']);
const SELL_STATUSES = new Set<Status>(['PART_SOLD', 'SOLD']);

function topics(eventName: 'ReceiptWritten' | 'RuleSet' | 'Reconciled' | 'OwnerOpEnded' | 'Installed' | 'Observed', account: Address) {
  return encodeEventTopics({ abi: sleeveModuleAbi, eventName, args: { account } } as Parameters<typeof encodeEventTopics>[0]);
}

function moduleFilter(eventName: Parameters<typeof topics>[0], account: Address): LogFilter {
  return { address: CONTRACTS.module, topics: topics(eventName, account) };
}

function usdgInboundFilter(account: Address): LogFilter {
  return { address: CONTRACTS.usdg, topics: encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer', args: { to: account } }) };
}

function isSplitReceipt(receipt: Receipt): boolean {
  return SPLIT_STATUSES.has(receipt.status) && receipt.usdgIn > 0n;
}

/** A transfer the module treats as income: after the install snapshot, outside the owner's own bracketed ops. */
interface Inbound {
  ref: InboundRef;
  blockNumber: bigint;
  logIndex: number;
}

function before(a: { blockNumber: bigint; logIndex: number }, b: { blockNumber: bigint; logIndex: number }): boolean {
  return a.blockNumber < b.blockNumber || (a.blockNumber === b.blockNumber && a.logIndex < b.logIndex);
}

export interface AccountHistory {
  receipts: ReceiptLog[];
  rules: Map<number, Rule>;
  reconciliations: Map<bigint, ReconciledLog>;
  inbound: Inbound[];
  /** Receipt id to the transfers it sorted. */
  sortedBy: Map<bigint, InboundRef[]>;
  /** Transfers no split has sorted yet. */
  unsorted: Inbound[];
  /** Transfer id (`${txHash}:${logIndex}`) to the receipt that sorted it. */
  sorter: Map<string, ReceiptLog>;
}

export class HistoryReader {
  private readonly blockTimes = new Map<bigint, Promise<bigint>>();
  private readonly byId = new Map<string, ReceiptLog>();

  constructor(private readonly ctx: ChainContext) {}

  private async head(): Promise<bigint> {
    return this.ctx.client.getBlockNumber({ cacheTime: 1_000 });
  }

  private read(filter: LogFilter, head: bigint): Promise<Log[]> {
    return this.ctx.logs.stream(filter).read(head);
  }

  async history(account: Address): Promise<AccountHistory> {
    const head = await this.head();
    const [receiptLogs, ruleLogs, reconciledLogs, ownerOpLogs, installLogs, transferLogs] = await Promise.all([
      this.read(moduleFilter('ReceiptWritten', account), head),
      this.read(moduleFilter('RuleSet', account), head),
      this.read(moduleFilter('Reconciled', account), head),
      this.read(moduleFilter('OwnerOpEnded', account), head),
      this.read(moduleFilter('Installed', account), head),
      this.read(usdgInboundFilter(account), head),
    ]);

    const receipts = receiptLogs.map(decodeReceiptLog);
    for (const entry of receipts) this.byId.set(entry.receipt.id.toString(), entry);
    const rules = new Map<number, Rule>();
    for (const log of ruleLogs) {
      const { rule } = decodeRuleSetLog(log);
      rules.set(rule.version, rule);
    }
    const reconciliations = new Map<bigint, ReconciledLog>();
    for (const log of reconciledLogs) {
      const decoded = decodeReconciledLog(log);
      reconciliations.set(decoded.receiptId, decoded);
    }

    const ownerTxs = new Set(ownerOpLogs.map((log) => log.transactionHash?.toLowerCase()));
    for (const entry of receipts) if (SELL_STATUSES.has(entry.receipt.status)) ownerTxs.add(entry.txHash.toLowerCase());
    const lastInstall = [...installLogs].sort(compareLogs).at(-1);
    const installPoint =
      lastInstall === undefined ? null : { blockNumber: lastInstall.blockNumber ?? 0n, logIndex: lastInstall.logIndex ?? 0 };

    const inbound: Inbound[] = transferLogs
      .filter((log) => !ownerTxs.has(log.transactionHash?.toLowerCase()))
      .map((log) => ({
        ref: {
          txHash: log.transactionHash as Hex,
          logIndex: log.logIndex ?? 0,
          from: `0x${(log.topics[1] ?? '').slice(26)}` as Address,
          amount: BigInt(log.data),
        },
        blockNumber: log.blockNumber ?? 0n,
        logIndex: log.logIndex ?? 0,
      }))
      .filter((item) => installPoint !== null && before(installPoint, item) && item.ref.amount > 0n);

    const sortedBy = new Map<bigint, InboundRef[]>();
    const sorter = new Map<string, ReceiptLog>();
    let pending: Inbound[] = [];
    let next = 0;
    const splits = receipts.filter((entry) => isSplitReceipt(entry.receipt));
    for (const split of splits) {
      while (next < inbound.length && before(inbound[next]!, split)) pending.push(inbound[next++]!);
      sortedBy.set(split.receipt.id, pending.map((item) => item.ref));
      for (const item of pending) sorter.set(`${item.ref.txHash}:${item.ref.logIndex}`, split);
      pending = [];
    }
    const unsorted = [...pending, ...inbound.slice(next)];
    return { receipts, rules, reconciliations, inbound, sortedBy, unsorted, sorter };
  }

  /** One receipt by id, from its own log. Receipts are public. */
  async receiptLog(id: bigint): Promise<ReceiptLog | null> {
    const cached = this.byId.get(id.toString());
    if (cached !== undefined) return cached;
    const found = await this.receiptLogs([id]);
    return found[0] ?? null;
  }

  /** Receipts by id in one log read, ascending id. Ids without a receipt are left out. */
  async receiptLogs(ids: readonly bigint[]): Promise<ReceiptLog[]> {
    const missing = ids.filter((id) => !this.byId.has(id.toString()));
    if (missing.length > 0) {
      const head = await this.head();
      const filter: LogFilter = {
        address: CONTRACTS.module,
        topics: encodeEventTopics({ abi: sleeveModuleAbi, eventName: 'ReceiptWritten', args: { id: missing } }),
      };
      const logs = await scanLogs(this.ctx.client, filter, this.ctx.fromBlock, head);
      for (const log of logs) {
        const entry = decodeReceiptLog(log);
        this.byId.set(entry.receipt.id.toString(), entry);
      }
    }
    return ids
      .map((id) => this.byId.get(id.toString()))
      .filter((entry): entry is ReceiptLog => entry !== undefined)
      .sort((a, b) => (a.receipt.id < b.receipt.id ? -1 : 1));
  }

  /** The stored receiptHash(id) for each receipt, read in one multicall. */
  async storedHashes(ids: readonly bigint[]): Promise<Map<bigint, Hex>> {
    if (ids.length === 0) return new Map();
    const hashes = await this.ctx.client.multicall({
      allowFailure: false,
      contracts: ids.map((id) => ({ address: CONTRACTS.module, abi: sleeveModuleAbi, functionName: 'receiptHash', args: [id] }) as const),
    });
    return new Map(ids.map((id, index) => [id, hashes[index] as Hex]));
  }

  /** Block timestamps, each block read once. */
  blockTime(blockNumber: bigint): Promise<bigint> {
    let time = this.blockTimes.get(blockNumber);
    if (time === undefined) {
      time = this.ctx.client.getBlock({ blockNumber }).then((block) => block.timestamp);
      time.catch(() => this.blockTimes.delete(blockNumber));
      this.blockTimes.set(blockNumber, time);
    }
    return time;
  }

  /** Full records for receipt logs of one account, with derived fields from its history. */
  async records(entries: readonly ReceiptLog[], history: AccountHistory): Promise<ReceiptRecord[]> {
    const hashes = await this.storedHashes(entries.map((entry) => entry.receipt.id));
    return entries.map((entry) => recordOf(entry, hashes.get(entry.receipt.id) ?? entry.dataHash, history));
  }

  /** The inbox: inbound transfers newest first, each with what became of it. */
  async inbox(account: Address, observation: { observedAt: bigint } | null): Promise<InboxItem[]> {
    const history = await this.history(account);
    const items = await Promise.all(
      history.inbound.map(async (item): Promise<InboxItem> => {
        const id = `${item.ref.txHash}:${item.ref.logIndex}`;
        const sorter = history.sorter.get(id);
        const waiting = sorter === undefined && observation !== null && observation.observedAt > 0n;
        return {
          id,
          from: item.ref.from,
          amount: item.ref.amount,
          txHash: item.ref.txHash,
          logIndex: item.ref.logIndex,
          l2Block: item.blockNumber,
          timestamp: await this.blockTime(item.blockNumber),
          state: sorter !== undefined ? 'SORTED' : waiting ? 'WAITING_GRACE' : 'RECEIVED',
          graceEndsAt: waiting && observation !== null ? observation.observedAt + MODULE_PARAMS.graceSeconds : null,
          sortedBy:
            sorter === undefined
              ? null
              : { receiptId: sorter.receipt.id, lotId: sorter.receipt.status === 'FILLED' ? sorter.receipt.lotId : null },
        };
      }),
    );
    return items.reverse();
  }
}

function reconciliationOf(receipt: Receipt, log: ReconciledLog | undefined): Reconciliation | null {
  if (receipt.status !== 'RECONCILED' || log === undefined) return null;
  return {
    shortfall: receipt.usdgIn,
    fromSpend: log.fromSpend,
    fromBuckets: log.fromBuckets
      .map((amount, tickerId) => ({ tickerId, amount }))
      .filter((part) => part.amount > 0n),
  };
}

export function recordOf(entry: ReceiptLog, storedHash: Hex, history: AccountHistory | null): ReceiptRecord {
  const { receipt } = entry;
  return {
    receipt,
    receiptHash: storedHash,
    derived: {
      txHash: entry.txHash,
      inbound: history?.sortedBy.get(receipt.id) ?? [],
      rule: history?.rules.get(receipt.ruleVersion) ?? null,
    },
    reconciliation: reconciliationOf(receipt, history?.reconciliations.get(receipt.id)),
  };
}

const RECEIPT_WRITTEN_TOPIC = encodeEventTopics({ abi: sleeveModuleAbi, eventName: 'ReceiptWritten' })[0];

/** Receipts of one account that a transaction wrote, ascending id. */
export function receiptsInLogs(logs: readonly Log[], account: Address): ReceiptLog[] {
  return logs
    .filter((log) => isAddressEqual(log.address, CONTRACTS.module) && log.topics[0] === RECEIPT_WRITTEN_TOPIC)
    .map(decodeReceiptLog)
    .filter((entry) => isAddressEqual(entry.receipt.account, account))
    .sort((a, b) => (a.receipt.id < b.receipt.id ? -1 : 1));
}
