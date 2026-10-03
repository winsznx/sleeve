import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { ADDRESSES, CHAIN_ID } from './chain';
import { LAUNCH_TICKERS } from './tickers';

const REPO = new URL('../../../', import.meta.url);

/** `address internal constant NAME = 0x...;` lines in contracts/test/utils/Chain4663.sol. */
function solidityAddresses(): Map<string, string> {
  const source = readFileSync(new URL('contracts/test/utils/Chain4663.sol', REPO), 'utf8');
  const found = [...source.matchAll(/address internal constant (\w+) = (0x[0-9a-fA-F]{40});/g)];
  return new Map(found.map((match) => [match[1] ?? '', match[2] ?? '']));
}

/** Rows of the D-010 pool table in docs/DECISIONS.md: ticker, pool and fee. */
function decisionPools(): { symbol: string; pool: string; fee: number }[] {
  const decisions = readFileSync(new URL('docs/DECISIONS.md', REPO), 'utf8');
  const section = decisions.slice(decisions.indexOf('## D-010'), decisions.indexOf('## D-011'));
  return [...section.matchAll(/^\| (SPY|QQQ|NVDA|AAPL)(?:, second)? \| (0x[0-9a-fA-F]{40}) \| (\d+) \|/gm)].map(
    (match) => ({ symbol: match[1] ?? '', pool: match[2] ?? '', fee: Number(match[3]) }),
  );
}

describe('chain constants agree with the contracts and the decisions log', () => {
  const solidity = solidityAddresses();

  it('is chain 4663', () => {
    expect(CHAIN_ID).toBe(4663);
  });

  it('matches every shared address in Chain4663.sol, checksum case included', () => {
    const shared = Object.entries(ADDRESSES).filter(([name]) => solidity.has(name));
    expect(shared.map(([name]) => name).sort()).toEqual(
      ['ARB_SYS', 'ENTRY_POINT_V07', 'PERMIT2', 'QUOTER_V2', 'SWAP_ROUTER_02', 'USDG', 'USDG_USD_FEED', 'V3_FACTORY'].sort(),
    );
    expect(shared.filter(([name, address]) => solidity.get(name) !== address)).toEqual([]);
  });

  it('matches each launch ticker token and feed in Chain4663.sol', () => {
    const expected = LAUNCH_TICKERS.map((ticker) => [solidity.get(ticker.symbol), solidity.get(`${ticker.symbol}_FEED`)]);
    expect(LAUNCH_TICKERS.map((ticker) => [ticker.token, ticker.feed])).toEqual(expected);
  });

  it('allowlists exactly the D-010 pools', () => {
    const pools = LAUNCH_TICKERS.flatMap((ticker) =>
      ticker.pools.map((pool) => ({ symbol: ticker.symbol, pool: pool.address, fee: pool.fee })),
    );
    expect(pools).toEqual(decisionPools());
  });
});
