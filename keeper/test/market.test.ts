import { type Address, LAUNCH_TICKERS } from '@sleeve/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { silentLogger } from '../src/log';
import { Market, USDG_USD_FEED } from '../src/market';
import { FakeChain } from './support/fake-chain';

const SPY_TOKEN = LAUNCH_TICKERS[0].token.toLowerCase() as Address;
const SPY_FEED = LAUNCH_TICKERS[0].feed.toLowerCase() as Address;
const SPY_POOL = LAUNCH_TICKERS[0].pools[0].address.toLowerCase() as Address;
const QQQ_TOKEN = LAUNCH_TICKERS[1].token.toLowerCase() as Address;
const QQQ_FEED = LAUNCH_TICKERS[1].feed.toLowerCase() as Address;

let chain: FakeChain;

beforeEach(() => {
  chain = new FakeChain();
  chain.tickers = [
    { id: 0, token: SPY_TOKEN, feed: SPY_FEED, sessionType: 'ALL_DAY', active: true },
    { id: 1, token: QQQ_TOKEN, feed: QQQ_FEED, sessionType: 'ALL_DAY', active: true },
  ];
  chain.pools.set(0, [SPY_POOL]);
});

describe('Market', () => {
  it('reads the tickers from TokenSource', async () => {
    // #given
    const market = new Market(chain, silentLogger);
    // #when
    await market.refresh();
    // #then
    expect(market.allTickers().map((ticker) => ticker.token)).toEqual([SPY_TOKEN, QQQ_TOKEN]);
  });

  it('marks a ticker whose token does not report 18 decimals unusable, and keeps the others', async () => {
    // #given
    chain.decimalsOf.set(QQQ_TOKEN, 6);
    const market = new Market(chain, silentLogger);
    // #when
    await market.refresh();
    // #then
    expect([market.unusableReason(0), market.unusableReason(1)]).toEqual([null, 'ticker 1 token reports 6 decimals, expected 18']);
  });

  it('refuses to run when USDG does not report 6 decimals', async () => {
    // #given
    chain.decimalsOf.set('0x5fc5360d0400a0fd4f2af552add042d716f1d168', 18);
    const market = new Market(chain, silentLogger);
    // #when
    const attempt = market.refresh();
    // #then
    await expect(attempt).rejects.toThrow('USDG reports 18 decimals, expected 6');
  });

  it('tells which feeds posted a new round since the last poll, the USDG/USD feed included', async () => {
    // #given
    const market = new Market(chain, silentLogger);
    await market.refresh();
    chain.rounds.set(SPY_FEED, { roundId: 10n, answer: 1n, startedAt: 1n, updatedAt: 1n });
    await market.pollFeeds();
    chain.rounds.set(SPY_FEED, { roundId: 11n, answer: 1n, startedAt: 2n, updatedAt: 2n });
    chain.rounds.set(USDG_USD_FEED, { roundId: 5n, answer: 100_000_000n, startedAt: 2n, updatedAt: 2n });
    // #when
    const moved = await market.pollFeeds();
    // #then
    expect([...moved].sort()).toEqual([USDG_USD_FEED, SPY_FEED].sort());
  });

  it('reads the pool list fresh for every trigger and the fee tier once', async () => {
    // #given
    const market = new Market(chain, silentLogger);
    await market.poolsFor(0);
    chain.fees.set(SPY_POOL, 3000);
    // #when
    const pools = await market.poolsFor(0);
    // #then
    expect([pools, chain.calls.filter((call) => call === 'poolsOf:0').length]).toEqual([[{ address: SPY_POOL, fee: 500 }], 2]);
  });

  it('skips excluded pools when it picks the best quote', async () => {
    // #given
    const market = new Market(chain, silentLogger);
    await market.refresh();
    chain.quotes.set(SPY_POOL, 1_000n);
    // #when
    const best = await market.best(0, [{ address: SPY_POOL, fee: 500 }], 5_000_000n, new Set([SPY_POOL]));
    // #then
    expect(best).toBeNull();
  });
});
