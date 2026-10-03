import { LogRangeTooNarrowError } from './errors';
import type { RawLog } from './evidence';
import type { ChainReader, LogFilter } from './reader';

/**
 * eth_getLogs in chunks the provider accepts. Providers cap the block range differently: the public Robinhood Chain
 * RPC takes 10,000,000 blocks for one address and one value per topic but only 100,000 with an address list or a
 * topic list, and dRPC's free tier far fewer (docs/research/chain-constants.md section 8, D-008). The scanner starts
 * wide, reads the allowed width from the refusal when the message gives one and halves otherwise, and remembers what
 * worked for each filter shape.
 */

/** A filter with a list in any position is a different class of query for range limits. */
export type FilterShape = 'single' | 'multi';

export function shapeOf(filter: LogFilter): FilterShape {
  if (typeof filter.address !== 'string') return 'multi';
  return filter.topics.some((topic) => topic !== null && typeof topic !== 'string') ? 'multi' : 'single';
}

const RANGE_TEXT =
  /block range|range (?:is )?too (?:large|wide|big)|too many blocks|query spans|ranges over|narrow the block range|max(?:imum)? (?:block )?range|more than \d+ (?:results|logs)|query returned more than|log response size|limit the query|exceed(?:s|ed)? .*(?:range|results)/i;

interface ErrorText {
  message?: unknown;
  details?: unknown;
  shortMessage?: unknown;
  cause?: unknown;
}

function messagesOf(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 8 && typeof current === 'object' && current !== null; depth += 1) {
    const link: ErrorText = current;
    for (const part of [link.message, link.details, link.shortMessage]) {
      if (typeof part === 'string') parts.push(part);
    }
    current = link.cause;
  }
  return parts.join(' ');
}

/**
 * Whether an error is a range refusal, and the widest range it says is allowed, when it says. "only 10000000 are
 * allowed" is the public RPC's; "ranges over 10000 blocks" is dRPC's, which refuses narrower ranges as well, so a
 * stated width is only an upper bound and the scanner keeps halving below it.
 */
export function rangeRefusal(error: unknown): { refused: false } | { refused: true; allowed: bigint | null } {
  const text = messagesOf(error);
  if (!RANGE_TEXT.test(text)) return { refused: false };
  const stated = /only (\d+) (?:are |is )?allowed|ranges? over (\d+) blocks|up to (\d+) blocks|max(?:imum)? (?:block )?range (?:of |is )?(\d+)/i.exec(text);
  const digits = stated?.slice(1).find((group) => group !== undefined);
  return { refused: true, allowed: digits === undefined ? null : BigInt(digits) };
}

export interface ScannerOptions {
  /** The first width tried for a filter shape, in blocks. Default 10,000,000, the public RPC's single-value limit. */
  initialSpan?: bigint;
}

const DEFAULT_SPAN = 10_000_000n;

export class LogScanner {
  private readonly spans = new Map<FilterShape, bigint>();
  private readonly initialSpan: bigint;

  constructor(
    private readonly reader: ChainReader,
    options: ScannerOptions = {},
  ) {
    this.initialSpan = options.initialSpan ?? DEFAULT_SPAN;
  }

  /** The width the scanner uses next for a shape. */
  spanFor(shape: FilterShape): bigint {
    return this.spans.get(shape) ?? this.initialSpan;
  }

  /** One window, shrunk until the provider accepts it. Returns the logs and the window's actual end. */
  private async window(filter: LogFilter, from: bigint, to: bigint, descending: boolean): Promise<{ logs: RawLog[]; low: bigint; high: bigint }> {
    const shape = shapeOf(filter);
    for (;;) {
      const span = this.spanFor(shape);
      const low = descending ? (to - span + 1n > from ? to - span + 1n : from) : from;
      const high = descending ? to : from + span - 1n < to ? from + span - 1n : to;
      try {
        return { logs: await this.reader.getLogs(filter, low, high), low, high };
      } catch (error) {
        const refusal = rangeRefusal(error);
        if (!refusal.refused) throw error;
        const width = high - low + 1n;
        if (width <= 1n) throw new LogRangeTooNarrowError(low, high, error);
        const next = refusal.allowed !== null && refusal.allowed < width ? refusal.allowed : width / 2n;
        this.spans.set(shape, next < 1n ? 1n : next);
      }
    }
  }

  /** Every log in [from, to], oldest first. */
  async collect(filter: LogFilter, from: bigint, to: bigint): Promise<RawLog[]> {
    const found: RawLog[] = [];
    let cursor = from;
    while (cursor <= to) {
      const { logs, high } = await this.window(filter, cursor, to, false);
      found.push(...logs);
      cursor = high + 1n;
    }
    return sortLogs(found);
  }

  /**
   * Walks [from, to] from the newest block down and returns the matching logs of the first window that has any,
   * oldest first, or an empty list.
   */
  async newest(filter: LogFilter, from: bigint, to: bigint, matches: (log: RawLog) => boolean = () => true): Promise<RawLog[]> {
    let cursor = to;
    while (cursor >= from) {
      const { logs, low } = await this.window(filter, from, cursor, true);
      const hits = logs.filter(matches);
      if (hits.length > 0) return sortLogs(hits);
      cursor = low - 1n;
    }
    return [];
  }
}

export function sortLogs(logs: readonly RawLog[]): RawLog[] {
  return [...logs].sort((a, b) =>
    a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1,
  );
}
