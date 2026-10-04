import type { Address } from '@sleeve/core';

import type {
  AccountRecord,
  BucketWaitRecord,
  Cursor,
  EarlierPaymentsUpdate,
  InstallPosition,
  KeeperStore,
  PaymentRecord,
  ReceiptRecord,
  ReconciliationRecord,
  RuleVersionRecord,
  RunFinish,
  RunStart,
  StreamName,
} from '../../src/store/store';

export interface MemoryRun {
  runId: number;
  start: RunStart;
  finish: RunFinish | null;
}

/**
 * A KeeperStore held in memory for tests of the keeper loop, which care about what it recorded, not about the
 * database rules. The production store is tested against the migration in test/store.
 */
export class MemoryStore implements KeeperStore {
  cursors = new Map<StreamName, Cursor>();
  accounts = new Map<Address, AccountRecord>();
  ruleVersions: RuleVersionRecord[] = [];
  receipts: ReceiptRecord[] = [];
  reconciliations: ReconciliationRecord[] = [];
  payments: PaymentRecord[] = [];
  earlierUpdates: EarlierPaymentsUpdate[] = [];
  runs: MemoryRun[] = [];
  waits = new Map<string, BucketWaitRecord>();
  seen: { accounts: readonly Address[]; block: bigint }[] = [];
  oldestPayment: bigint | null = null;

  async readCursors(): Promise<Map<StreamName, Cursor>> {
    return new Map(this.cursors);
  }

  async writeCursor(stream: StreamName, cursor: Cursor): Promise<void> {
    this.cursors.set(stream, cursor);
  }

  async readAccounts(): Promise<AccountRecord[]> {
    return [...this.accounts.values()];
  }

  async upsertAccounts(accounts: readonly AccountRecord[]): Promise<void> {
    for (const account of accounts) this.accounts.set(account.address, account);
  }

  async upsertRuleVersions(rows: readonly RuleVersionRecord[]): Promise<void> {
    this.ruleVersions.push(...rows);
  }

  async upsertReceipts(rows: readonly ReceiptRecord[]): Promise<void> {
    this.receipts.push(...rows);
  }

  async upsertReconciliations(rows: readonly ReconciliationRecord[]): Promise<void> {
    this.reconciliations.push(...rows);
  }

  async insertPayments(rows: readonly PaymentRecord[]): Promise<void> {
    this.payments.push(...rows);
  }

  async updateEarlierPayments(update: EarlierPaymentsUpdate): Promise<void> {
    this.earlierUpdates.push(update);
  }

  async oldestWaitingPayment(_account: Address, _epoch: InstallPosition): Promise<bigint | null> {
    return this.oldestPayment;
  }

  async markAccountsSeen(accounts: readonly Address[], block: bigint): Promise<void> {
    this.seen.push({ accounts, block });
  }

  async startRun(run: RunStart): Promise<number> {
    const runId = this.runs.length + 1;
    this.runs.push({ runId, start: run, finish: null });
    return runId;
  }

  async finishRun(runId: number, finish: RunFinish): Promise<void> {
    const run = this.runs.find((candidate) => candidate.runId === runId);
    if (run === undefined) throw new Error(`no run ${runId}`);
    if (run.finish !== null) throw new Error(`run ${runId} finished twice`);
    if ((finish.outcome === 'REVERTED' || finish.outcome === 'FAILED') !== (finish.error !== null)) {
      throw new Error(`run ${runId}: error must be set exactly for REVERTED and FAILED`);
    }
    if (finish.outcome === 'REVERTED' && finish.txHash === null) throw new Error(`run ${runId}: REVERTED needs a tx hash`);
    run.finish = finish;
  }

  actionRuns(): MemoryRun[] {
    return this.runs.filter((run) => run.start.action !== 'INDEX');
  }

  async readBucketWaits(): Promise<BucketWaitRecord[]> {
    return [...this.waits.values()];
  }

  async upsertBucketWait(row: BucketWaitRecord): Promise<void> {
    this.waits.set(`${row.account}:${row.tickerId}`, row);
  }

  async deleteBucketWait(account: Address, tickerId: number): Promise<void> {
    this.waits.delete(`${account}:${tickerId}`);
  }

  /** The keeper's action runs, not the indexer's, as [action, outcome, skipped or error] for compact assertions. */
  summary(): [string, string | null, string | null][] {
    return this.actionRuns().map((run) => [
      run.start.action,
      run.finish?.outcome ?? null,
      (run.start.detail.skipped as string | undefined) ?? run.finish?.error ?? null,
    ]);
  }
}
