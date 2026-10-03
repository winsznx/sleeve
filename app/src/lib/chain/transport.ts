import { HttpRequestError, RpcRequestError, TimeoutError, custom, http, type Transport } from 'viem';

/**
 * Transports for Robinhood Chain reads. The public RPC is rate limited and answers bursts with HTTP 429 or a
 * Cloudflare 403 (D-012, chain-constants.md), so on it every request waits for the one before it and a refused
 * request is tried again after a growing pause. A provider with a key (Alchemy) takes viem's own transport.
 */

export interface SerialTransportOptions {
  /** Least time between two requests, in milliseconds. */
  minIntervalMs?: number;
  /** Tries after the first. */
  retries?: number;
  /** First pause after a refusal; each later pause doubles. */
  baseDelayMs?: number;
  /** Per request. */
  timeoutMs?: number;
}

const RETRY_STATUSES = new Set([403, 408, 425, 429, 500, 502, 503, 504]);
/** JSON-RPC codes for "too many requests" and "limit exceeded". A revert (code 3) is never retried. */
const RETRY_RPC_CODES = new Set([429, -32005, -32090]);

/** Whether a failed request is worth sending again: a refusal for rate or a gateway fault, never a revert. */
export function isRetryableRpcFailure(error: unknown): boolean {
  if (error instanceof HttpRequestError) return error.status === undefined || RETRY_STATUSES.has(error.status);
  if (error instanceof RpcRequestError) return RETRY_RPC_CODES.has(error.code);
  return error instanceof TimeoutError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Runs tasks one at a time, in order, with at least `minIntervalMs` between starts. */
export function createSerialQueue(minIntervalMs: number): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  let lastStart = 0;
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = async (): Promise<T> => {
      const wait = lastStart + minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      lastStart = Date.now();
      return task();
    };
    const result = tail.then(run, run);
    tail = result.catch(() => undefined);
    return result;
  };
}

/** One request at a time with backoff, for the public RPC. */
export function serialHttp(url: string, options: SerialTransportOptions = {}): Transport {
  const retries = options.retries ?? 4;
  const baseDelayMs = options.baseDelayMs ?? 400;
  const enqueue = createSerialQueue(options.minIntervalMs ?? 120);
  const inner = http(url, { batch: false, retryCount: 0, timeout: options.timeoutMs ?? 20_000 });

  return (parameters) => {
    const transport = inner({ ...parameters, retryCount: 0 });
    const request = async (args: { method: string; params?: unknown }): Promise<unknown> => {
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await enqueue(() => transport.request(args as Parameters<typeof transport.request>[0]));
        } catch (error) {
          if (attempt >= retries || !isRetryableRpcFailure(error)) throw error;
          await sleep(baseDelayMs * 2 ** attempt);
        }
      }
    };
    return custom({ request }, { key: 'serial-http', name: 'Serial HTTP', retryCount: 0 })(parameters);
  };
}

/** The read transport the configuration asks for. */
export function readTransport(url: string, isPublic: boolean): Transport {
  return isPublic ? serialHttp(url) : http(url, { batch: { batchSize: 20, wait: 16 }, retryCount: 3 });
}
