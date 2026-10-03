import { http, type Transport } from 'viem';

import { ProviderBlockedError } from './errors';

/**
 * A viem HTTP transport that sends one request at a time, spaced out, and backs off when the provider rate limits or
 * challenges (D-012). Robinhood Chain's public RPC challenges bursts with a Cloudflare page that can last minutes
 * (docs/research/chain-constants.md section 8), so the verifier never runs requests in parallel against it and gives
 * up with ProviderBlockedError instead of hammering it. Browser safe: fetch and timers only.
 */

export interface ThrottleOptions {
  /** Least time between the starts of two requests, in ms. Default 200. */
  minIntervalMs?: number;
  /** Tries per request, the first included, before ProviderBlockedError. Default 6. */
  maxAttempts?: number;
  /** First backoff in ms, doubled on each retry up to maxBackoffMs. Defaults 1,000 and 16,000. */
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  /** Per-request timeout in ms. Default 30,000. */
  timeoutMs?: number;
  /** Replaces fetch, for tests. */
  fetchFn?: typeof fetch;
  /** Replaces the clock and the wait, for tests. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULTS = {
  minIntervalMs: 200,
  maxAttempts: 6,
  initialBackoffMs: 1_000,
  maxBackoffMs: 16_000,
  timeoutMs: 30_000,
} as const;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Why a failed request may be tried again. */
export type Refusal = { retry: true; status: number | null; retryAfterMs: number | null } | { retry: false };

const RATE_LIMIT_TEXT = /rate.?limit|too many requests|request limit|exceeded (?:the |your )?(?:quota|capacity)|throttl|compute units/i;
const CHALLENGE_TEXT = /just a moment|cf-chl|challenge-platform|attention required|cloudflare/i;

interface ErrorLike {
  name?: unknown;
  status?: unknown;
  code?: unknown;
  message?: unknown;
  details?: unknown;
  shortMessage?: unknown;
  headers?: unknown;
  cause?: unknown;
}

function errorChain(error: unknown): ErrorLike[] {
  const chain: ErrorLike[] = [];
  let current: unknown = error;
  while (typeof current === 'object' && current !== null && chain.length < 8) {
    const link: ErrorLike = current;
    chain.push(link);
    current = link.cause;
  }
  return chain;
}

function textOf(link: ErrorLike): string {
  return [link.message, link.details, link.shortMessage].filter((part): part is string => typeof part === 'string').join(' ');
}

function headerOf(link: ErrorLike, name: string): string | null {
  const headers = link.headers;
  return typeof Headers !== 'undefined' && headers instanceof Headers ? headers.get(name) : null;
}

/** Retry-After in seconds or as an HTTP date, in ms from now. */
export function retryAfterMs(value: string | null, now: number): number | null {
  if (value === null) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

/**
 * Sorts a failed request. Retried: HTTP 429, a Cloudflare challenge (403 or 503 with the challenge header or page),
 * 502 to 504, a JSON-RPC error whose code or text is a rate limit, a timeout, and a network failure with no status.
 * Everything else, a revert or an eth_getLogs range refusal among them, goes back to the caller unchanged.
 */
export function classifyRefusal(error: unknown, now: number): Refusal {
  const chain = errorChain(error);
  for (const link of chain) {
    const status = typeof link.status === 'number' ? link.status : null;
    const body = textOf(link);
    const challenged = headerOf(link, 'cf-mitigated') === 'challenge' || CHALLENGE_TEXT.test(body);
    if (status === 429 || ((status === 403 || status === 503) && challenged)) {
      return { retry: true, status, retryAfterMs: retryAfterMs(headerOf(link, 'retry-after'), now) };
    }
    if (status === 502 || status === 503 || status === 504) return { retry: true, status, retryAfterMs: null };
    if (link.code === 429 || RATE_LIMIT_TEXT.test(body)) return { retry: true, status, retryAfterMs: null };
  }
  if (chain.some((link) => link.name === 'TimeoutError')) return { retry: true, status: null, retryAfterMs: null };
  // viem's HttpRequestError without a status: the request never got an HTTP answer, a dropped connection or DNS.
  const top = chain[0];
  if (top !== undefined && top.name === 'HttpRequestError' && typeof top.status !== 'number') {
    return { retry: true, status: null, retryAfterMs: null };
  }
  return { retry: false };
}

/** Runs tasks one at a time, at least minIntervalMs apart, retrying refusals with exponential backoff. */
export class RequestQueue {
  private tail: Promise<void> = Promise.resolve();
  private lastStart = Number.NEGATIVE_INFINITY;
  private readonly options: Required<Pick<ThrottleOptions, 'minIntervalMs' | 'maxAttempts' | 'initialBackoffMs' | 'maxBackoffMs'>>;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly url: string,
    options: ThrottleOptions = {},
  ) {
    this.options = {
      minIntervalMs: options.minIntervalMs ?? DEFAULTS.minIntervalMs,
      maxAttempts: options.maxAttempts ?? DEFAULTS.maxAttempts,
      initialBackoffMs: options.initialBackoffMs ?? DEFAULTS.initialBackoffMs,
      maxBackoffMs: options.maxBackoffMs ?? DEFAULTS.maxBackoffMs,
    };
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? defaultSleep;
  }

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(() => this.attempt(task));
    // The queue only orders tasks: each caller gets its own outcome from `result`, so the tail ignores it.
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async spaced(): Promise<void> {
    const wait = this.lastStart + this.options.minIntervalMs - this.now();
    if (wait > 0) await this.sleep(wait);
    this.lastStart = this.now();
  }

  private backoff(attempt: number, retryAfter: number | null): number {
    const exponential = Math.min(this.options.maxBackoffMs, this.options.initialBackoffMs * 2 ** (attempt - 1));
    return retryAfter === null ? exponential : Math.min(Math.max(exponential, retryAfter), this.options.maxBackoffMs * 4);
  }

  private async attempt<T>(task: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      await this.spaced();
      try {
        return await task();
      } catch (error) {
        const refusal = classifyRefusal(error, this.now());
        if (!refusal.retry) throw error;
        if (attempt >= this.options.maxAttempts) {
          throw new ProviderBlockedError(this.url, attempt, refusal.status, error);
        }
        await this.sleep(this.backoff(attempt, refusal.retryAfterMs));
      }
    }
  }
}

/**
 * viem's http transport with its own retries off, behind a RequestQueue. Every request of every client made from one
 * transport value shares the queue.
 */
export function throttledHttp(url: string, options: ThrottleOptions = {}): Transport {
  const queue = new RequestQueue(url, options);
  const base = http(url, {
    retryCount: 0,
    timeout: options.timeoutMs ?? DEFAULTS.timeoutMs,
    ...(options.fetchFn === undefined ? {} : { fetchFn: options.fetchFn }),
  });
  return (config) => {
    const inner = base(config);
    const request: typeof inner.request = (args, requestOptions) => queue.run(() => inner.request(args, requestOptions));
    return { ...inner, request };
  };
}
