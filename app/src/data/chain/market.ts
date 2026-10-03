import {
  EXPECTED_DECIMALS,
  MODULE_PARAMS,
  SESSION_REASONS,
  SESSION_TYPES,
  aggregatorV3Abi,
  enumMember,
  erc20Abi,
  execPriceBuy,
  nextSessionTransition,
  sessionCalendarExtensionAbi,
  stockTokenAbi,
  tokenSourceAbi,
  uniswapV3PoolAbi,
  type FeedRound,
  type SessionType,
  type TickerId,
} from '@sleeve/core';
import type { Address } from 'viem';

import { DataLayerError } from '../errors';
import type { ChainPoint, FeedReading, MarketSnapshot, PoolPrice, SessionState, TickerMarket } from '../types';
import { CONTRACTS, type ChainContext } from './context';

/**
 * Market reads from the live contracts: TokenSource's tickers and pool allowlist, each feed, token and session, and
 * a QuoterV2 price for a reference size. Pool prices stay apart from feed prices (PRD 7.11). Decimals are read and
 * asserted once per layer: USDG 6, Stock Tokens 18, feeds 8 (build contract, chain facts).
 */

export interface ListedTicker {
  id: TickerId;
  token: Address;
  feed: Address;
  sessionType: SessionType;
  active: boolean;
  /** The allowlist in TokenSource order, each with its v3 fee tier. */
  pools: { address: Address; fee: number }[];
}

/** USDG for the reference pool price: 100 USDG, the HP2 size. */
export const REFERENCE_USDG_IN = 100_000_000n;

/**
 * QuoterV2's quoteExactInputSingle is nonpayable because it reverts inside a swap callback to measure it, but an
 * eth_call reads it like a view. This copy says view so it can sit in a multicall.
 */
export const quoterViewAbi = [
  {
    type: 'function',
    name: 'quoteExactInputSingle',
    stateMutability: 'view',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'fee', type: 'uint24' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'sqrtPriceX96After', type: 'uint160' },
      { name: 'initializedTicksCrossed', type: 'uint32' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
  },
] as const;

/** TokenSource changes only through the 48-hour timelock, so a listing read is kept for ten minutes. */
const LISTING_TTL_MS = 10 * 60_000;

function assertDecimals(source: Address, read: number | undefined, expected: number): void {
  if (read !== expected) {
    throw new DataLayerError(
      { code: 'SourceUnavailable' },
      `${source} reports ${String(read)} decimals where Sleeve expects ${expected}; nothing is shown from it`,
    );
  }
}

export class MarketReader {
  private listing: { at: number; tickers: Promise<ListedTicker[]> } | null = null;

  constructor(private readonly ctx: ChainContext) {}

  async head(): Promise<ChainPoint> {
    const block = await this.ctx.client.getBlock({ blockTag: 'latest' });
    return { l2Block: block.number, timestamp: block.timestamp };
  }

  /** Every ticker TokenSource lists, ascending id, with decimals checked. */
  tickers(): Promise<ListedTicker[]> {
    if (this.listing !== null && Date.now() - this.listing.at < LISTING_TTL_MS) return this.listing.tickers;
    const tickers = this.readTickers();
    this.listing = { at: Date.now(), tickers };
    tickers.catch(() => {
      this.listing = null;
    });
    return tickers;
  }

  async ticker(id: TickerId): Promise<ListedTicker> {
    const found = (await this.tickers()).find((ticker) => ticker.id === id);
    if (found === undefined) throw new DataLayerError({ code: 'NotFound' }, `TokenSource lists no ticker ${id}`);
    return found;
  }

  private async readTickers(): Promise<ListedTicker[]> {
    const { client } = this.ctx;
    const count = await client.readContract({ address: CONTRACTS.tokenSource, abi: tokenSourceAbi, functionName: 'tickerCount' });
    const ids = Array.from({ length: Number(count) }, (_, index) => index);
    const listed = await client.multicall({
      allowFailure: false,
      contracts: ids.flatMap((id) => [
        { address: CONTRACTS.tokenSource, abi: tokenSourceAbi, functionName: 'ticker', args: [id] } as const,
        { address: CONTRACTS.tokenSource, abi: tokenSourceAbi, functionName: 'poolsOf', args: [id] } as const,
      ]),
    });
    const raw = ids.map((id, index) => {
      const [token, feed, sessionType, active] = listed[index * 2] as readonly [Address, Address, number, boolean];
      const pools = listed[index * 2 + 1] as readonly Address[];
      return { id, token, feed, sessionType: enumMember(SESSION_TYPES, sessionType), active, pools };
    });

    const allPools = raw.flatMap((ticker) => ticker.pools);
    const withFeeds = raw.filter((ticker) => ticker.feed !== '0x0000000000000000000000000000000000000000');
    // Separate reads in one tick: the client's multicall batching sends them as one eth_call.
    const [usdgDecimals, usdgFeedDecimals, tokenDecimals, feedDecimals, poolFees] = await Promise.all([
      client.readContract({ address: CONTRACTS.usdg, abi: erc20Abi, functionName: 'decimals' }),
      client.readContract({ address: CONTRACTS.usdgUsdFeed, abi: aggregatorV3Abi, functionName: 'decimals' }),
      Promise.all(raw.map((ticker) => client.readContract({ address: ticker.token, abi: stockTokenAbi, functionName: 'decimals' }))),
      Promise.all(withFeeds.map((ticker) => client.readContract({ address: ticker.feed, abi: aggregatorV3Abi, functionName: 'decimals' }))),
      Promise.all(allPools.map((pool) => client.readContract({ address: pool, abi: uniswapV3PoolAbi, functionName: 'fee' }))),
    ]);
    assertDecimals(CONTRACTS.usdg, usdgDecimals, EXPECTED_DECIMALS.USDG);
    assertDecimals(CONTRACTS.usdgUsdFeed, usdgFeedDecimals, EXPECTED_DECIMALS.FEED);
    raw.forEach((ticker, index) => assertDecimals(ticker.token, tokenDecimals[index], EXPECTED_DECIMALS.STOCK_TOKEN));
    withFeeds.forEach((ticker, index) => assertDecimals(ticker.feed, feedDecimals[index], EXPECTED_DECIMALS.FEED));
    const fees = new Map<string, number>();
    allPools.forEach((pool, index) => fees.set(pool.toLowerCase(), Number(poolFees[index])));

    return raw.map((ticker) => ({
      ...ticker,
      pools: ticker.pools.map((pool) => ({ address: pool, fee: fees.get(pool.toLowerCase()) ?? 0 })),
    }));
  }

  /** Clock, sessions, feeds and a reference pool price for every ticker. */
  async snapshot(): Promise<MarketSnapshot> {
    const { client } = this.ctx;
    const [tickers, asOf] = await Promise.all([this.tickers(), this.head()]);
    // Every read below starts in the same tick, so the client's multicall batching sends them as one eth_call.
    const [usdgRound, markets, prices] = await Promise.all([
      client.readContract({ address: CONTRACTS.usdgUsdFeed, abi: aggregatorV3Abi, functionName: 'latestRoundData' }),
      Promise.all(
        tickers.map(async (ticker): Promise<Omit<TickerMarket, 'poolPrice'>> => {
          const [round, uiMultiplier, newUIMultiplier, effectiveAt, paused, oraclePaused, session] = await Promise.all([
            client.readContract({ address: ticker.feed, abi: aggregatorV3Abi, functionName: 'latestRoundData' }),
            client.readContract({ address: ticker.token, abi: stockTokenAbi, functionName: 'uiMultiplier' }),
            client.readContract({ address: ticker.token, abi: stockTokenAbi, functionName: 'newUIMultiplier' }),
            client.readContract({ address: ticker.token, abi: stockTokenAbi, functionName: 'effectiveAt' }),
            client.readContract({ address: ticker.token, abi: stockTokenAbi, functionName: 'paused' }),
            client.readContract({ address: ticker.token, abi: stockTokenAbi, functionName: 'oraclePaused' }),
            client.readContract({
              address: CONTRACTS.calendar,
              abi: sessionCalendarExtensionAbi,
              functionName: 'sessionState',
              args: [asOf.timestamp, SESSION_TYPES.indexOf(ticker.sessionType)],
            }),
          ]);
          const [open, reason, openedAt] = session;
          return {
            tickerId: ticker.id,
            active: ticker.active,
            session: sessionState(open, reason, openedAt, asOf.timestamp, ticker.sessionType),
            feed: feedReading(ticker.feed, round),
            uiMultiplier,
            pendingMultiplier:
              newUIMultiplier !== uiMultiplier && effectiveAt > asOf.timestamp ? { value: newUIMultiplier, effectiveAt } : null,
            paused,
            oraclePaused,
          };
        }),
      ),
      this.poolPrices(tickers, asOf),
    ]);
    return {
      asOf,
      tickers: markets.map((entry) => ({ ...entry, poolPrice: prices.get(entry.tickerId) ?? null })),
      usdgUsd: feedReading(CONTRACTS.usdgUsdFeed, usdgRound),
    };
  }

  /** QuoterV2 for REFERENCE_USDG_IN on each ticker's first allowlisted pool. A pool that cannot quote shows none. */
  private async poolPrices(tickers: ListedTicker[], asOf: ChainPoint): Promise<Map<TickerId, PoolPrice>> {
    const quoted = tickers.filter((ticker) => ticker.pools[0] !== undefined);
    const answers = await this.ctx.client.multicall({
      allowFailure: true,
      contracts: quoted.map((ticker) => {
        const pool = ticker.pools[0]!;
        return {
          address: CONTRACTS.quoter,
          abi: quoterViewAbi,
          functionName: 'quoteExactInputSingle',
          args: [{ tokenIn: CONTRACTS.usdg, tokenOut: ticker.token, amountIn: REFERENCE_USDG_IN, fee: pool.fee, sqrtPriceLimitX96: 0n }],
        } as const;
      }),
    });
    const prices = new Map<TickerId, PoolPrice>();
    quoted.forEach((ticker, index) => {
      const answer = answers[index];
      if (answer?.status !== 'success' || answer.result[0] === 0n) return;
      const tokensOut = answer.result[0];
      prices.set(ticker.id, {
        pool: ticker.pools[0]!.address,
        usdgIn: REFERENCE_USDG_IN,
        tokensOut,
        execPrice: execPriceBuy(REFERENCE_USDG_IN, tokensOut),
        at: asOf,
      });
    });
    return prices;
  }
}

export function feedReading(feed: Address, round: readonly [bigint, bigint, bigint, bigint, bigint]): FeedReading {
  const [roundId, answer, , updatedAt] = round;
  const reading: FeedRound = { roundId, answer, updatedAt };
  return { ...reading, feed };
}

function sessionState(open: boolean, reason: number, openedAt: bigint, now: bigint, sessionType: SessionType): SessionState {
  if (open) return { open, reason: enumMember(SESSION_REASONS, reason), openedAt, nextOpenAt: null };
  const next = nextSessionTransition(now, sessionType);
  return {
    open,
    reason: enumMember(SESSION_REASONS, reason),
    openedAt: null,
    nextOpenAt: next !== null && next.opens ? next.at : null,
  };
}

/** Why a stock round would fail readStockFeed (SPEC 4), from what the snapshot shows. startedAt is not in it. */
export function feedIsStale(feed: FeedRound, now: bigint, sessionOpenedAt: bigint | null): boolean {
  if (feed.answer <= 0n || feed.updatedAt > now) return true;
  if (now - feed.updatedAt > MODULE_PARAMS.stockFeedMaxAgeSeconds) return true;
  return sessionOpenedAt !== null && feed.updatedAt < sessionOpenedAt;
}
