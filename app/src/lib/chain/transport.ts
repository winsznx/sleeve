import { PUBLIC_RPC_URL } from '@sleeve/core';
import { HttpRequestError, RpcRequestError, TimeoutError, custom, http, type Transport } from 'viem';

/**
 * Transports for Robinhood Chain reads. The public RPC is rate limited and answers bursts with HTTP 429 or a
 * Cloudflare 403 (D-012, chain-constants.md), so on it every request waits for the one before it and a refused
 * request is tried again after a growing pause. A provider with a key (QuickNode) takes viem's own transport.
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

/** Sends the named methods through their own transport and every other request through `fallback`. */
export function routeByMethod(fallback: Transport, routes: Readonly<Record<string, Transport>>): Transport {
  return (parameters) => {
    const main = fallback(parameters);
    const routed = new Map(Object.entries(routes).map(([method, transport]) => [method, transport(parameters)]));
    const request = (args: { method: string; params?: unknown }): Promise<unknown> => {
      const target = routed.get(args.method) ?? main;
      return target.request(args as Parameters<typeof target.request>[0]);
    };
    return custom({ request }, { key: 'routed', name: 'Routed by method', retryCount: 0 })(parameters);
  };
}

/**
 * The read transport the configuration asks for. On a keyed provider eth_getLogs still goes to the public RPC: log
 * streams read from the deploy block, a range the public RPC answers in one call and QuickNode, which caps the blocks
 * per call, in hundreds. The browser endpoint's method allowlist leaves eth_getLogs out for the same reason (D-035).
 * eth_simulateV1, which runs every owner op before it is signed (D-030), goes there too: the allowlist refuses it.
 */
export function readTransport(url: string, isPublic: boolean): Transport {
  if (isPublic) return serialHttp(url);
  const publicRpc = serialHttp(PUBLIC_RPC_URL);
  return routeByMethod(http(url, { batch: { batchSize: 20, wait: 16 }, retryCount: 3 }), {
    eth_getLogs: publicRpc,
    eth_simulateV1: publicRpc,
  });
}
