import {
  MODULE_PARAMS,
  TOTAL_BPS,
  tokenValueUsdg,
  type Address,
  type RuleInput,
  type TickerId,
} from '@sleeve/core';

import { jurisdictionBlock } from '@/lib/jurisdictions';

import { DataLayerError, isDataLayerError } from '../errors';
import type {
  AccountOverview,
  CardData,
  CreateAccountInput,
  CreateCardInput,
  EligibilityBlock,
  EligibilityInput,
  EligibilityResult,
  Holding,
  InboxItem,
  LedgerView,
  LotView,
  MarketSnapshot,
  ReceiptPage,
  ReceiptQuery,
  ReceiptRecord,
  SellQuote,
  SellRequest,
  Session,
  SleeveDataLayer,
  SplitPreview,
  VerifyResult,
} from '../types';
import { cardData, createCard } from './cards';
import {
  advanceClock,
  chainPointAfter,
  contextAtClock,
  createAccount,
  lookupAccount,
  pauseRule,
  pendingTotal,
  previewOutcome,
  quoteSell,
  receivePayment,
  release,
  resumeRule,
  sell,
  setRule,
  settle,
  shortfallOf,
  split,
  unsortedOf,
  type MockAccount,
  type MockWorld,
} from './engine';
import { buildFixtureWorld, SAMPLE_PAYERS } from './fixtures';
import { verifyInWorld } from './verify';

export interface MockDataLayerOptions {
  /** Start from this world instead of the sample history. */
  world?: MockWorld;
  /** Simulated network time per call, in milliseconds. Default 0. */
  latencyMs?: number;
}

/**
 * Sample-mode controls with no chain counterpart: they stand in for a payer, the keeper and the market clock so a
 * screen can be watched through a whole payday. Screens never depend on them.
 */
export interface MockControls {
  /** A payer sends USDG to the signed-in owner's account. */
  receivePayment(amount: bigint, from?: Address): InboxItem;
  /** What the keeper would do now: split unsorted USDG, then settle every bucket whose guard clears. */
  runKeeper(): ReceiptRecord[];
  /** Moves the clock to a minute after the next session opens and posts a fresh round on every feed. */
  openMarket(): void;
}

export interface MockDataLayer extends SleeveDataLayer {
  readonly source: 'mock';
  readonly simulate: MockControls;
}

const DEFAULT_RECEIPT_PAGE = 20;
const MAX_RECEIPT_PAGE = 100;
/** Seconds of chain time each owner write takes to land. */
const SECONDS_PER_WRITE = 4n;

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function createMockDataLayer(options: MockDataLayerOptions = {}): MockDataLayer {
  const world = options.world ?? buildFixtureWorld();
  const latencyMs = options.latencyMs ?? 0;

  /** Every answer is a deep copy, so a screen can never change the world by mutating what it got. */
  async function respond<T>(work: () => T): Promise<T> {
    if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs));
    return clone(work());
  }

  function accountOf(address: Address): MockAccount {
    const account = lookupAccount(world, address);
    if (account === undefined) throw new DataLayerError({ code: 'NotFound' }, `No Sleeve account at ${address}`);
    return account;
  }

  function owner(): MockAccount {
    if (world.session === null) throw new DataLayerError({ code: 'NotSignedIn' }, 'Sign in with your passkey first');
    return accountOf(world.session.account);
  }

  /** An owner write: one bracketed UserOp that lands a few seconds later. */
  function ownerWrite<T>(work: (account: MockAccount) => T): Promise<T> {
    return respond(() => {
      const account = owner();
      advanceClock(world, SECONDS_PER_WRITE);
      return work(account);
    });
  }

  function startSession(account: MockAccount): Session {
    world.session = { account: account.address, credentialId: account.credentialId, signedInAt: world.clock.timestamp };
    world.lastAccount = account.address;
    return world.session;
  }

  function ledgerView(account: MockAccount): LedgerView {
    const pending = pendingTotal(account);
    const observation = account.observation;
    return {
      balance: account.usdgBalance,
      spend: account.spend,
      pendingTotal: pending,
      unsorted: unsortedOf(account),
      asOf: world.clock,
      observation:
        observation === null
          ? null
          : { ...observation, graceEndsAt: observation.observedAt + MODULE_PARAMS.graceSeconds },
    };
  }

  function splitPreview(account: MockAccount): SplitPreview {
    const shortfall = shortfallOf(account);
    const unsorted = shortfall > 0n ? 0n : unsortedOf(account);
    const active = account.rule.status === 'ACTIVE';
    const equityPart = active ? (unsorted * BigInt(account.rule.equityBps)) / BigInt(TOTAL_BPS) : 0n;
    const spendPart = active ? unsorted - equityPart : 0n;
    const outcome =
      active && unsorted > 0n
        ? previewOutcome(account, equityPart, contextAtClock(world, account, account.rule.tickerId))
        : null;
    return {
      asOf: world.clock,
      ruleStatus: account.rule.status,
      tickerId: account.rule.tickerId,
      shortfall,
      unsorted,
      spendPart,
      equityPart,
      outcome,
    };
  }

  function holdings(account: MockAccount): Holding[] {
    const result: Holding[] = [];
    const tickerIds = [...account.tokenBalances.keys()].sort((a, b) => a - b);
    for (const tickerId of tickerIds) {
      const balance = account.tokenBalances.get(tickerId) ?? 0n;
      const market = world.market.get(tickerId);
      if (market === undefined) continue;
      const lots: LotView[] = [...world.lots.values()]
        .filter((lot) => lot.account === account.address && lot.tickerId === tickerId && lot.tokensRemaining > 0n)
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .map((lot) => {
          const bought = world.receipts.find((entry) => entry.receipt.id === lot.id)?.receipt;
          return {
            ...lot,
            boughtAt: bought?.timestamp ?? 0n,
            usdgSpent: bought?.usdgSpent ?? 0n,
            execPrice: bought?.execPrice ?? 0n,
            premiumBps: bought?.premiumBps ?? 0n,
            uiMultiplierAtFill: bought?.uiMultiplier ?? 0n,
          };
        });
      if (balance === 0n && lots.length === 0) continue;
      result.push({
        tickerId,
        balance,
        inLots: lots.reduce((total, lot) => total + lot.tokensRemaining, 0n),
        value: tokenValueUsdg(balance, market.feed.answer),
        feed: market.feed,
        lots,
      });
    }
    return result;
  }

  function receiptsPage(query: ReceiptQuery): ReceiptPage {
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_RECEIPT_PAGE, 1), MAX_RECEIPT_PAGE);
    if (query.cursor !== undefined && !/^\d+$/.test(query.cursor)) {
      throw new RangeError(`cursor must be a nextCursor from an earlier page, got ${query.cursor}`);
    }
    const before = query.cursor === undefined ? null : BigInt(query.cursor);
    const wanted = query.account.toLowerCase();
    const matching = world.receipts
      .filter(({ receipt }) => receipt.account.toLowerCase() === wanted)
      .filter(({ receipt }) => query.tickerId === undefined || receipt.tickerId === query.tickerId)
      .filter(({ receipt }) => query.status === undefined || receipt.status === query.status)
      .filter(({ receipt }) => before === null || receipt.id < before)
      .sort((a, b) => (a.receipt.id < b.receipt.id ? 1 : -1));
    const items = matching.slice(0, limit);
    const last = items[items.length - 1];
    return { items, nextCursor: matching.length > limit && last !== undefined ? last.receipt.id.toString() : null };
  }

  function eligibility(input: EligibilityInput): EligibilityResult {
    if (!/^[A-Za-z]{2}$/.test(input.residence.trim())) {
      throw new RangeError(`residence must be an ISO 3166-1 alpha-2 code, got ${input.residence}`);
    }
    const residence = input.residence.trim().toUpperCase();
    const blocks: EligibilityBlock[] = [];
    const byResidence = jurisdictionBlock(residence);
    if (byResidence === 'PROHIBITED') blocks.push({ kind: 'RESIDENCE_PROHIBITED', country: residence });
    if (byResidence === 'RESTRICTED') blocks.push({ kind: 'RESIDENCE_RESTRICTED', country: residence });
    const ipCountry = world.ipCountry;
    const byIp = ipCountry === null ? null : jurisdictionBlock(ipCountry);
    if (ipCountry !== null && byIp === 'PROHIBITED') blocks.push({ kind: 'IP_PROHIBITED', country: ipCountry });
    if (ipCountry !== null && byIp === 'RESTRICTED') blocks.push({ kind: 'IP_RESTRICTED', country: ipCountry });
    if (!input.notUsPerson) blocks.push({ kind: 'US_PERSON' });
    if (!input.notSanctioned) blocks.push({ kind: 'SANCTIONS' });
    return { eligible: blocks.length === 0, ipCountry, blocks };
  }

  function keeperTick(): ReceiptRecord[] {
    const account = owner();
    const written: ReceiptRecord[] = [];
    if (account.rule.status === 'ACTIVE' && (unsortedOf(account) > 0n || shortfallOf(account) > 0n)) {
      written.push(...split(world, account, 'KEEPER', contextAtClock(world, account, account.rule.tickerId)));
    }
    for (const tickerId of [...account.buckets.keys()].sort((a, b) => a - b)) {
      try {
        written.push(settle(world, account, tickerId, 'KEEPER', contextAtClock(world, account, tickerId)));
      } catch (error) {
        const waits = isDataLayerError(error) && (error.code === 'GuardNotClear' || error.code === 'BelowClip');
        if (!waits) throw error;
      }
    }
    return written;
  }

  /**
   * Opens every closed session at the next reopen. Written without a null-initialized `let`: Next's build-time
   * file tracer evaluates `const x = binding + 60n` from the binding's first value and crashes on null.
   */
  function openMarket(): void {
    const closed = [...world.market.values()].filter((market) => !market.session.open);
    const first = closed[0];
    if (first === undefined) return;
    const openedAt = first.session.nextOpenAt ?? world.clock.timestamp;
    for (const market of closed) {
      market.session = { open: true, reason: 'OPEN', openedAt, nextOpenAt: null };
      market.feed = { ...market.feed, roundId: market.feed.roundId + 1n, updatedAt: openedAt + 41n };
    }
    world.usdgUsd = { ...world.usdgUsd, roundId: world.usdgUsd.roundId + 1n, updatedAt: openedAt + 30n };
    const target = openedAt + 60n;
    if (target > world.clock.timestamp) world.clock = chainPointAfter(world.clock, target - world.clock.timestamp);
  }

  const layer: MockDataLayer = {
    source: 'mock',

    getSession: () => respond(() => world.session),
    createAccount: (input: CreateAccountInput) =>
      respond(() => startSession(createAccount(world, input.rule, input.recoverySigner))),
    signIn: () =>
      respond(() => {
        if (world.lastAccount === null) {
          throw new DataLayerError({ code: 'PasskeyCancelled' }, 'No passkey for this site on this device');
        }
        return startSession(accountOf(world.lastAccount));
      }),
    signOut: () =>
      respond(() => {
        world.session = null;
      }),

    getAccount: (address: Address) =>
      respond((): AccountOverview => {
        const account = accountOf(address);
        return {
          address: account.address,
          deployed: account.deployed,
          moduleInstalled: account.installedAt !== null,
          installedAt: account.installedAt,
          keeper: account.keeper,
          keeperIsDefault: account.keeper === world.defaultKeeper,
          recoverySigner: account.recoverySigner,
          accountingMode: 'WRAPPED',
        };
      }),
    getMarket: () =>
      respond(
        (): MarketSnapshot => ({
          asOf: world.clock,
          tickers: [...world.market.values()].sort((a, b) => a.tickerId - b.tickerId),
          usdgUsd: world.usdgUsd,
        }),
      ),
    getLedger: (address: Address) => respond(() => ledgerView(accountOf(address))),
    getRule: (address: Address) => respond(() => accountOf(address).rule),
    getBuckets: (address: Address) =>
      respond(() =>
        [...accountOf(address).buckets.entries()]
          .filter(([, bucket]) => bucket.amount > 0n)
          .sort(([a], [b]) => a - b)
          .map(([tickerId, bucket]) => ({ tickerId, ...bucket })),
      ),
    previewSplit: (address: Address) => respond(() => splitPreview(accountOf(address))),
    getHoldings: (address: Address) => respond(() => holdings(accountOf(address))),
    getInbox: (address: Address) => respond(() => [...accountOf(address).inbox].reverse()),
    listReceipts: (query: ReceiptQuery) => respond(() => receiptsPage(query)),
    getReceipt: (id: bigint) => respond(() => world.receipts.find((entry) => entry.receipt.id === id) ?? null),
    getCard: (cardId: string) =>
      respond((): CardData | null => {
        const stored = world.cards.get(cardId);
        return stored === undefined ? null : cardData(world, stored);
      }),
    verifyReceipt: (id: bigint): Promise<VerifyResult> => respond(() => verifyInWorld(world, id)),
    checkEligibility: (input: EligibilityInput) => respond(() => eligibility(input)),

    setRule: (input: RuleInput) => ownerWrite((account) => setRule(account, input)),
    pauseRule: () => ownerWrite((account) => pauseRule(account)),
    resumeRule: () => ownerWrite((account) => resumeRule(account)),
    split: () =>
      ownerWrite((account) => split(world, account, 'OWNER', contextAtClock(world, account, account.rule.tickerId))),
    settle: (tickerId: TickerId) =>
      ownerWrite((account) => settle(world, account, tickerId, 'OWNER', contextAtClock(world, account, tickerId))),
    release: (tickerId: TickerId) => ownerWrite((account) => release(world, account, tickerId, world.clock)),
    getSellQuote: (request: SellRequest) =>
      respond((): SellQuote => {
        const account = owner();
        return quoteSell(world, account, request, contextAtClock(world, account, request.tickerId));
      }),
    sell: (request: SellRequest) =>
      ownerWrite((account) => sell(world, account, request, contextAtClock(world, account, request.tickerId))),
    createCard: (input: CreateCardInput) => ownerWrite((account) => createCard(world, account, input)),

    simulate: {
      receivePayment: (amount: bigint, from: Address = SAMPLE_PAYERS.studio) => {
        if (amount <= 0n) throw new RangeError('a payment moves more than zero USDG');
        const account = owner();
        return clone(receivePayment(world, account, { from, amount, at: advanceClock(world, 2n) }));
      },
      runKeeper: () => clone(keeperTick()),
      openMarket,
    },
  };
  return layer;
}
