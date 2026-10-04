import type { Address, Hex } from '@sleeve/core';

import type { Logger } from './log';
import type { KeeperAction, KeeperOutcome, KeeperStore } from './store/store';

export interface RunEnd {
  outcome: KeeperOutcome;
  txHash?: Hex | null;
  /** Required for REVERTED and FAILED. */
  error?: string | null;
  detail?: Readonly<Record<string, unknown>>;
}

export interface RunHandle {
  readonly runId: number | null;
  finish(end: RunEnd): Promise<void>;
}

export interface RunRecorderOptions {
  store: KeeperStore;
  log: Logger;
  /** Scrubs known secrets from text bound for the database. */
  redact: (text: string) => string;
  now?: () => Date;
}

/**
 * keeper_runs: one row per action, inserted when it starts and finished once. Every outcome is also a log line, so the
 * journal keeps the record when Supabase is down. A store failure never stops an action: the keeper splits and
 * settles from chain state, and the index catches up later.
 */
export class RunRecorder {
  private readonly store: KeeperStore;
  private readonly log: Logger;
  private readonly redact: (text: string) => string;
  private readonly now: () => Date;

  constructor(options: RunRecorderOptions) {
    this.store = options.store;
    this.log = options.log;
    this.redact = options.redact;
    this.now = options.now ?? (() => new Date());
  }

  async start(
    action: KeeperAction,
    target: { account?: Address; tickerId?: number },
    detail: Readonly<Record<string, unknown>> = {},
  ): Promise<RunHandle> {
    const startedAt = this.now();
    const account = target.account ?? null;
    const tickerId = target.tickerId ?? null;
    let runId: number | null = null;
    try {
      runId = await this.store.startRun({ action, account, tickerId, startedAt, detail });
    } catch (error) {
      this.log.error('keeper run not recorded', { action, account, tickerId, error });
    }
    let finished = false;

    const finish = async (end: RunEnd): Promise<void> => {
      if (finished) return;
      finished = true;
      const failed = end.outcome === 'REVERTED' || end.outcome === 'FAILED';
      const error = failed ? this.redact(end.error ?? 'no error message') : null;
      const now = this.now();
      const finishedAt = now < startedAt ? startedAt : now;
      const fullDetail = { ...detail, ...end.detail };
      const txHash = end.txHash ?? null;
      const fields = { action, account, tickerId, outcome: end.outcome, txHash, error, detail: fullDetail };
      if (end.outcome === 'FAILED' || end.outcome === 'REVERTED') this.log.warn('keeper run', fields);
      else this.log.info('keeper run', fields);
      if (runId === null) return;
      try {
        await this.store.finishRun(runId, { finishedAt, outcome: end.outcome, txHash, error, detail: fullDetail });
      } catch (storeError) {
        this.log.error('keeper run finish not recorded', { runId, action, error: storeError });
      }
    };

    return { runId, finish };
  }
}
