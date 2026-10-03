import { HttpRequestError, RpcRequestError, TimeoutError, createPublicClient } from 'viem';
import { robinhood } from 'viem/chains';
import { describe, expect, it } from 'vitest';

import { ProviderBlockedError } from '../src/errors';
import { RequestQueue, classifyRefusal, retryAfterMs, throttledHttp } from '../src/transport';

const URL = 'https://rpc.test';

function httpError(status: number, body = '', headers: Record<string, string> = {}): HttpRequestError {
  return new HttpRequestError({ url: URL, status, details: body, headers: new Headers(headers) });
}

/** A clock and a sleep that only move when the code waits, recording every wait. */
function fakeTime(): { now: () => number; sleep: (ms: number) => Promise<void>; waits: number[] } {
  let time = 0;
  const waits: number[] = [];
  return {
    now: () => time,
    sleep: async (ms) => {
      waits.push(ms);
      time += ms;
    },
    waits,
  };
}

describe('a refusal', () => {
  it('is retried on HTTP 429, with Retry-After read', () => {
    expect(classifyRefusal(httpError(429, '', { 'retry-after': '3' }), 0)).toEqual({ retry: true, status: 429, retryAfterMs: 3_000 });
  });

  it('is retried on a Cloudflare challenge, by header or by page', () => {
    expect(classifyRefusal(httpError(403, '', { 'cf-mitigated': 'challenge' }), 0)).toMatchObject({ retry: true, status: 403 });
    expect(classifyRefusal(httpError(503, '<title>Just a moment...</title>'), 0)).toMatchObject({ retry: true, status: 503 });
  });

  it('is retried on a gateway error, a JSON-RPC rate limit, a timeout and a dropped connection', () => {
    expect(classifyRefusal(httpError(502), 0).retry).toBe(true);
    expect(classifyRefusal(new RpcRequestError({ body: {}, url: URL, error: { code: -32005, message: 'rate limit exceeded' } }), 0).retry).toBe(true);
    expect(classifyRefusal(new TimeoutError({ body: {}, url: URL }), 0).retry).toBe(true);
    expect(classifyRefusal(new HttpRequestError({ url: URL, cause: new Error('socket hang up') }), 0).retry).toBe(true);
  });

  it('is not retried for a plain 403, a revert or a range refusal', () => {
    expect(classifyRefusal(httpError(403, 'forbidden'), 0).retry).toBe(false);
    expect(classifyRefusal(new RpcRequestError({ body: {}, url: URL, error: { code: 3, message: 'execution reverted' } }), 0).retry).toBe(false);
    expect(classifyRefusal(new RpcRequestError({ body: {}, url: URL, error: { code: -32602, message: 'query spans 2 blocks, but only 1 are allowed' } }), 0).retry).toBe(false);
  });

  it('reads Retry-After as seconds or as a date', () => {
    expect(retryAfterMs('2', 0)).toBe(2_000);
    expect(retryAfterMs(new Date(5_000).toUTCString(), 0)).toBe(5_000);
    expect(retryAfterMs('soon', 0)).toBeNull();
    expect(retryAfterMs(null, 0)).toBeNull();
  });
});

describe('the request queue', () => {
  it('runs one task at a time, in order, spaced apart', async () => {
    // #given three tasks started together
    const time = fakeTime();
    const queue = new RequestQueue(URL, { minIntervalMs: 200, now: time.now, sleep: time.sleep });
    let running = 0;
    let most = 0;
    const order: number[] = [];
    const task = (n: number) => async (): Promise<number> => {
      running += 1;
      most = Math.max(most, running);
      await Promise.resolve();
      order.push(n);
      running -= 1;
      return n;
    };
    // #when
    const results = await Promise.all([queue.run(task(1)), queue.run(task(2)), queue.run(task(3))]);
    // #then
    expect(results).toEqual([1, 2, 3]);
    expect(order).toEqual([1, 2, 3]);
    expect(most).toBe(1);
    expect(time.waits).toEqual([200, 200]);
  });

  it('backs off and retries a refusal, then succeeds', async () => {
    const time = fakeTime();
    const queue = new RequestQueue(URL, { minIntervalMs: 0, initialBackoffMs: 1_000, now: time.now, sleep: time.sleep });
    let calls = 0;
    const result = await queue.run(async () => {
      calls += 1;
      if (calls < 3) throw httpError(429);
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(time.waits).toEqual([1_000, 2_000]);
  });

  it('gives up with ProviderBlockedError after the last attempt', async () => {
    const time = fakeTime();
    const queue = new RequestQueue(URL, { minIntervalMs: 0, maxAttempts: 3, initialBackoffMs: 100, maxBackoffMs: 150, now: time.now, sleep: time.sleep });
    const run = queue.run(async () => {
      throw httpError(403, '', { 'cf-mitigated': 'challenge' });
    });
    await expect(run).rejects.toBeInstanceOf(ProviderBlockedError);
    await expect(run).rejects.toMatchObject({ attempts: 3, status: 403 });
    expect(time.waits).toEqual([100, 150]);
  });

  it('passes an error it should not retry straight through, and keeps serving after it', async () => {
    const queue = new RequestQueue(URL, { minIntervalMs: 0 });
    await expect(queue.run(async () => Promise.reject(new Error('execution reverted')))).rejects.toThrow('execution reverted');
    await expect(queue.run(async () => 'next')).resolves.toBe('next');
  });
});

describe('the throttled transport', () => {
  it('serves a viem client and retries a 429 from the provider', async () => {
    // #given a provider that refuses the first request
    let calls = 0;
    const fetchFn: typeof fetch = async () => {
      calls += 1;
      if (calls === 1) return new Response('Too Many Requests', { status: 429 });
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x1237' }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const time = fakeTime();
    const client = createPublicClient({ chain: robinhood, transport: throttledHttp(URL, { fetchFn, minIntervalMs: 0, initialBackoffMs: 10, now: time.now, sleep: time.sleep }) });
    // #when
    const chainId = await client.getChainId();
    // #then
    expect(chainId).toBe(0x1237);
    expect(calls).toBe(2);
    expect(time.waits).toEqual([10]);
  });
});
