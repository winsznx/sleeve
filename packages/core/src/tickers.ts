import type { Address, Hex, SessionType, TickerId } from './spec';

export type TickerSymbol = 'SPY' | 'QQQ' | 'NVDA' | 'AAPL';

/**
 * A v3 pool on the ticker's allowlist. The factory enables fees 100, 500, 3000 and 10000; SPEC 3 allows the first
 * three.
 */
export interface AllowlistedPool {
  address: Address;
  fee: 100 | 500 | 3000;
}

/** A ticker TokenSource lists, with what the app needs to show and trade it. */
export interface Ticker {
  /** TokenSource id, fixed by the constructor order (SPEC 3). */
  id: TickerId;
  symbol: TickerSymbol;
  /** The underlying, as the token's onchain name() gives it, without the issuer suffix. */
  name: string;
  token: Address;
  /** uid() on the token, equal to the issuer API id (docs/research/issuer-docs.md section 3). */
  tokenUid: Hex;
  feed: Address;
  /** B2-1: ALL_DAY for every launch ticker, set in the TokenSource constructor. */
  sessionType: SessionType;
  /** D-010, in preference order. */
  pools: readonly AllowlistedPool[];
}

export const LAUNCH_TICKERS = [
  {
    id: 0,
    symbol: 'SPY',
    name: 'SPDR S&P 500 ETF Trust',
    token: '0x117cc2133c37B721F49dE2A7a74833232B3B4C0C',
    tokenUid: '0x000000000000000000000000000000001c6f27a62789417d8ed359ed3c2d3da1',
    feed: '0x319724394D3A0e3669269846abE664Cd621f9f6A',
    sessionType: 'ALL_DAY',
    pools: [{ address: '0xa7Bb1AC63BBaB0C44316E6c8C455213441689167', fee: 500 }],
  },
  {
    id: 1,
    symbol: 'QQQ',
    name: 'Invesco QQQ',
    token: '0xD5f3879160bc7c32ebb4dC785F8a4F505888de68',
    tokenUid: '0x000000000000000000000000000000002470b933c52d47ccad017ed9ee80c9ed',
    feed: '0x80901d846d5D7B030F26B480776EE3b29374C2ae',
    sessionType: 'ALL_DAY',
    pools: [{ address: '0xD60A5d14dB690B7Afad71F76B108071D7175597d', fee: 500 }],
  },
  {
    id: 2,
    symbol: 'NVDA',
    name: 'NVIDIA',
    token: '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC',
    tokenUid: '0x00000000000000000000000000000000915f477416294f5099a5e0e09f327ce5',
    feed: '0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15',
    sessionType: 'ALL_DAY',
    pools: [{ address: '0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3', fee: 500 }],
  },
  {
    id: 3,
    symbol: 'AAPL',
    name: 'Apple',
    token: '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9',
    tokenUid: '0x00000000000000000000000000000000c2425be3658540dd8e2424cbf3c5c649',
    feed: '0x6B22A786bAa607d76728168703a39Ea9C99f2cD0',
    sessionType: 'ALL_DAY',
    pools: [
      { address: '0xAae0d815EE56e4092a5E5C2911E676Fea50B2d6D', fee: 500 },
      { address: '0x783C9bbB765047CFdD2b84b92b2Ca9F11D34b7Ed', fee: 3000 },
    ],
  },
] as const satisfies readonly Ticker[];

export function tickerById(id: TickerId): Ticker | undefined {
  return LAUNCH_TICKERS.find((ticker) => ticker.id === id);
}

export function tickerBySymbol(symbol: string): Ticker | undefined {
  return LAUNCH_TICKERS.find((ticker) => ticker.symbol === symbol);
}

export function isPoolAllowlisted(tickerId: TickerId, pool: Address): boolean {
  const ticker = tickerById(tickerId);
  if (ticker === undefined) return false;
  const wanted = pool.toLowerCase();
  return ticker.pools.some((allowed) => allowed.address.toLowerCase() === wanted);
}
