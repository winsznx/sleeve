import { type Address, DEPLOYMENT_4663, type Hex, MODULE_PARAMS } from '@sleeve/core';
import { keccak256 } from 'viem';

import {
  type ModuleEvent,
  type TransferLog,
  comparePositions,
  decodeModuleLog,
  decodeTransferLog,
  userOperationBoundaries,
} from '../chain/events';
import type { BlockRef, ChainGateway, HeadBlock } from '../chain/gateway';
import { describeFailure, formatFailure } from '../chain/revert';
import { IndexIntegrityError, ReorgBelowCursorError } from '../errors';
import type { Logger } from '../log';
import type { RunRecorder } from '../runs';
import { type AccountRecord, type Cursor, type KeeperStore, STREAMS } from '../store/store';
import { type ChunkResult, processChunk, transactionsNeedingBoundaries, transferRecipients } from './chunk';

export interface IndexerOptions {
  /** Blocks behind the head that stay unindexed until they are this deep. */
  confirmations: number;
  /** The widest eth_getLogs range, in blocks. */
  maxChunkBlocks: number;
  /** The narrowest range the indexer halves down to before it gives up on a pass. */
  minChunkBlocks?: number;
  /** Ranges per pass, so a long catch-up still lets the loop act and report health. */
  maxChunksPerPass?: number;
  /** Recipients per USDG Transfer query (an OR over the `to` topic). */
  recipientsPerQuery?: number;
  /** Where indexing starts without a cursor: the deploy block. */
  startBlock?: bigint;
  /** How often a cursor with nothing new behind it is still written. */
  cursorWriteIntervalMs?: number;
}

export interface IndexedBlock {
  number: bigint;
  hash: Hex;
  timestamp: bigint;
}

export interface CatchUpResult {
  /** The last block indexed in full, or null before the first range. */
  indexedTo: bigint | null;
  ranges: number;
  /** True when the index reached the confirmed head. */
  caughtUp: boolean;
}

const MIN_CHUNK = 100;
/** Clean ranges at the learned ceiling before one wider range is tried again. */
const PROBE_AFTER_RANGES = 64;

/**
 * Indexes the module's logs and the USDG transfers to installed accounts from the deploy block (or the stored cursor)
 * to the head minus the confirmation depth, range by range, and keeps the accounts it learns in memory for the
 * keeper. The newest blocks are never indexed until they are `confirmations` deep, so they are read again on every
 * pass until then. A cursor whose block hash no longer matches the chain is a reorg deeper than that window: the
 * index is append-only, so indexing stops with ReorgBelowCursor and an operator rebuilds it.
 */
export class Indexer {
  readonly accounts = new Map<Address, AccountRecord>();
  private cursor: Cursor | null = null;
  private indexed: IndexedBlock | null = null;
  private halted: ReorgBelowCursorError | null = null;
  /** The span of the next range. */
  private chunkBlocks: number;
  /** The widest span the provider is believed to take, learned from refusals and probed again now and then. */
  private ceiling: number;
  private rangesAtCeiling = 0;
  private lastCursorWrite = 0;
  private readonly options: Required<IndexerOptions>;

  constructor(
    private readonly chain: ChainGateway,
    private readonly store: KeeperStore,
    private readonly runs: RunRecorder,
    private readonly log: Logger,
    options: IndexerOptions,
  ) {
    this.options = {
      minChunkBlocks: Math.min(MIN_CHUNK, options.maxChunkBlocks),
      maxChunksPerPass: 20,
      recipientsPerQuery: 100,
      startBlock: BigInt(DEPLOYMENT_4663.firstBlock),
      cursorWriteIntervalMs: 30_000,
      ...options,
    };
    this.chunkBlocks = this.options.maxChunkBlocks;
    this.ceiling = this.options.maxChunkBlocks;
  }

  /**
   * Reads the cursors and accounts the store holds. The streams move together, every write of a range done before
   * either cursor moves, so the lower stored cursor is where to resume.
   */
  async load(): Promise<void> {
    const cursors = await this.store.readCursors();
    const stored = STREAMS.map((stream) => cursors.get(stream)).filter((cursor) => cursor !== undefined);
    this.cursor = stored.reduce<Cursor | null>(
      (low, cursor) => (low === null || cursor.lastBlock < low.lastBlock ? cursor : low),
      null,
    );
    for (const account of await this.store.readAccounts()) this.accounts.set(account.address, account);
    this.log.info('index loaded', {
      cursor: this.cursor?.lastBlock ?? null,
      accounts: this.accounts.size,
      startBlock: this.options.startBlock,
    });
  }

  get lastIndexed(): IndexedBlock | null {
    return this.indexed;
  }

  get cursorBlock(): bigint | null {
    return this.cursor?.lastBlock ?? null;
  }

  get haltedBy(): ReorgBelowCursorError | null {
    return this.halted;
  }

  /** Indexes up to the confirmed head, at most maxChunksPerPass ranges. */
  async catchUp(head: HeadBlock, shouldStop: () => boolean = () => false): Promise<CatchUpResult> {
    if (this.halted !== null) throw this.halted;
    const target = head.number - BigInt(this.options.confirmations);
    let from = this.cursor === null ? this.options.startBlock : this.cursor.lastBlock + 1n;
    if (from > target) {
      await this.describeCursor();
      return { indexedTo: this.cursor?.lastBlock ?? null, ranges: 0, caughtUp: true };
    }
    await this.checkCursor();

    let ranges = 0;
    while (from <= target && ranges < this.options.maxChunksPerPass && !shouldStop()) {
      const span = BigInt(this.chunkBlocks);
      const to = from + span - 1n < target ? from + span - 1n : target;
      try {
        await this.indexRange(from, to);
      } catch (error) {
        const refused = Number(to - from + 1n);
        if (!(error instanceof LogRangeError) || refused <= this.options.minChunkBlocks) {
          throw error instanceof LogRangeError ? (error.cause ?? error) : error;
        }
        this.narrow(refused, from, to, error.cause);
        continue;
      }
      ranges += 1;
      from = to + 1n;
      this.widen();
    }
    return { indexedTo: this.cursor?.lastBlock ?? null, ranges, caughtUp: from > target };
  }

  /** A provider refused a span: halve it, and never go above the half again until a probe says otherwise. */
  private narrow(refused: number, from: bigint, to: bigint, cause: unknown): void {
    this.ceiling = Math.max(this.options.minChunkBlocks, Math.floor(refused / 2));
    this.chunkBlocks = this.ceiling;
    this.rangesAtCeiling = 0;
    this.log.warn('log range refused, narrowing', {
      from,
      to,
      chunkBlocks: this.chunkBlocks,
      error: formatFailure(describeFailure(cause)),
    });
  }

  /** Back up to the learned ceiling after a narrowed range, and probe a wider one after a long clean run. */
  private widen(): void {
    if (this.chunkBlocks < this.ceiling) {
      this.chunkBlocks = Math.min(this.ceiling, this.chunkBlocks * 2);
      return;
    }
    if (this.ceiling >= this.options.maxChunkBlocks) return;
    this.rangesAtCeiling += 1;
    if (this.rangesAtCeiling >= PROBE_AFTER_RANGES) {
      this.ceiling = Math.min(this.options.maxChunkBlocks, this.ceiling * 2);
      this.chunkBlocks = this.ceiling;
      this.rangesAtCeiling = 0;
    }
  }

  /** After a restart with nothing new to index, the stored cursor's block is what /health reports. */
  private async describeCursor(): Promise<void> {
    if (this.indexed !== null || this.cursor === null) return;
    const block = await this.chain.block(this.cursor.lastBlock);
    this.indexed = { number: block.number, hash: block.hash, timestamp: block.timestamp };
  }

  /** The block the cursor names must still have the hash it was indexed with. */
  private async checkCursor(): Promise<void> {
    if (this.cursor === null || this.cursor.lastBlockHash === null) return;
    const block = await this.chain.block(this.cursor.lastBlock);
    if (block.hash !== this.cursor.lastBlockHash.toLowerCase()) {
      this.halted = new ReorgBelowCursorError(this.cursor.lastBlock, this.cursor.lastBlockHash, block.hash);
      this.log.fatal('reorg below the index cursor; indexing stopped', {
        alert: 'REORG_BELOW_CURSOR',
        error: this.halted,
      });
      throw this.halted;
    }
  }

  private async fetchLogs(from: bigint, to: bigint): Promise<{ events: ModuleEvent[]; transfers: TransferLog[] }> {
    let moduleLogs;
    try {
      moduleLogs = await this.chain.moduleLogs(from, to);
    } catch (error) {
      throw new LogRangeError(error);
    }
    const events: ModuleEvent[] = [];
    for (const log of moduleLogs) {
      const event = decodeModuleLog(log);
      if (event !== null) events.push(event);
      else this.log.warn('module log with an unknown topic', { block: log.blockNumber, topic: log.topics[0] });
    }
    events.sort((a, b) => comparePositions(a.pos, b.pos));

    const recipients = transferRecipients(this.accounts, events);
    const transfers: TransferLog[] = [];
    for (let start = 0; start < recipients.length; start += this.options.recipientsPerQuery) {
      const batch = recipients.slice(start, start + this.options.recipientsPerQuery);
      let logs;
      try {
        logs = await this.chain.transferLogs(from, to, batch);
      } catch (error) {
        throw new LogRangeError(error);
      }
      transfers.push(...logs.map(decodeTransferLog));
    }
    transfers.sort((a, b) => comparePositions(a.pos, b.pos));
    return { events, transfers };
  }

  /** receiptHash(id) from the module for each receipt, which must equal keccak256 of the event's data. */
  private async checkedReceiptHashes(events: readonly ModuleEvent[]): Promise<Map<bigint, Hex>> {
    const receipts = events.flatMap((event) => (event.kind === 'ReceiptWritten' ? [event] : []));
    const stored = await Promise.all(receipts.map((event) => this.chain.receiptHash(event.receipt.id)));
    const hashes = new Map<bigint, Hex>();
    receipts.forEach((event, index) => {
      const onChain = stored[index];
      const fromData = keccak256(event.data);
      if (onChain === undefined || onChain.toLowerCase() !== fromData) {
        throw new IndexIntegrityError(
          'RECEIPT_HASH_MISMATCH',
          `receipt ${event.receipt.id}: the module stores ${onChain ?? 'nothing'}, ` +
            `but its event data hashes to ${fromData}`,
        );
      }
      hashes.set(event.receipt.id, fromData);
    });
    return hashes;
  }

  /** Indexes one range: its rows, then its cursor. A LogRangeError means it should be retried narrower. */
  private async indexRange(from: bigint, to: bigint): Promise<void> {
    const end = await this.chain.block(to);
    const { events, transfers } = await this.fetchLogs(from, to);
    const receiptHashes = await this.checkedReceiptHashes(events);

    const userOpBoundaries = new Map<Hex, readonly number[]>();
    for (const txHash of transactionsNeedingBoundaries(events, transfers)) {
      userOpBoundaries.set(txHash, userOperationBoundaries(await this.chain.transactionLogs(txHash)));
    }
    const blockTimestamps = new Map<bigint, bigint>();
    for (const blockNumber of new Set(transfers.map((transfer) => transfer.pos.blockNumber))) {
      blockTimestamps.set(blockNumber, (await this.chain.block(blockNumber)).timestamp);
    }

    const result = processChunk({
      fromBlock: from,
      toBlock: to,
      accounts: this.accounts,
      events,
      transfers,
      receiptHashes,
      userOpBoundaries,
      blockTimestamps,
      graceSeconds: MODULE_PARAMS.graceSeconds,
    });
    for (const skipped of result.skipped) this.log.debug('transfer not a payment', { ...skipped });

    const writes = hasWrites(result);
    const detail = {
      fromBlock: from,
      toBlock: to,
      moduleLogs: events.length,
      transfers: transfers.length,
      receipts: result.receipts.length,
      payments: result.payments.length,
      accounts: result.accounts.length,
    };
    const run = writes ? await this.runs.start('INDEX', {}, detail) : null;
    try {
      if (writes) await this.write(result);
      const again = await this.chain.block(to);
      if (again.hash !== end.hash) {
        throw new ReorgBelowCursorError(to, end.hash, again.hash);
      }
      await this.advance(end, writes);
    } catch (error) {
      if (error instanceof ReorgBelowCursorError) {
        this.halted = error;
        this.log.fatal('block changed while it was indexed; indexing stopped', { alert: 'REORG_BELOW_CURSOR', error });
      }
      await run?.finish({ outcome: 'FAILED', error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
    for (const account of result.accounts) this.accounts.set(account.address, account);
    await run?.finish({ outcome: 'SUCCEEDED', detail: { endHash: end.hash } });
    if (writes) this.log.info('indexed', detail);
  }

  /** Module rows first, then payments, which name accounts and receipts. */
  private async write(result: ChunkResult): Promise<void> {
    if (result.accounts.length > 0) await this.store.upsertAccounts(result.accounts);
    if (result.ruleVersions.length > 0) await this.store.upsertRuleVersions(result.ruleVersions);
    if (result.receipts.length > 0) await this.store.upsertReceipts(result.receipts);
    if (result.reconciliations.length > 0) await this.store.upsertReconciliations(result.reconciliations);
    if (result.payments.length > 0) await this.store.insertPayments(result.payments);
    for (const update of result.earlierPayments) await this.store.updateEarlierPayments(update);
  }

  private async advance(end: BlockRef, wrote: boolean): Promise<void> {
    const cursor: Cursor = { lastBlock: end.number, lastBlockHash: end.hash };
    const due = Date.now() - this.lastCursorWrite >= this.options.cursorWriteIntervalMs;
    if (wrote || due) {
      // Module logs up to a block before USDG transfers up to the same block (supabase/README.md, chain_cursor).
      await this.store.writeCursor('sleeve_module', cursor);
      await this.store.writeCursor('usdg_transfers', cursor);
      this.lastCursorWrite = Date.now();
    }
    this.cursor = cursor;
    this.indexed = { number: end.number, hash: end.hash, timestamp: end.timestamp };
  }
}

function hasWrites(result: ChunkResult): boolean {
  return (
    result.accounts.length > 0 ||
    result.ruleVersions.length > 0 ||
    result.receipts.length > 0 ||
    result.reconciliations.length > 0 ||
    result.payments.length > 0 ||
    result.earlierPayments.length > 0
  );
}

/** An eth_getLogs failure, which may mean the range was too wide for the provider. */
class LogRangeError extends Error {
  constructor(cause: unknown) {
    super('eth_getLogs failed', { cause });
    this.name = 'LogRangeError';
  }
}
