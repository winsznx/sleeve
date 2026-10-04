import { type Address, type Hex, type SessionType, ZERO_ADDRESS, sessionIsOpen, sessionOpenedAt } from '@sleeve/core';

import type { KeeperCall } from './chain/calls';
import type { ChainGateway, HeadBlock, SplitPreview, TickerState } from './chain/gateway';
import { isKernelV31Account } from './chain/kernel';
import { type CallFailure, describeFailure, formatFailure, guardReason } from './chain/revert';
import { KeeperError, ReorgBelowCursorError, TxTimeoutError } from './errors';
import type { HealthState } from './health';
import type { Indexer } from './index/indexer';
import type { Logger } from './log';
import type { Market } from './market';
import { NO_SWAP_QUOTE, quotePerMillion } from './policy/pools';
import {
  type SessionView,
  type SettleMemory,
  type SettleOutcome,
  type WaitReason,
  planSettle,
  settleEvaluationDue,
} from './policy/settle';
import { decideSplit, waitingSince } from './policy/split';
import { SkipJournal, nextBucketWait } from './policy/waits';
import type { RunRecorder } from './runs';
import type { AccountRecord, BucketWaitRecord, KeeperOutcome, KeeperStore } from './store/store';
import { type ActionKind, confirmAction } from './tx/postcondition';
import type { TxSender } from './tx/sender';

export interface KeeperSettings {
  /** The keeper's address: accounts whose keeperOf is this are served. */
  keeper: Address;
  dryRun: boolean;
  gasCeilingWei: bigint;
  /** No transaction is priced above this; a base fee above it holds every send. */
  maxFeeWei: bigint;
  minBalanceWei: bigint;
}

export interface KeeperParts {
  chain: ChainGateway;
  store: KeeperStore;
  indexer: Indexer;
  market: Market;
  runs: RunRecorder;
  /** Null in dry-run mode, which never signs. */
  sender: TxSender | null;
  health: HealthState;
  log: Logger;
  now?: () => Date;
}

export type KeeperActionName = 'SPLIT' | 'SETTLE';

export interface ActionReport {
  action: KeeperActionName;
  account: Address;
  tickerId: number | null;
  outcome: KeeperOutcome;
  txHash: Hex | null;
  detail: Record<string, unknown>;
}

export interface PassReport {
  head: bigint;
  indexedTo: bigint | null;
  actions: ActionReport[];
  errors: string[];
}

/** Errors a simulation can return that mean "not now" rather than "broken" (SPEC 9, 10). */
const WAIT_ERRORS = new Set([
  'OwnerOpOpen',
  'RuleNotActive',
  'ModuleNotListed',
  'AccountLocked',
  'BelowClip',
  'LedgersAboveBalance',
  'EmptyBucket',
  'NotInstalled',
  'GracePeriodActive',
]);

const KERNEL_CHECK_MS = 600_000;
const SEEN_WRITE_MS = 300_000;
const BALANCE_ALERT_MS = 600_000;
const CALENDAR_CHECK_MS = 3_600_000;
/** Alert this long before the calendar extension's coverage ends (audit A1-36, D-017). */
const CALENDAR_WARNING_SECONDS = 30n * 86_400n;
const MAX_ATTEMPTS = 3;

interface AccountMemory {
  firstSeenUnsorted: bigint | null;
  lastSeenEmpty: bigint | null;
  kernel: { ok: boolean; checkedAt: number } | null;
}

type Simulation =
  | { kind: 'ready'; call: KeeperCall; receiptId: bigint; pool: Address; quote: bigint }
  | { kind: 'wait'; reason: WaitReason | null; failure: CallFailure }
  | { kind: 'fail'; error: string; failure: CallFailure | null };

interface TriggerRequest {
  kind: ActionKind;
  account: Address;
  tickerId: number;
  /** USDG the swap would spend: the equity part or the bucket. */
  amountIn: bigint;
  /** Whether the preview says a swap runs, so a real quote is required. */
  swaps: boolean;
  head: HeadBlock;
  detail: Record<string, unknown>;
}

interface TriggerResult {
  outcome: KeeperOutcome;
  waitReason: WaitReason | null;
}

/** The packages/core calendar's view of a session at a chain time. */
export function sessionView(sessionType: SessionType, now: bigint): SessionView {
  if (!sessionIsOpen(now, sessionType).open) return { open: false, openedAt: null };
  try {
    return { open: true, openedAt: sessionOpenedAt(now, sessionType) };
  } catch {
    return { open: false, openedAt: null };
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * One keeper pass: index to the confirmed head, then for every installed account whose keeper is this key, split
 * new income and settle waiting buckets when the guard clears, each simulated first and confirmed from chain state.
 * It calls nothing but split and settle (chain/calls.ts).
 */
export class Keeper {
  private readonly accountMemory = new Map<Address, AccountMemory>();
  private readonly settleMemory = new Map<string, SettleMemory>();
  private readonly waits = new Map<string, BucketWaitRecord>();
  private readonly skips = new SkipJournal();
  private readonly now: () => Date;
  private lastSeenWrite = 0;
  private lastBalanceAlert = 0;
  private lastCalendarCheck = 0;

  constructor(
    private readonly settings: KeeperSettings,
    private readonly parts: KeeperParts,
  ) {
    this.now = parts.now ?? (() => new Date());
  }

  /** Loads the index and the open bucket waits, and reads the market once. */
  async start(): Promise<void> {
    await this.parts.indexer.load();
    for (const wait of await this.parts.store.readBucketWaits()) {
      this.waits.set(waitKey(wait.account, wait.tickerId), wait);
    }
    await this.parts.market.refresh(true);
  }

  async pass(shouldStop: () => boolean = () => false): Promise<PassReport> {
    const { chain, market, health, log } = this.parts;
    const head = await chain.head();
    health.chainHead = { number: head.number, timestamp: head.timestamp };
    const report: PassReport = { head: head.number, indexedTo: null, actions: [], errors: [] };

    await this.index(head, report, shouldStop);
    await market.refresh();
    await market.pollFeeds();

    const served = this.servedAccounts();
    health.accountsTracked = served.length;
    for (const account of served) {
      if (shouldStop()) break;
      try {
        await this.serve(account, head, report);
      } catch (error) {
        log.error('account pass failed', { account: account.address, block: head.number, error });
        report.errors.push(`${account.address}: ${message(error)}`);
      }
    }

    await this.checkBalance();
    await this.checkCalendar(head);
    // The index follows the keeper's own transactions in the same pass when the confirmation depth allows it.
    if (report.actions.some((action) => action.txHash !== null)) {
      await this.index(await chain.head(), report, shouldStop);
    }
    await this.markSeen(served, head);

    health.lastPassAt = this.now();
    health.lastPassError = report.errors[0] ?? null;
    return report;
  }

  /** Runs passes until the signal aborts, backing off after failed passes. */
  async run(signal: AbortSignal, pollMs: number): Promise<void> {
    let failures = 0;
    while (!signal.aborted) {
      const started = Date.now();
      try {
        await this.pass(() => signal.aborted);
        failures = 0;
      } catch (error) {
        failures += 1;
        this.parts.health.lastPassError = message(error);
        this.parts.log.error('pass failed', { failures, error });
      }
      const wait = failures === 0 ? pollMs : Math.min(60_000, pollMs * 2 ** Math.min(failures, 6));
      await sleep(Math.max(0, wait - (Date.now() - started)), signal);
    }
  }

  private async index(head: HeadBlock, report: PassReport, shouldStop: () => boolean): Promise<void> {
    const { indexer, health, log } = this.parts;
    try {
      const result = await indexer.catchUp(head, shouldStop);
      report.indexedTo = result.indexedTo;
    } catch (error) {
      if (error instanceof ReorgBelowCursorError) health.halted = error.message;
      log.error('indexing failed', { block: head.number, error });
      report.errors.push(`index: ${message(error)}`);
    }
    const indexed = indexer.lastIndexed;
    health.indexed = indexed === null ? null : { number: indexed.number, timestamp: indexed.timestamp };
  }

  /** Installed accounts whose keeper, as indexed, is this key. The live keeperOf is checked again before acting. */
  private servedAccounts(): AccountRecord[] {
    const keeper = this.settings.keeper.toLowerCase();
    return [...this.parts.indexer.accounts.values()]
      .filter((account) => account.uninstalledAtBlock === null && account.keeper === keeper)
      .sort((a, b) => (a.address < b.address ? -1 : 1));
  }

  private memoryOf(account: Address): AccountMemory {
    let memory = this.accountMemory.get(account);
    if (memory === undefined) {
      memory = { firstSeenUnsorted: null, lastSeenEmpty: null, kernel: null };
      this.accountMemory.set(account, memory);
    }
    return memory;
  }

  /** A Kernel v3.1 account (audit A1-23), checked again every ten minutes since the implementation can change. */
  private async isKernel(account: Address): Promise<boolean> {
    const memory = this.memoryOf(account);
    if (memory.kernel !== null && Date.now() - memory.kernel.checkedAt < KERNEL_CHECK_MS) return memory.kernel.ok;
    const [code, implementation] = await Promise.all([
      this.parts.chain.code(account),
      this.parts.chain.implementationOf(account),
    ]);
    const ok = isKernelV31Account(code, implementation);
    memory.kernel = { ok, checkedAt: Date.now() };
    return ok;
  }

  private async serve(record: AccountRecord, head: HeadBlock, report: PassReport): Promise<void> {
    const { chain, log } = this.parts;
    const account = record.address;
    const [keeperOf, listed, bracketOpen] = await Promise.all([
      chain.keeperOf(account),
      chain.isModuleListed(account),
      chain.ownerOpOpen(account),
    ]);
    if (keeperOf !== this.settings.keeper.toLowerCase()) {
      log.debug('not this keeper', { account, keeperOf, block: head.number });
      return;
    }
    let skip: string | null = null;
    if (!listed) skip = 'MODULE_NOT_LISTED';
    else if (!(await this.isKernel(account))) skip = 'NOT_KERNEL_V31';
    else if (bracketOpen) skip = 'OWNER_OP_OPEN';
    if (skip !== null) {
      await this.recordSkip('SPLIT', account, null, skip, { block: head.number });
      return;
    }

    const preview = await chain.previewSplit(account);
    this.trackUnsorted(account, preview, head.timestamp);
    await this.maybeSplit(record, preview, head, report);
    // Read after the split: a split that queues fills a bucket, one that reconciles can shrink them.
    const ledger = await chain.ledger(account);
    await this.settleBuckets(record, ledger.pendingTotal, head, report);
  }

  private trackUnsorted(account: Address, preview: SplitPreview, now: bigint): void {
    const memory = this.memoryOf(account);
    if (preview.unsorted === 0n && preview.shortfall === 0n) {
      memory.lastSeenEmpty = now;
      memory.firstSeenUnsorted = null;
    } else if (preview.unsorted > 0n && memory.firstSeenUnsorted === null) {
      memory.firstSeenUnsorted = now;
    }
  }

  private async oldestPayment(record: AccountRecord): Promise<bigint | null> {
    try {
      return await this.parts.store.oldestWaitingPayment(record.address, record.installedAt);
    } catch (error) {
      this.parts.log.warn('oldest payment not read', { account: record.address, error });
      return null;
    }
  }

  private async maybeSplit(
    record: AccountRecord,
    preview: SplitPreview,
    head: HeadBlock,
    report: PassReport,
  ): Promise<void> {
    const account = record.address;
    const memory = this.memoryOf(account);
    const needsAge = preview.ruleStatus === 'ACTIVE' && preview.shortfall === 0n && preview.unsorted > 0n;
    const since = waitingSince({
      oldestPayment: needsAge ? await this.oldestPayment(record) : null,
      firstSeenUnsorted: memory.firstSeenUnsorted,
      lastSeenEmpty: memory.lastSeenEmpty,
    });
    const decision = decideSplit({
      preview,
      baseFeePerGas: head.baseFeePerGas,
      gasCeilingWei: this.settings.gasCeilingWei,
      now: head.timestamp,
      waitingSince: since,
    });
    const detail = {
      block: head.number,
      baseFeePerGas: head.baseFeePerGas,
      gasCeilingWei: this.settings.gasCeilingWei,
      unsorted: preview.unsorted,
      shortfall: preview.shortfall,
      equityPart: preview.equityPart,
      preview: { status: preview.status, reason: preview.reason, buy: preview.buy },
      decision,
    };
    if (decision.kind === 'none') {
      this.parts.log.debug('split decision', { account, ...detail });
      return;
    }
    if (decision.kind === 'hold') {
      // A hold is logged through its keeper_runs row, once when it starts or changes and then hourly.
      await this.recordSkip('SPLIT', account, preview.tickerId, decision.why, detail);
      return;
    }
    this.parts.log.info('split decision', { account, ...detail });
    this.skips.clear(`SPLIT:${account}`);
    await this.trigger(
      {
        kind: decision.mode === 'RECONCILE' ? 'RECONCILE' : 'SORT',
        account,
        tickerId: preview.tickerId,
        amountIn: decision.mode === 'RECONCILE' ? 0n : preview.equityPart,
        swaps: decision.mode === 'SORT' && preview.buy,
        head,
        detail,
      },
      report,
    );
  }

  private async settleBuckets(
    record: AccountRecord,
    pendingTotal: bigint,
    head: HeadBlock,
    report: PassReport,
  ): Promise<void> {
    const account = record.address;
    const tickers = this.parts.market.allTickers();
    if (pendingTotal === 0n) {
      for (const ticker of tickers) await this.clearWait(account, ticker.id);
      return;
    }
    const buckets = await Promise.all(tickers.map((ticker) => this.parts.chain.bucketOf(account, ticker.id)));
    for (const [index, ticker] of tickers.entries()) {
      const bucket = buckets[index];
      if (bucket === undefined) continue;
      if (bucket.amount === 0n) await this.clearWait(account, ticker.id);
      else await this.maybeSettle(record, ticker, bucket, head, report);
    }
  }

  private async maybeSettle(
    record: AccountRecord,
    ticker: TickerState,
    bucket: { amount: bigint; since: bigint },
    head: HeadBlock,
    report: PassReport,
  ): Promise<void> {
    const { chain, market, log } = this.parts;
    const account = record.address;
    const key = waitKey(account, ticker.id);
    const session = sessionView(ticker.sessionType, head.timestamp);
    const round = market.round(ticker.feed);
    const due = settleEvaluationDue({
      bucket,
      ruleVersion: record.rule.version,
      memory: this.settleMemory.get(key),
      now: head.timestamp,
      session,
      round,
    });
    if (!due.due) {
      log.debug('settle not due', { account, tickerId: ticker.id, block: head.number, why: due.why });
      return;
    }
    const plan = planSettle(await chain.previewSettle(account, ticker.id));
    const remember = (outcome: SettleOutcome): void => {
      this.settleMemory.set(key, {
        at: head.timestamp,
        amount: bucket.amount,
        since: bucket.since,
        ruleVersion: record.rule.version,
        outcome,
        roundId: round?.roundId ?? null,
        sessionOpen: session.open,
      });
    };
    const decision = { account, tickerId: ticker.id, block: head.number, why: due.why, plan };
    if (plan.kind === 'skip') {
      log.debug('settle decision', decision);
      if (plan.why === 'EMPTY') await this.clearWait(account, ticker.id);
      remember('FAILED');
      return;
    }
    if (plan.kind === 'wait') {
      log.debug('settle decision', decision);
      remember(plan.reason);
      await this.recordWait(account, ticker.id, plan.reason, bucket.since, head.timestamp);
      return;
    }
    log.info('settle decision', decision);
    const result = await this.trigger(
      {
        kind: 'SETTLE',
        account,
        tickerId: ticker.id,
        amountIn: bucket.amount,
        swaps: plan.expect === 'SETTLED',
        head,
        detail: { block: head.number, bucket, expect: plan.expect, why: due.why, round },
      },
      report,
    );
    if (result.outcome === 'SUCCEEDED') {
      this.settleMemory.delete(key);
      await this.clearWait(account, ticker.id);
    } else if (result.waitReason !== null) {
      remember(result.waitReason);
      await this.recordWait(account, ticker.id, result.waitReason, bucket.since, head.timestamp);
    } else {
      remember('FAILED');
    }
  }

  /** Picks a pool, quotes it and simulates the call, moving to the next pool on PoolBlocked (D-011). */
  private async simulate(request: TriggerRequest): Promise<Simulation> {
    const { chain, market } = this.parts;
    const unusable = market.unusableReason(request.tickerId);
    if (unusable !== null && request.swaps) return { kind: 'fail', error: unusable, failure: null };
    let pools = await market.poolsFor(request.tickerId);
    const excluded = new Set<Address>();
    let lastFailure: CallFailure | null = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const best =
        request.amountIn > 0n ? await market.best(request.tickerId, pools, request.amountIn, excluded) : null;
      let pool: Address;
      let quote: bigint;
      if (best !== null && best.amountOut !== null) {
        pool = best.pool;
        quote = quotePerMillion(request.amountIn, best.amountOut);
      } else if (!request.swaps) {
        pool = pools.find((candidate) => !excluded.has(candidate.address))?.address ?? ZERO_ADDRESS;
        quote = NO_SWAP_QUOTE;
      } else {
        return { kind: 'fail', error: `no allowlisted pool quoted ${request.amountIn} USDG`, failure: lastFailure };
      }
      if (quote === 0n) quote = NO_SWAP_QUOTE;
      const call: KeeperCall =
        request.kind === 'SETTLE'
          ? { fn: 'settle', account: request.account, tickerId: request.tickerId, pool, quote }
          : { fn: 'split', account: request.account, pool, quote };
      try {
        const receiptId = await chain.simulate(call, this.settings.keeper);
        return { kind: 'ready', call, receiptId, pool, quote };
      } catch (error) {
        const failure = describeFailure(error);
        lastFailure = failure;
        if (failure.kind === 'rpc') return { kind: 'fail', error: formatFailure(failure), failure };
        if (failure.name === 'PoolBlocked') {
          excluded.add(pool);
          continue;
        }
        if (failure.name === 'PoolNotAllowed') {
          await market.refresh(true);
          pools = await market.poolsFor(request.tickerId);
          continue;
        }
        if (failure.name === 'TooFewTokens') continue;
        if (failure.name === 'GuardNotClear') {
          return { kind: 'wait', reason: guardReason(failure) as WaitReason | null, failure };
        }
        if (failure.name !== null && WAIT_ERRORS.has(failure.name)) return { kind: 'wait', reason: null, failure };
        return { kind: 'fail', error: formatFailure(failure), failure };
      }
    }
    const last = lastFailure === null ? 'none' : formatFailure(lastFailure);
    return { kind: 'fail', error: `no pool cleared after ${MAX_ATTEMPTS} attempts: ${last}`, failure: lastFailure };
  }

  private async trigger(request: TriggerRequest, report: PassReport): Promise<TriggerResult> {
    const { log, runs, chain } = this.parts;
    const action: KeeperActionName = request.kind === 'SETTLE' ? 'SETTLE' : 'SPLIT';
    const tickerId = request.kind === 'SETTLE' ? request.tickerId : null;
    const target = { account: request.account, tickerId: tickerId ?? undefined };
    const journalKey = `${action}:${request.account}:${tickerId ?? ''}`;
    const base = { ...request.detail, kind: request.kind };
    const noted = (outcome: KeeperOutcome, txHash: Hex | null, detail: Record<string, unknown>): TriggerResult => {
      this.note(report, { action, account: request.account, tickerId, outcome, txHash, detail });
      return { outcome, waitReason: null };
    };

    if (request.head.baseFeePerGas > this.settings.maxFeeWei) {
      // No price within the cap exists, so nothing is simulated or sent until the base fee falls.
      const detail = { ...base, maxFeeWei: this.settings.maxFeeWei };
      await this.recordSkip(action, request.account, tickerId, 'FEE_ABOVE_CAP', detail);
      return noted('SKIPPED', null, { ...detail, skipped: 'FEE_ABOVE_CAP' });
    }

    const simulation = await this.simulate(request);
    if (simulation.kind === 'wait' || simulation.kind === 'fail') {
      const outcome: KeeperOutcome = simulation.kind === 'wait' ? 'SKIPPED' : 'FAILED';
      const why =
        simulation.kind === 'fail'
          ? simulation.error
          : simulation.failure.kind === 'revert'
            ? formatFailure(simulation.failure)
            : 'wait';
      const detail = { ...base, simulation: why };
      if (this.skips.shouldRecord(journalKey, why)) {
        const run = await runs.start(action, target, detail);
        await run.finish({ outcome, error: outcome === 'FAILED' ? why : null });
      }
      noted(outcome, null, detail);
      return { outcome, waitReason: simulation.kind === 'wait' ? simulation.reason : null };
    }

    const simulated = {
      ...base,
      pool: simulation.pool,
      quote: simulation.quote,
      simulatedReceiptId: simulation.receiptId,
    };
    const sender = this.parts.sender;
    if (this.settings.dryRun || sender === null) {
      const detail = { ...simulated, dryRun: true };
      if (this.skips.shouldRecord(journalKey, `dry-run:${simulation.receiptId}`)) {
        const run = await runs.start(action, target, detail);
        await run.finish({ outcome: 'SKIPPED' });
      }
      log.info('dry run: would send', { action, account: request.account, block: request.head.number, ...detail });
      return noted('SKIPPED', null, detail);
    }

    this.skips.clear(journalKey);
    const run = await runs.start(action, target, simulated);
    let txHash: Hex | null = null;
    try {
      const mined = await sender.send(simulation.call, request.head.baseFeePerGas);
      txHash = mined.txHash;
      if (mined.receipt.status !== 'success') {
        const reason = await this.revertReason(simulation.call, mined.receipt.blockNumber);
        await run.finish({ outcome: 'REVERTED', txHash, error: reason, detail: { gasUsed: mined.receipt.gasUsed } });
        return noted('REVERTED', txHash, simulated);
      }
      const confirmed = await confirmAction(chain, request.kind, simulation.call, mined.receipt);
      const detail = {
        receiptId: confirmed.receipt.id,
        status: confirmed.receipt.status,
        reason: confirmed.receipt.reason,
        usdgIn: confirmed.receipt.usdgIn,
        usdgSpent: confirmed.receipt.usdgSpent,
        usdgQueued: confirmed.receipt.usdgQueued,
        tokensOut: confirmed.receipt.tokensOut,
        premiumBps: confirmed.receipt.premiumBps,
        gasUsed: confirmed.gasUsed,
        effectiveGasPrice: confirmed.effectiveGasPrice,
        stateAtBlock: confirmed.stateAtBlock,
        nonce: mined.nonce,
      };
      await run.finish({ outcome: 'SUCCEEDED', txHash, detail });
      return noted('SUCCEEDED', txHash, { ...simulated, ...detail });
    } catch (error) {
      const hash = error instanceof TxTimeoutError ? (error.txHash as Hex) : txHash;
      // The keeper's own errors carry their message; anything else is a revert or an RPC failure to decode.
      const reason = error instanceof KeeperError ? error.message : formatFailure(describeFailure(error));
      await run.finish({ outcome: 'FAILED', txHash: hash, error: reason });
      return noted('FAILED', hash, { ...simulated, error: reason });
    }
  }

  /** Why a mined call reverted, from the same call simulated again now. Best effort: state may have moved since. */
  private async revertReason(call: KeeperCall, blockNumber: bigint): Promise<string> {
    try {
      await this.parts.chain.simulate(call, this.settings.keeper);
      return `reverted on chain at block ${blockNumber}; a simulation now succeeds`;
    } catch (error) {
      return `reverted on chain at block ${blockNumber}: ${formatFailure(describeFailure(error))}`;
    }
  }

  private note(report: PassReport, action: ActionReport): void {
    report.actions.push(action);
    this.parts.health.lastAction = {
      action: action.action,
      account: action.account,
      tickerId: action.tickerId,
      outcome: action.outcome,
      txHash: action.txHash,
      at: this.now(),
    };
  }

  /** A SKIPPED run for a hold that lasts, recorded when it starts or changes and then hourly. */
  private async recordSkip(
    action: KeeperActionName,
    account: Address,
    tickerId: number | null,
    why: string,
    detail: Record<string, unknown>,
  ): Promise<void> {
    if (!this.skips.shouldRecord(`${action}:${account}`, why)) return;
    const run = await this.parts.runs.start(action, { account, tickerId: tickerId ?? undefined }, {
      ...detail,
      skipped: why,
    });
    await run.finish({ outcome: 'SKIPPED' });
  }

  private async recordWait(
    account: Address,
    tickerId: number,
    reason: WaitReason,
    since: bigint,
    now: bigint,
  ): Promise<void> {
    const key = waitKey(account, tickerId);
    const update = nextBucketWait(this.waits.get(key), { account, tickerId, reason, bucketSince: since, now });
    this.waits.set(key, update.row);
    if (!update.write) return;
    try {
      await this.parts.store.upsertBucketWait(update.row);
    } catch (error) {
      this.parts.log.error('bucket wait not recorded', { account, tickerId, reason, error });
    }
  }

  private async clearWait(account: Address, tickerId: number): Promise<void> {
    const key = waitKey(account, tickerId);
    this.settleMemory.delete(key);
    if (!this.waits.has(key)) return;
    this.waits.delete(key);
    try {
      await this.parts.store.deleteBucketWait(account, tickerId);
    } catch (error) {
      this.parts.log.error('bucket wait not cleared', { account, tickerId, error });
    }
  }

  private async checkBalance(): Promise<void> {
    const { chain, health, log } = this.parts;
    const balance = await chain.balance(this.settings.keeper);
    health.ethBalanceWei = balance;
    if (balance >= this.settings.minBalanceWei) {
      health.alerts.delete('LOW_BALANCE');
      return;
    }
    health.alerts.set('LOW_BALANCE', `keeper balance ${balance} wei is under ${this.settings.minBalanceWei} wei`);
    if (Date.now() - this.lastBalanceAlert >= BALANCE_ALERT_MS) {
      this.lastBalanceAlert = Date.now();
      log.warn('keeper balance low', {
        alert: 'LOW_BALANCE',
        balanceWei: balance,
        minBalanceWei: this.settings.minBalanceWei,
      });
    }
  }

  /** Alerts 30 days before the calendar extension's coverage ends, and once it has (audit A1-36). */
  private async checkCalendar(head: HeadBlock): Promise<void> {
    if (Date.now() - this.lastCalendarCheck < CALENDAR_CHECK_MS) return;
    const { chain, health, log } = this.parts;
    const coverageEnd = await chain.calendarCoverageEnd();
    this.lastCalendarCheck = Date.now();
    health.alerts.delete('CALENDAR_COVERAGE');
    health.alerts.delete('CALENDAR_EXPIRED');
    if (head.timestamp >= coverageEnd) {
      health.alerts.set(
        'CALENDAR_EXPIRED',
        `the session calendar ended at ${coverageEnd}; SESSION waits now mean the calendar expired`,
      );
      log.error('session calendar expired', { alert: 'CALENDAR_EXPIRED', coverageEnd, block: head.number });
    } else if (coverageEnd - head.timestamp < CALENDAR_WARNING_SECONDS) {
      health.alerts.set('CALENDAR_COVERAGE', `the session calendar ends at ${coverageEnd}; schedule the next year`);
      log.warn('session calendar ends soon', { alert: 'CALENDAR_COVERAGE', coverageEnd, block: head.number });
    }
  }

  private async markSeen(accounts: readonly AccountRecord[], head: HeadBlock): Promise<void> {
    if (accounts.length === 0 || Date.now() - this.lastSeenWrite < SEEN_WRITE_MS) return;
    this.lastSeenWrite = Date.now();
    try {
      const addresses = accounts.map((account) => account.address);
      await this.parts.store.markAccountsSeen(addresses, head.number, this.now());
    } catch (error) {
      this.parts.log.warn('accounts seen not recorded', { error });
    }
  }
}

function waitKey(account: Address, tickerId: number): string {
  return `${account.toLowerCase()}:${tickerId}`;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}
