import { ADDRESSES, type Address, EXPECTED_DECIMALS } from '@sleeve/core';

import { lower } from './chain/events';
import type { ChainGateway, FeedRound, TickerState } from './chain/gateway';
import { UnexpectedDecimalsError } from './errors';
import type { Logger } from './log';
import { type PoolQuote, bestPool } from './policy/pools';

export interface PoolInfo {
  address: Address;
  fee: number;
}

export interface MarketOptions {
  /** How long the TokenSource tickers are trusted before they are read again. */
  refreshMs?: number;
  now?: () => number;
}

export const USDG_USD_FEED: Address = lower(ADDRESSES.USDG_USD_FEED);

/**
 * TokenSource's tickers, their pools and their feeds as the keeper sees them. Tickers are read again every ten
 * minutes and at once after a PoolNotAllowed; the pool list itself is read again before every trigger (audit A1-17).
 * Decimals are read at runtime and asserted (build contract, chain facts). The feeds are polled every pass, so a new
 * round can wake a waiting settle.
 */
export class Market {
  private readonly tickers = new Map<number, TickerState>();
  private readonly unusable = new Map<number, string>();
  private readonly poolFees = new Map<Address, number>();
  private readonly rounds = new Map<Address, FeedRound>();
  private refreshedAt: number | null = null;
  private usdgChecked = false;
  private readonly refreshMs: number;
  private readonly now: () => number;

  constructor(
    private readonly chain: ChainGateway,
    private readonly log: Logger,
    options: MarketOptions = {},
  ) {
    this.refreshMs = options.refreshMs ?? 600_000;
    this.now = options.now ?? (() => Date.now());
  }

  async refresh(force = false): Promise<void> {
    if (!force && this.refreshedAt !== null && this.now() - this.refreshedAt < this.refreshMs) return;
    if (!this.usdgChecked) {
      await this.expectDecimals(ADDRESSES.USDG, 'USDG', EXPECTED_DECIMALS.USDG);
      await this.expectDecimals(ADDRESSES.USDG_USD_FEED, 'the USDG/USD feed', EXPECTED_DECIMALS.FEED);
      this.usdgChecked = true;
    }
    const count = await this.chain.tickerCount();
    const fresh = await Promise.all(Array.from({ length: count }, (_, id) => this.chain.ticker(id)));
    for (const ticker of fresh) {
      const previous = this.tickers.get(ticker.id);
      this.tickers.set(ticker.id, ticker);
      if (previous !== undefined && previous.token === ticker.token && previous.feed === ticker.feed) continue;
      try {
        await this.expectDecimals(ticker.token, `ticker ${ticker.id} token`, EXPECTED_DECIMALS.STOCK_TOKEN);
        if (BigInt(ticker.feed) !== 0n) {
          await this.expectDecimals(ticker.feed, `ticker ${ticker.id} feed`, EXPECTED_DECIMALS.FEED);
        }
        this.unusable.delete(ticker.id);
      } catch (error) {
        if (!(error instanceof UnexpectedDecimalsError)) throw error;
        this.unusable.set(ticker.id, error.message);
        this.log.error('ticker unusable', { alert: 'UNEXPECTED_DECIMALS', tickerId: ticker.id, error });
      }
    }
    this.refreshedAt = this.now();
  }

  private async expectDecimals(contract: Address, label: string, expected: number): Promise<void> {
    const decimals = await this.chain.decimals(contract);
    if (decimals !== expected) throw new UnexpectedDecimalsError(label, decimals, expected);
  }

  ticker(id: number): TickerState | undefined {
    return this.tickers.get(id);
  }

  /** Why a ticker cannot be traded by the keeper, or null. */
  unusableReason(id: number): string | null {
    return this.unusable.get(id) ?? null;
  }

  allTickers(): TickerState[] {
    return [...this.tickers.values()].sort((a, b) => a.id - b.id);
  }

  /** Reads every active ticker's feed and the USDG/USD feed. The feeds whose round moved since the last read. */
  async pollFeeds(): Promise<Set<Address>> {
    const feeds = new Set<Address>([USDG_USD_FEED]);
    for (const ticker of this.tickers.values()) if (BigInt(ticker.feed) !== 0n) feeds.add(ticker.feed);
    const moved = new Set<Address>();
    await Promise.all(
      [...feeds].map(async (feed) => {
        const round = await this.chain.latestRound(feed);
        const previous = this.rounds.get(feed);
        if (previous !== undefined && previous.roundId !== round.roundId) moved.add(feed);
        this.rounds.set(feed, round);
      }),
    );
    for (const feed of moved) this.log.info('new feed round', { feed, round: this.rounds.get(feed) });
    return moved;
  }

  round(feed: Address): FeedRound | null {
    return this.rounds.get(lower(feed)) ?? null;
  }

  /** The ticker's allowlisted pools, read from TokenSource now, with their fee tiers. */
  async poolsFor(tickerId: number): Promise<PoolInfo[]> {
    const pools = await this.chain.poolsOf(tickerId);
    return Promise.all(
      pools.map(async (address) => {
        let fee = this.poolFees.get(address);
        if (fee === undefined) {
          fee = await this.chain.poolFee(address);
          this.poolFees.set(address, fee);
        }
        return { address, fee };
      }),
    );
  }

  /** QuoterV2 through each pool for amountIn USDG of the ticker's token. */
  async quotes(tickerId: number, pools: readonly PoolInfo[], amountIn: bigint): Promise<PoolQuote[]> {
    const ticker = this.tickers.get(tickerId);
    if (ticker === undefined) {
      return pools.map((pool) => ({ pool: pool.address, fee: pool.fee, amountOut: null, error: 'unknown ticker' }));
    }
    return Promise.all(
      pools.map(async (pool): Promise<PoolQuote> => {
        try {
          const amountOut = await this.chain.quoteBuy(ticker.token, pool.fee, amountIn);
          return { pool: pool.address, fee: pool.fee, amountOut };
        } catch (error) {
          // QuoterV2 reverts for a pool it cannot route; the pool is left out and the reason kept for the log.
          const reason = error instanceof Error ? (error.message.split('\n')[0] ?? error.name) : String(error);
          return { pool: pool.address, fee: pool.fee, amountOut: null, error: reason };
        }
      }),
    );
  }

  async best(
    tickerId: number,
    pools: readonly PoolInfo[],
    amountIn: bigint,
    exclude: ReadonlySet<Address> = new Set(),
  ): Promise<PoolQuote | null> {
    const usable = pools.filter((pool) => !exclude.has(pool.address));
    return bestPool(await this.quotes(tickerId, usable, amountIn));
  }
}
