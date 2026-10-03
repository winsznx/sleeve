import { formatLog, numberToHex, type Address, type Hex, type Log, type PublicClient } from 'viem';

/**
 * Log reads from the first deploy block to the chain head, in ranges a provider accepts. The public RPC takes
 * ten-million-block ranges and an Alchemy app far fewer, so a refused range is halved and tried again down to a floor,
 * and a range that still fails is an error, never an empty answer. Each stream remembers how far it has read, so a
 * second read asks only for the blocks since.
 */

export type TopicFilter = readonly (Hex | readonly Hex[] | null)[];

export interface LogFilter {
  address: Address | readonly Address[];
  topics: TopicFilter;
}

export interface ScanOptions {
  /** The first range to try, in blocks. */
  initialChunk?: bigint;
  /** The smallest range before giving up. */
  minChunk?: bigint;
}

const DEFAULT_INITIAL_CHUNK = 5_000_000n;
const DEFAULT_MIN_CHUNK = 1_000n;

const RANGE_REFUSAL = /range|limit|exceed|too many|more than|too large|timed? ?out|response size|10000|query returned/i;

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null && key in value ? (value as Record<string, unknown>)[key] : undefined;
}

/** Whether a getLogs failure says the range or the result was too big, as opposed to the provider being down. */
export function isRangeRefusal(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current !== undefined && current !== null && depth < 8; depth += 1) {
    const message = field(current, 'details') ?? field(current, 'shortMessage') ?? field(current, 'message');
    if (typeof message === 'string' && RANGE_REFUSAL.test(message)) return true;
    const code = field(current, 'code');
    if (code === -32005 || code === -32602 || code === -32614) return true;
    current = field(current, 'cause');
  }
  return false;
}

async function getLogsOnce(client: PublicClient, filter: LogFilter, fromBlock: bigint, toBlock: bigint): Promise<Log[]> {
  const raw = await client.request({
    method: 'eth_getLogs',
    params: [
      {
        address: filter.address as Address | Address[],
        topics: filter.topics as (Hex | Hex[] | null)[],
        fromBlock: numberToHex(fromBlock),
        toBlock: numberToHex(toBlock),
      },
    ],
  });
  return raw.map((log) => formatLog(log));
}

/** Every log matching the filter in [fromBlock, toBlock], in chain order. */
export async function scanLogs(
  client: PublicClient,
  filter: LogFilter,
  fromBlock: bigint,
  toBlock: bigint,
  options: ScanOptions = {},
): Promise<Log[]> {
  const minChunk = options.minChunk ?? DEFAULT_MIN_CHUNK;
  let chunk = options.initialChunk ?? DEFAULT_INITIAL_CHUNK;
  const logs: Log[] = [];
  let start = fromBlock;
  while (start <= toBlock) {
    const end = start + chunk - 1n < toBlock ? start + chunk - 1n : toBlock;
    try {
      logs.push(...(await getLogsOnce(client, filter, start, end)));
      start = end + 1n;
    } catch (error) {
      if (!isRangeRefusal(error) || chunk <= minChunk) throw error;
      chunk = chunk / 2n > minChunk ? chunk / 2n : minChunk;
    }
  }
  return logs.sort(compareLogs);
}

export function compareLogs(a: Log, b: Log): number {
  const blockA = a.blockNumber ?? 0n;
  const blockB = b.blockNumber ?? 0n;
  if (blockA !== blockB) return blockA < blockB ? -1 : 1;
  return (a.logIndex ?? 0) - (b.logIndex ?? 0);
}

/** A filter read once from its first block, then only forward. */
export class LogStream {
  private logs: Log[] = [];
  private scannedTo: bigint;
  private pending: Promise<Log[]> | null = null;

  constructor(
    private readonly client: PublicClient,
    private readonly filter: LogFilter,
    fromBlock: bigint,
    private readonly options: ScanOptions = {},
  ) {
    this.scannedTo = fromBlock - 1n;
  }

  /** Every matching log up to `head`, reading only the blocks not read before. Concurrent callers share one read. */
  read(head: bigint): Promise<Log[]> {
    if (this.pending !== null) return this.pending;
    if (head <= this.scannedTo) return Promise.resolve(this.logs);
    const from = this.scannedTo + 1n;
    this.pending = scanLogs(this.client, this.filter, from, head, this.options)
      .then((fresh) => {
        this.logs = [...this.logs, ...fresh];
        this.scannedTo = head;
        return this.logs;
      })
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }
}

/** One stream per filter, made on first use. */
export class LogStreams {
  private readonly streams = new Map<string, LogStream>();

  constructor(
    private readonly client: PublicClient,
    private readonly fromBlock: bigint,
    private readonly options: ScanOptions = {},
  ) {}

  stream(filter: LogFilter): LogStream {
    const key = JSON.stringify(filter, (_, value: unknown) => (typeof value === 'string' ? value.toLowerCase() : value));
    let stream = this.streams.get(key);
    if (stream === undefined) {
      stream = new LogStream(this.client, filter, this.fromBlock, this.options);
      this.streams.set(key, stream);
    }
    return stream;
  }
}
