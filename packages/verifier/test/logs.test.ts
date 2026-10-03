import { describe, expect, it } from 'vitest';

import { LogRangeTooNarrowError } from '../src/errors';
import type { RawLog } from '../src/evidence';
import { LogScanner, rangeRefusal, shapeOf, sortLogs } from '../src/logs';
import { FakeChain } from './support/fake-chain';

const ADDRESS = '0x00000000000000000000000000000000000000aa';
const TOPIC = `0x${'11'.repeat(32)}` as const;

function logAt(blockNumber: bigint, logIndex = 0): RawLog {
  return { address: ADDRESS, topics: [TOPIC], data: '0x', blockNumber, logIndex, transactionHash: `0x${'22'.repeat(32)}` };
}

describe('a range refusal', () => {
  it("reads the public RPC's allowed width", () => {
    const error = new Error('query spans 79446782 blocks (0 to 79446781), but only 10000000 are allowed for this request; narrow the block range');
    expect(rangeRefusal(error)).toEqual({ refused: true, allowed: 10_000_000n });
  });

  it("reads dRPC's stated width as an upper bound", () => {
    expect(rangeRefusal({ message: 'ranges over 10000 blocks are not supported on free plan', code: 35 })).toEqual({ refused: true, allowed: 10_000n });
  });

  it('finds the refusal in a cause chain, with no width stated', () => {
    const error = new Error('RPC Request failed.', { cause: { details: 'query returned more than 10000 results' } });
    expect(rangeRefusal(error)).toEqual({ refused: true, allowed: null });
  });

  it('is not a revert or a rate limit', () => {
    expect(rangeRefusal(new Error('execution reverted'))).toEqual({ refused: false });
    expect(rangeRefusal(new Error('429 Too Many Requests'))).toEqual({ refused: false });
  });
});

describe('the filter shape', () => {
  it('is multi with an address list or a topic list', () => {
    expect(shapeOf({ address: ADDRESS, topics: [TOPIC, null] })).toBe('single');
    expect(shapeOf({ address: [ADDRESS], topics: [TOPIC] })).toBe('multi');
    expect(shapeOf({ address: ADDRESS, topics: [[TOPIC, TOPIC]] })).toBe('multi');
  });
});

describe('the scanner', () => {
  it('collects every log in a range in chunks the provider accepts, oldest first', async () => {
    // #given a provider that takes 100 blocks a query
    const chain = new FakeChain({ number: 1_000n, timestamp: 0n });
    chain.limits = { single: 100n, multi: 100n };
    chain.logs = [logAt(950n), logAt(10n), logAt(500n, 2), logAt(500n, 1)];
    // #when
    const logs = await new LogScanner(chain, { initialSpan: 1_000n }).collect({ address: ADDRESS, topics: [TOPIC] }, 0n, 1_000n);
    // #then
    expect(logs.map((log) => [log.blockNumber, log.logIndex])).toEqual([[10n, 0], [500n, 1], [500n, 2], [950n, 0]]);
    expect(chain.getLogsCalls.filter((call) => !call.refused).every((call) => call.to - call.from + 1n <= 100n)).toBe(true);
  });

  it('walks down from the newest block and stops at the first window with a match', async () => {
    const chain = new FakeChain({ number: 1_000n, timestamp: 0n });
    chain.logs = [logAt(100n), logAt(700n)];
    const scanner = new LogScanner(chain, { initialSpan: 200n });
    const logs = await scanner.newest({ address: ADDRESS, topics: [TOPIC] }, 0n, 1_000n);
    expect(logs.map((log) => log.blockNumber)).toEqual([700n]);
    expect(chain.getLogsCalls.map((call) => [call.from, call.to])).toEqual([
      [801n, 1_000n],
      [601n, 800n],
    ]);
  });

  it('applies a match filter, and returns nothing when nothing matches', async () => {
    const chain = new FakeChain({ number: 1_000n, timestamp: 0n });
    chain.logs = [logAt(100n), logAt(700n)];
    const scanner = new LogScanner(chain, { initialSpan: 2_000n });
    expect(await scanner.newest({ address: ADDRESS, topics: [TOPIC] }, 0n, 1_000n, (log) => log.blockNumber < 500n)).toHaveLength(1);
    expect(await scanner.newest({ address: ADDRESS, topics: [TOPIC] }, 0n, 1_000n, () => false)).toEqual([]);
  });

  it('halves when the refusal states no width, and gives up below one block', async () => {
    // #given a provider that refuses everything with no width
    const refusing = new FakeChain({ number: 10n, timestamp: 0n });
    refusing.getLogs = async () => {
      throw new Error('block range too large');
    };
    // #when / #then
    await expect(new LogScanner(refusing, { initialSpan: 8n }).collect({ address: ADDRESS, topics: [TOPIC] }, 0n, 10n)).rejects.toBeInstanceOf(LogRangeTooNarrowError);
  });

  it('passes any other error through', async () => {
    const failing = new FakeChain({ number: 10n, timestamp: 0n });
    failing.getLogs = async () => {
      throw new Error('execution reverted');
    };
    await expect(new LogScanner(failing).collect({ address: ADDRESS, topics: [TOPIC] }, 0n, 10n)).rejects.toThrow('execution reverted');
  });

  it('sorts by block and index', () => {
    expect(sortLogs([logAt(2n, 0), logAt(1n, 5), logAt(1n, 1)]).map((log) => `${log.blockNumber}:${log.logIndex}`)).toEqual(['1:1', '1:5', '2:0']);
  });
});
