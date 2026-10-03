import {
  ADDRESSES,
  LAUNCH_TICKERS,
  RULE_DEFAULTS,
  execPriceBuy,
  premiumBps,
  tickerById,
  type Address,
  type TickerId,
} from '@sleeve/core';

import type { ChainPoint, FeedReading, TickerMarket } from '../types';
import {
  externalPull,
  installAccount,
  observe,
  ownerOutflow,
  receivePayment,
  release,
  sell,
  setRule,
  settle,
  split,
  type GuardContext,
  type MockAccount,
  type MockWorld,
  type VenueQuote,
} from './engine';

/**
 * Sample history, replayed through the engine so every number obeys the module's rules. The clock stops at the
 * D-008 weekend fork block, 73,280,794 (Saturday 26 September 2026, 14:00 New York), and the live market below is
 * what the chain held at that block (docs/research/chain-constants.md and pools.md). Earlier feed rounds and pool
 * fills are made up in the same range. Addresses other than the chain's own contracts and the keeper are random.
 */

export const FIXTURE_NOW: ChainPoint = { l2Block: 73_280_794n, timestamp: 1_790_445_600n };

/** Blocks per second measured between the two D-008 blocks, times 1,000. */
const BLOCK_RATE_X1000 = 8_484n;

export function pointAt(iso: string): ChainPoint {
  const timestamp = BigInt(Date.parse(iso) / 1_000);
  return {
    timestamp,
    l2Block: FIXTURE_NOW.l2Block + ((timestamp - FIXTURE_NOW.timestamp) * BLOCK_RATE_X1000) / 1_000n,
  };
}

export const SAMPLE_ACCOUNT: Address = '0x3efEf72Ee9aF42fd90f193A1A64aC25384179b36';
export const SAMPLE_CREDENTIAL_ID = 'pQ7vYk2mXc9LrT4bWn8sJd1fHg6aZe3uKo5iVy0tRqA';
export const SAMPLE_RECOVERY_SIGNER: Address = '0x4E1eD4a1AFdceDD8F166307d64b45Bb6c38208c4';
/** Another earner, on the issuer's blocklist, whose public receipt shows REFUSED_ACCOUNT. */
export const SAMPLE_BLOCKED_ACCOUNT: Address = '0x9b2C3fA0E14d6a7E5f8B1C0d2E3F4a5B6c7D8e91';
/** The KEEPER address in docs/PROGRESS.md. */
export const SAMPLE_KEEPER: Address = '0x8649275ca7ce63d2F9E6487570ec0DCe14b6Bf46';

export const SAMPLE_PAYERS = {
  studio: '0x719DBeC8Ea02dA7A16B32dd98a5e0682da5B265F',
  payroll: '0xD7d602160A89BdDB77B6C9048e63C36c8cb1681a',
  agency: '0x557fBFAaC4b40EFcbCf0Cf4F97100fc1ee5699F0',
  friend: '0x15373CA332Fbb73a8559De6E2BB32974dC68d613',
  marketplace: '0xB4aed03af6D22a795fED557fd3EbFE3023D498C7',
} as const satisfies Record<string, Address>;

/** SPY's fee-3000 pool: a real pool, left off the allowlist in D-010. A trigger that names it gets REFUSED_TICKER. */
export const SPY_UNLISTED_POOL: Address = '0xA43b424Bc609495AED4BCD88d654934b510B0aD9';

/** Opaque ids of the two sample cards. */
export const SAMPLE_CARD_IDS = { receipt: 'r8KQm2xV4nPz', week: 'w5Hn9bT6cY1s' } as const;

/** Sunday 27 September 2026, 20:00 New York: the next session open after the clock. */
export const NEXT_OPEN: bigint = pointAt('2026-09-28T00:00:00Z').timestamp;
/** Monday 21 September 2026, 00:00 New York: the week the sample week card covers. */
export const SAMPLE_WEEK_START: bigint = pointAt('2026-09-21T04:00:00Z').timestamp;

/** Sample receipt ids a screen or test can open directly. */
export const SAMPLE_RECEIPT_IDS = {
  queuedClip: 198n,
  released: 203n,
  filledQqq: 212n,
  filledQqqSecond: 305n,
  queuedSessionSettled: 388n,
  settled: 401n,
  sold: 415n,
  partSold: 416n,
  filledSpy: 455n,
  reconciled: 503n,
  refusedAccount: 531n,
  refusedTicker: 560n,
  filledSpySecond: 611n,
  queuedSession: 642n,
} as const;

const SPY = 0;
const QQQ = 1;

const usdg = (whole: string): bigint => {
  const [units = '0', cents = ''] = whole.split('.');
  return BigInt(units) * 1_000_000n + BigInt(cents.padEnd(6, '0'));
};

/** Chainlink phase 1 round ids: (1 << 64) + round. */
const roundId = (round: number): bigint => (1n << 64n) + BigInt(round);

function tickerFeed(tickerId: TickerId): Address {
  const ticker = tickerById(tickerId);
  if (ticker === undefined) throw new Error(`unknown ticker ${tickerId}`);
  return ticker.feed;
}

function stockFeed(tickerId: TickerId, round: number, answer: bigint, updatedIso: string): FeedReading {
  return { feed: tickerFeed(tickerId), roundId: roundId(round), answer, updatedAt: pointAt(updatedIso).timestamp };
}

function liveFeed(tickerId: TickerId, round: bigint, answer: bigint, updatedAt: bigint): FeedReading {
  return { feed: tickerFeed(tickerId), roundId: round, answer, updatedAt };
}

function usdgFeed(round: number, answer: bigint, updatedIso: string): FeedReading {
  return { feed: ADDRESSES.USDG_USD_FEED, roundId: roundId(round), answer, updatedAt: pointAt(updatedIso).timestamp };
}

/** uiMultiplier from the issuer's assets API on 2 October 2026; no change was scheduled in the sample range. */
const MULTIPLIERS: Record<TickerId, bigint> = {
  0: 1_001_717_991_187_472_003n,
  1: 1_000_700_791_241_405_425n,
  2: 1_000_775_159_164_630_595n,
  3: 1_000_566_080_061_092_436n,
};

interface Moment {
  at: ChainPoint;
  tickerId: TickerId;
  feed: FeedReading;
  usdgUsd: FeedReading;
  venue: VenueQuote;
  sessionOpen: boolean;
  reopensAt?: bigint;
  accountBlocked?: boolean;
}

function context(moment: Moment): GuardContext {
  return {
    at: moment.at,
    sessionOpen: moment.sessionOpen,
    reopensAt: moment.reopensAt ?? null,
    feed: moment.feed,
    usdgUsd: moment.usdgUsd,
    uiMultiplier: MULTIPLIERS[moment.tickerId] ?? 0n,
    venue: moment.venue,
    paused: false,
    oraclePaused: false,
    multiplierDue: false,
    feedStale: false,
    usdgDepegged: false,
    accountBlocked: moment.accountBlocked ?? false,
  };
}

const buyAt = (buyPremiumBps: number): VenueQuote => ({ buyPremiumBps, sellDiscountBps: 0 });

interface LiveTicker {
  feed: FeedReading;
  /** QuoterV2 at the clock: what 100 USDG buys on the first allowlisted pool. */
  tokensFor100Usdg: bigint;
  /** Estimated from the pool mid price less the 5 bps pool fee. */
  sellDiscountBps: number;
}

/** Block 73,280,794: feeds from chain-constants.md B.4, pool quotes from pools.md. */
const LIVE: Record<TickerId, LiveTicker> = {
  0: {
    feed: liveFeed(0, 18_446_744_073_709_551_762n, 77_232_802_713n, 1_790_352_180n),
    tokensFor100Usdg: 129_538_580_347_000_000n,
    sellDiscountBps: 15,
  },
  1: {
    feed: liveFeed(1, 18_446_744_073_709_551_992n, 74_535_972_577n, 1_790_352_215n),
    tokensFor100Usdg: 134_235_446_301_000_000n,
    sellDiscountBps: 15,
  },
  2: {
    feed: liveFeed(2, 18_446_744_073_709_552_722n, 22_566_018_707n, 1_790_366_165n),
    tokensFor100Usdg: 444_457_842_218_000_000n,
    sellDiscountBps: 40,
  },
  3: {
    feed: liveFeed(3, 18_446_744_073_709_552_287n, 34_145_318_048n, 1_790_365_765n),
    tokensFor100Usdg: 293_499_729_887_000_000n,
    sellDiscountBps: 32,
  },
};

const LIVE_USDG_USD: FeedReading = {
  feed: ADDRESSES.USDG_USD_FEED,
  roundId: 18_446_744_073_709_551_730n,
  answer: 99_992_581n,
  updatedAt: 1_790_437_071n,
};

function liveMarket(world: MockWorld): void {
  for (const ticker of LAUNCH_TICKERS) {
    const live = LIVE[ticker.id];
    const pool = ticker.pools[0];
    if (live === undefined || pool === undefined) throw new Error(`no live data for ${ticker.symbol}`);
    const usdgIn = 100_000_000n;
    const market: TickerMarket = {
      tickerId: ticker.id,
      active: true,
      session: { open: false, reason: 'WEEKEND', openedAt: null, nextOpenAt: NEXT_OPEN },
      feed: live.feed,
      uiMultiplier: MULTIPLIERS[ticker.id] ?? 0n,
      pendingMultiplier: null,
      paused: false,
      oraclePaused: false,
      poolPrice: {
        pool: pool.address,
        usdgIn,
        tokensOut: live.tokensFor100Usdg,
        execPrice: execPriceBuy(usdgIn, live.tokensFor100Usdg),
        at: FIXTURE_NOW,
      },
    };
    world.market.set(ticker.id, market);
    world.venue.set(ticker.id, {
      buyPremiumBps: Number(premiumBps(usdgIn, live.tokensFor100Usdg, live.feed.answer)),
      sellDiscountBps: live.sellDiscountBps,
    });
  }
  world.usdgUsd = LIVE_USDG_USD;
}

function at(world: MockWorld, iso: string): ChainPoint {
  world.clock = pointAt(iso);
  return world.clock;
}

function pay(world: MockWorld, account: MockAccount, from: Address, amount: string, iso: string): void {
  receivePayment(world, account, { from, amount: usdg(amount), at: at(world, iso) });
}

/** Receipt ids are global, so other accounts' receipts sit in the gaps between the sample's. */
function withId(world: MockWorld, id: bigint): void {
  world.nextReceiptId = id;
}

export function createEmptyWorld(): MockWorld {
  const world: MockWorld = {
    clock: FIXTURE_NOW,
    nextReceiptId: 1n,
    receipts: [],
    lots: new Map(),
    accounts: new Map(),
    session: null,
    lastAccount: null,
    market: new Map(),
    venue: new Map(),
    usdgUsd: LIVE_USDG_USD,
    rounds: new Map(),
    logs: new Map(),
    calendarVersion: 1 << 16,
    defaultKeeper: SAMPLE_KEEPER,
    blockedAccounts: new Set(),
    cards: new Map(),
    ipCountry: 'NG',
    createdAccounts: 0,
  };
  liveMarket(world);
  return world;
}

/** Two weeks of an earner in Lagos: 10 percent to QQQ at first, then 10 percent to SPY. */
function sampleOwnerHistory(world: MockWorld): MockAccount {
  const account = installAccount(world, {
    address: SAMPLE_ACCOUNT,
    credentialId: SAMPLE_CREDENTIAL_ID,
    at: at(world, '2026-09-14T13:10:00Z'),
    rule: { ...RULE_DEFAULTS, tickerId: QQQ },
    recoverySigner: SAMPLE_RECOVERY_SIGNER,
  });

  // Monday: a small payment leaves an equity share under the 25 USDG clip. The owner releases it next morning.
  pay(world, account, SAMPLE_PAYERS.friend, '100', '2026-09-14T19:40:05Z');
  withId(world, SAMPLE_RECEIPT_IDS.queuedClip);
  split(
    world,
    account,
    'KEEPER',
    context({
      at: at(world, '2026-09-14T19:40:31Z'),
      tickerId: QQQ,
      feed: stockFeed(QQQ, 325, 73_885_020_931n, '2026-09-14T19:02:37Z'),
      usdgUsd: usdgFeed(102, 100_003_117n, '2026-09-14T15:36:12Z'),
      venue: buyAt(8),
      sessionOpen: true,
    }),
  );
  withId(world, SAMPLE_RECEIPT_IDS.released);
  release(world, account, QQQ, at(world, '2026-09-15T12:05:00Z'));

  pay(world, account, SAMPLE_PAYERS.studio, '800', '2026-09-15T15:19:48Z');
  withId(world, SAMPLE_RECEIPT_IDS.filledQqq);
  split(
    world,
    account,
    'KEEPER',
    context({
      at: at(world, '2026-09-15T15:20:20Z'),
      tickerId: QQQ,
      feed: stockFeed(QQQ, 331, 74_011_287_312n, '2026-09-15T15:02:11Z'),
      usdgUsd: usdgFeed(102, 100_003_117n, '2026-09-14T15:36:12Z'),
      venue: buyAt(6),
      sessionOpen: true,
    }),
  );

  pay(world, account, SAMPLE_PAYERS.payroll, '412.50', '2026-09-17T19:04:40Z');
  withId(world, SAMPLE_RECEIPT_IDS.filledQqqSecond);
  split(
    world,
    account,
    'KEEPER',
    context({
      at: at(world, '2026-09-17T19:05:09Z'),
      tickerId: QQQ,
      feed: stockFeed(QQQ, 344, 74_287_612_456n, '2026-09-17T18:41:52Z'),
      usdgUsd: usdgFeed(105, 99_998_842n, '2026-09-17T15:36:40Z'),
      venue: buyAt(9),
      sessionOpen: true,
    }),
  );

  at(world, '2026-09-18T16:00:00Z');
  setRule(account, { ...RULE_DEFAULTS });

  // Saturday: the equity share waits for the market, then buys a minute after the Sunday 20:00 reopen.
  pay(world, account, SAMPLE_PAYERS.studio, '650', '2026-09-19T14:12:03Z');
  withId(world, SAMPLE_RECEIPT_IDS.queuedSessionSettled);
  split(
    world,
    account,
    'KEEPER',
    context({
      at: at(world, '2026-09-19T14:12:30Z'),
      tickerId: SPY,
      feed: stockFeed(SPY, 126, 76_986_220_450n, '2026-09-18T19:58:47Z'),
      usdgUsd: usdgFeed(107, 100_000_214n, '2026-09-19T15:37:30Z'),
      venue: buyAt(31),
      sessionOpen: false,
      reopensAt: pointAt('2026-09-21T00:00:00Z').timestamp,
    }),
  );
  withId(world, SAMPLE_RECEIPT_IDS.settled);
  settle(
    world,
    account,
    SPY,
    'KEEPER',
    context({
      at: at(world, '2026-09-21T00:01:12Z'),
      tickerId: SPY,
      feed: stockFeed(SPY, 127, 76_874_401_219n, '2026-09-21T00:00:41Z'),
      usdgUsd: usdgFeed(108, 100_001_502n, '2026-09-20T15:37:02Z'),
      venue: buyAt(11),
      sessionOpen: true,
    }),
  );

  // Monday: rent. The owner sells 0.13 QQQ, oldest lot first, then pays out of spend.
  withId(world, SAMPLE_RECEIPT_IDS.sold);
  sell(
    world,
    account,
    { tickerId: QQQ, amount: 130_000_000_000_000_000n, lotId: 0n, overrideClosed: false, overrideCapBps: 0 },
    context({
      at: at(world, '2026-09-21T15:30:00Z'),
      tickerId: QQQ,
      feed: stockFeed(QQQ, 352, 74_120_931_178n, '2026-09-21T15:12:03Z'),
      usdgUsd: usdgFeed(108, 100_001_502n, '2026-09-20T15:37:02Z'),
      venue: { buyPremiumBps: 0, sellDiscountBps: 8 },
      sessionOpen: true,
    }),
  );
  at(world, '2026-09-21T16:00:00Z');
  ownerOutflow(account, usdg('600'));

  pay(world, account, SAMPLE_PAYERS.agency, '1200', '2026-09-22T13:39:30Z');
  withId(world, SAMPLE_RECEIPT_IDS.filledSpy);
  split(
    world,
    account,
    'KEEPER',
    context({
      at: at(world, '2026-09-22T13:40:02Z'),
      tickerId: SPY,
      feed: stockFeed(SPY, 131, 76_955_120_477n, '2026-09-22T13:31:20Z'),
      usdgUsd: usdgFeed(109, 99_996_210n, '2026-09-21T15:37:20Z'),
      venue: buyAt(4),
      sessionOpen: true,
    }),
  );

  // Wednesday: an old approval pulls 40 USDG. The next payment is smaller, so the split reconciles 15 from spend.
  at(world, '2026-09-23T20:30:00Z');
  externalPull(account, usdg('40'));
  pay(world, account, SAMPLE_PAYERS.friend, '25', '2026-09-23T20:42:10Z');
  withId(world, SAMPLE_RECEIPT_IDS.reconciled);
  split(
    world,
    account,
    'KEEPER',
    context({
      at: at(world, '2026-09-23T20:42:41Z'),
      tickerId: SPY,
      feed: stockFeed(SPY, 138, 77_012_664_190n, '2026-09-23T20:05:33Z'),
      usdgUsd: usdgFeed(111, 100_000_430n, '2026-09-23T15:37:09Z'),
      venue: buyAt(5),
      sessionOpen: true,
    }),
  );
  return account;
}

/** The second half of the sample week, after the blocked earner's receipt takes its id. */
function sampleOwnerLateWeek(world: MockWorld, account: MockAccount): void {
  // Thursday: the keeper is down for an hour. After the grace period a stranger splits through an unlisted pool.
  pay(world, account, SAMPLE_PAYERS.studio, '500', '2026-09-24T17:15:00Z');
  observe(account, at(world, '2026-09-24T17:20:00Z'));
  withId(world, SAMPLE_RECEIPT_IDS.refusedTicker);
  split(
    world,
    account,
    'PUBLIC',
    context({
      at: at(world, '2026-09-24T18:21:00Z'),
      tickerId: SPY,
      feed: stockFeed(SPY, 141, 77_101_334_872n, '2026-09-24T17:58:09Z'),
      usdgUsd: usdgFeed(112, 100_000_875n, '2026-09-24T15:37:15Z'),
      venue: buyAt(6),
      sessionOpen: true,
    }),
    SPY_UNLISTED_POOL,
  );

  pay(world, account, SAMPLE_PAYERS.agency, '937.25', '2026-09-25T14:04:30Z');
  withId(world, SAMPLE_RECEIPT_IDS.filledSpySecond);
  split(
    world,
    account,
    'KEEPER',
    context({
      at: at(world, '2026-09-25T14:05:02Z'),
      tickerId: SPY,
      feed: stockFeed(SPY, 145, 77_190_514_832n, '2026-09-25T13:20:44Z'),
      usdgUsd: usdgFeed(112, 100_000_875n, '2026-09-24T15:37:15Z'),
      venue: buyAt(7),
      sessionOpen: true,
    }),
  );
  at(world, '2026-09-25T22:00:00Z');
  ownerOutflow(account, usdg('1000'));

  // Saturday morning: paid on a weekend, the equity share waits as USDG.
  pay(world, account, SAMPLE_PAYERS.studio, '750', '2026-09-26T13:29:41Z');
  withId(world, SAMPLE_RECEIPT_IDS.queuedSession);
  split(
    world,
    account,
    'KEEPER',
    context({
      at: at(world, '2026-09-26T13:30:10Z'),
      tickerId: SPY,
      feed: LIVE[SPY]?.feed ?? stockFeed(SPY, 146, 77_232_802_713n, '2026-09-25T16:03:00Z'),
      usdgUsd: usdgFeed(113, 100_000_291n, '2026-09-25T15:37:24Z'),
      venue: buyAt(-4),
      sessionOpen: false,
      reopensAt: NEXT_OPEN,
    }),
  );

  // Saturday afternoon: the keeper holds sorting above its gas ceiling, so two payments sit unsorted.
  pay(world, account, SAMPLE_PAYERS.payroll, '120', '2026-09-26T17:22:05Z');
  observe(account, at(world, '2026-09-26T17:22:30Z'));
  pay(world, account, SAMPLE_PAYERS.marketplace, '45.80', '2026-09-26T17:59:20Z');
}

/** Another earner whose account the issuer blocked. The split sends the whole payment to spend. */
function blockedEarnerHistory(world: MockWorld): void {
  const account = installAccount(world, {
    address: SAMPLE_BLOCKED_ACCOUNT,
    credentialId: 'Zr4kT8nWq1YbVx6cJm3sLp9dHf2gAe7uRo5iNy0tKqB',
    at: at(world, '2026-09-22T09:00:00Z'),
    rule: { ...RULE_DEFAULTS },
    recoverySigner: null,
  });
  world.blockedAccounts.add(account.address);
  pay(world, account, SAMPLE_PAYERS.marketplace, '300', '2026-09-24T09:10:12Z');
  withId(world, SAMPLE_RECEIPT_IDS.refusedAccount);
  split(
    world,
    account,
    'KEEPER',
    context({
      at: at(world, '2026-09-24T09:10:40Z'),
      tickerId: SPY,
      feed: stockFeed(SPY, 139, 77_050_215_830n, '2026-09-24T08:47:51Z'),
      usdgUsd: usdgFeed(111, 100_000_430n, '2026-09-23T15:37:09Z'),
      venue: buyAt(6),
      sessionOpen: true,
      accountBlocked: true,
    }),
  );
}

export function buildFixtureWorld(): MockWorld {
  const world = createEmptyWorld();
  const owner = sampleOwnerHistory(world);
  blockedEarnerHistory(world);
  sampleOwnerLateWeek(world, owner);

  world.cards.set(SAMPLE_CARD_IDS.receipt, {
    cardId: SAMPLE_CARD_IDS.receipt,
    account: owner.address,
    subject: { kind: 'receipt', receiptId: SAMPLE_RECEIPT_IDS.filledSpy },
    showAmounts: false,
    showProof: false,
  });
  world.cards.set(SAMPLE_CARD_IDS.week, {
    cardId: SAMPLE_CARD_IDS.week,
    account: owner.address,
    subject: { kind: 'week', weekStart: SAMPLE_WEEK_START },
    showAmounts: false,
    showProof: true,
  });

  world.clock = FIXTURE_NOW;
  world.nextReceiptId = 700n;
  world.session = {
    account: owner.address,
    credentialId: owner.credentialId,
    signedInAt: FIXTURE_NOW.timestamp - 600n,
  };
  world.lastAccount = owner.address;
  return world;
}
