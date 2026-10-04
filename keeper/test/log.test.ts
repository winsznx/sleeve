import { HttpRequestError } from 'viem';
import { describe, expect, it } from 'vitest';

import { StoreError } from '../src/errors';
import { createLogger, serializeError, urlSecrets } from '../src/log';

function capture(level?: 'debug' | 'info' | 'warn', secrets: string[] = []): { lines: Record<string, unknown>[]; raw: string[]; log: ReturnType<typeof createLogger> } {
  const raw: string[] = [];
  const log = createLogger({ level, secrets, write: (line) => raw.push(line), now: () => new Date('2026-10-04T00:00:00Z') });
  return {
    raw,
    log,
    get lines() {
      return raw.map((line) => JSON.parse(line) as Record<string, unknown>);
    },
  };
}

describe('createLogger', () => {
  it('writes one JSON object per line with time, level, msg and fields, bigints as strings', () => {
    // #given
    const out = capture();
    // #when
    out.log.child({ account: '0xabc' }).info('split decision', { block: 79_338_373n, unsorted: 10_000_000n });
    // #then
    expect(out.lines).toEqual([
      { time: '2026-10-04T00:00:00.000Z', level: 'info', msg: 'split decision', account: '0xabc', block: '79338373', unsorted: '10000000' },
    ]);
  });

  it('drops lines under its level', () => {
    // #given
    const out = capture('warn');
    // #when
    out.log.info('quiet');
    out.log.debug('quieter');
    out.log.error('loud');
    // #then
    expect(out.lines.map((line) => line.msg)).toEqual(['loud']);
  });

  it('scrubs the RPC key and the service key wherever a library quotes them', () => {
    // #given
    const rpc = 'https://rpc.example/v2/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
    const serviceKey = 'yyyyyyyyyyyyyyyyyyyyyyyy';
    const out = capture('info', [...urlSecrets(rpc), serviceKey]);
    const error = new HttpRequestError({ url: rpc, body: { method: 'eth_call' }, details: 'socket hang up' });
    // #when
    out.log.error('rpc failed', { error, header: `Bearer ${serviceKey}` });
    // #then
    const line = out.raw.join('\n');
    expect(line).not.toContain('xxxxxxxxxxxxxxxx');
    expect(line).not.toContain(serviceKey);
    expect(line).toContain('[redacted]');
  });

  it('serializes named errors with their codes and causes', () => {
    // #when
    const fields = serializeError(new StoreError('upsertReceipts', '23514', 'receipts_in_sequence: the index holds 4', 'receipts_in_sequence'));
    // #then
    expect(fields).toMatchObject({
      name: 'StoreError',
      code: 'STORE_FAILED',
      pgCode: '23514',
      rule: 'receipts_in_sequence',
      operation: 'upsertReceipts',
    });
  });
});

describe('urlSecrets', () => {
  it('keeps the path and query, where providers put the key', () => {
    // #when
    const secrets = urlSecrets('https://node.example/v2/zzzzzzzzzzzz?token=wwwwwwwwwwww');
    // #then
    expect(secrets).toContain('/v2/zzzzzzzzzzzz?token=wwwwwwwwwwww');
  });
});
