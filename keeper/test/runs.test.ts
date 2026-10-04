import { describe, expect, it } from 'vitest';

import { redactor } from '../src/app';
import { createLogger } from '../src/log';
import { RunRecorder } from '../src/runs';
import type { KeeperStore } from '../src/store/store';
import { MemoryStore } from './support/memory-store';

function recorder(store: KeeperStore, lines: string[] = [], now: () => Date = () => new Date('2026-10-04T00:00:00Z')): RunRecorder {
  return new RunRecorder({
    store,
    log: createLogger({ write: (line) => lines.push(line) }),
    redact: redactor(['xxxxxxxxxxxxxxxx']),
    now,
  });
}

describe('RunRecorder', () => {
  it('inserts a run when it starts and finishes it once', async () => {
    // #given
    const store = new MemoryStore();
    const run = await recorder(store).start('SPLIT', { account: '0xada0000000000000000000000000000000000001', tickerId: 0 }, { block: 1n });
    // #when
    await run.finish({ outcome: 'SUCCEEDED', txHash: `0x${'a'.repeat(64)}`, detail: { receiptId: 1n } });
    await run.finish({ outcome: 'FAILED', error: 'second finish' });
    // #then
    expect(store.runs.map((entry) => [entry.start.action, entry.finish?.outcome, entry.finish?.detail])).toEqual([
      ['SPLIT', 'SUCCEEDED', { block: 1n, receiptId: 1n }],
    ]);
  });

  it('scrubs secrets out of the error text bound for the database', async () => {
    // #given
    const store = new MemoryStore();
    const run = await recorder(store).start('SETTLE', {});
    // #when
    await run.finish({ outcome: 'FAILED', error: 'rpc: HTTP request failed. URL: https://rpc.example/v2/xxxxxxxxxxxxxxxx' });
    // #then
    expect(store.runs[0]?.finish?.error).toBe('rpc: HTTP request failed. URL: https://rpc.example/v2/[redacted]');
  });

  it('never lets the finish time come before the start time', async () => {
    // #given
    const store = new MemoryStore();
    let now = new Date('2026-10-04T00:00:10Z');
    const run = await recorder(store, [], () => now).start('INDEX', {});
    now = new Date('2026-10-04T00:00:05Z');
    // #when
    await run.finish({ outcome: 'SUCCEEDED' });
    // #then
    expect(store.runs[0]?.finish?.finishedAt.toISOString()).toBe('2026-10-04T00:00:10.000Z');
  });

  it('keeps going and logs the run when the store is down', async () => {
    // #given
    const store = new MemoryStore();
    store.startRun = async () => {
      throw new Error('supabase unreachable');
    };
    const lines: string[] = [];
    const run = await recorder(store, lines).start('SPLIT', { account: '0xada0000000000000000000000000000000000001' });
    // #when
    await run.finish({ outcome: 'SUCCEEDED', txHash: `0x${'b'.repeat(64)}` });
    // #then
    expect([run.runId, lines.map((line) => (JSON.parse(line) as { msg: string }).msg)]).toEqual([null, ['keeper run not recorded', 'keeper run']]);
  });
});
