import type { Address } from './spec';

/** Robinhood Chain mainnet. Addresses match internal/CLAUDE.md and contracts/test/utils/Chain4663.sol. */
export const CHAIN_ID = 4663;
export const CHAIN_NAME = 'Robinhood Chain';

/** Rate limited and not meant for production traffic (D-012). The verifier uses it; the keeper never does (D-008). */
export const PUBLIC_RPC_URL = 'https://rpc.mainnet.chain.robinhood.com';
export const EXPLORER_URL = 'https://robinhoodchain.blockscout.com';

export const ADDRESSES = {
  USDG: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
  ENTRY_POINT_V07: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
  PERMIT2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  ARB_SYS: '0x0000000000000000000000000000000000000064',
  SWAP_ROUTER_02: '0xCaf681a66D020601342297493863E78C959E5cb2',
  V3_FACTORY: '0x1f7d7550B1b028f7571E69A784071F0205FD2EfA',
  QUOTER_V2: '0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7',
  USDG_USD_FEED: '0x61B7e5650328764B076A108EFF5fa7282a1B9aD2',
  /** Beacon and blocklist behind every Stock Token (D-011). */
  ACCESS_CONTROLS_REGISTRY: '0xe10b6f6B275de231345c20D14Ab812db62151b00',
} as const satisfies Record<string, Address>;

export const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';

/**
 * Decimals the code expects. Read decimals() at runtime and assert against these; never assume them
 * (build contract, chain facts).
 */
export const EXPECTED_DECIMALS = {
  USDG: 6,
  STOCK_TOKEN: 18,
  FEED: 8,
} as const;

/** Module immutables and guard windows from SPEC 5 and D-014. Durations in seconds. */
export const MODULE_PARAMS = {
  graceSeconds: 3_600n,
  stockFeedMaxAgeSeconds: 90_000n,
  usdgFeedMaxAgeSeconds: 90_000n,
  depegToleranceBps: 50,
  multiplierWindowSeconds: 86_400n,
  timelockDelaySeconds: 172_800n,
  /** Venue 1 on receipts: Uniswap v3 through SwapRouter02. */
  venueUniswapV3: 1,
} as const;

/** Basis points in a whole. Spend and equity shares sum to this (I9). */
export const TOTAL_BPS = 10_000;
