import {
  MODULE_PARAMS,
  TOTAL_BPS,
  tokenValueUsdg,
  type Address,
  type RuleInput,
  type TickerId,
} from '@sleeve/core';

import { evaluateEligibility } from '@/lib/eligibility';

import { DataLayerError, isDataLayerError } from '../errors';
import type { PasskeyCeremony } from '../passkey';
import type {
  AccountOverview,
  AccountSetupStep,
  ActionPreview,
  OwnerAction,
  WithdrawRequest,
  CardData,
  CreateAccountInput,
  CreateCardInput,
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
  PasskeyCredential,
  SellRequest,
  Session,
  SleeveDataLayer,
  SplitPreview,
  VerifyResult,
  WalletSigner,
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
  withdraw,
  type MockAccount,
  type MockWorld,
} from './engine';
import { buildFixtureWorld, SAMPLE_PAYERS } from './fixtures';
import { previewAction } from './preview';
import { pseudoHash } from './pseudo-hash';
import { verifyInWorld } from './verify';

export interface MockDataLayerOptions {
  /** Start from this world instead of the sample history. */
  world?: MockWorld;
  /** Simulated network time per call, in milliseconds. Default 0. */
  latencyMs?: number;
  /**
   * The browser's WebAuthn ceremonies (../passkey). With them, a passkey made here is a real passkey for this site and
   * every owner op of its account asks for it; without them, as in tests and on the server, passkeys are simulated.
   */
  passkeys?: PasskeyCeremony;
  /**
   * The server's eligibility check (app/api/eligibility), so the IP country is real even on sample data. Without it
   * the world's ipCountry stands in.
   */
  eligibility?: (input: EligibilityInput) => Promise<EligibilityResult>;
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
  const passkeys = options.passkeys;

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

  /** Credentials this tab made with the browser's own ceremony. Only these can answer a real assertion. */
  const realCredentials = new Set<string>();
  /** Wallets that own accounts made in this tab, by lower-cased owner address. */
  const walletSigners = new Map<string, WalletSigner>();
  let simulatedPasskeys = 0;

  async function pause(): Promise<void> {
    if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs));
  }

  /**
   * A sample address that follows from its owner, as a counterfactual Kernel address does. pseudoHash's four lanes
   * repeat one another, so three labels are joined to keep the address from reading as a pattern.
   */
  function ownerAddress(label: string): `0x${string}` {
    const part = (salt: string) => pseudoHash(`${label}:${salt}`).slice(2, 18);
    return `0x${part('a')}${part('b')}${part('c').slice(0, 8)}`;
  }

  function simulatedPasskey(): PasskeyCredential {
    simulatedPasskeys += 1;
    return {
      credentialId: pseudoHash(`passkey:${simulatedPasskeys}:${world.clock.timestamp}`).slice(2, 45),
      rpId: 'localhost',
      ceremony: 'simulated',
    };
  }

  function challengeBytes(hash: string): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(new ArrayBuffer(32));
    for (let index = 0; index < 32; index += 1) out[index] = Number.parseInt(hash.slice(2 + index * 2, 4 + index * 2), 16);
    return out;
  }

  /**
   * The owner's signature on one owner op. A passkey this tab made answers a real WebAuthn assertion and a wallet this
   * tab connected signs the hash; the sample account and simulated passkeys have nothing to ask, so they pass.
   */
  async function approveOwnerOp(account: MockAccount, label: string): Promise<void> {
    const hash = pseudoHash(`owner-op:${label}:${account.address}:${world.clock.timestamp}`);
    if (account.ownerWallet !== undefined) {
      await walletSigners.get(account.ownerWallet.toLowerCase())?.signHash(hash);
      return;
    }
    if (passkeys !== undefined && realCredentials.has(account.credentialId)) {
      await passkeys.approve(account.credentialId, challengeBytes(hash));
    }
  }

  /** An owner write: one bracketed UserOp, signed by the owner, that lands a few seconds later. */
  async function ownerWrite<T>(label: string, work: (account: MockAccount) => T): Promise<T> {
    await approveOwnerOp(owner(), label);
    return respond(() => {
      const account = owner();
      advanceClock(world, SECONDS_PER_WRITE);
      return work(account);
    });
  }

  /**
   * Onboarding's account (D-019, D-022): the owner signs the first UserOp, which deploys the account and installs the
   * module with the rule; a passkey account that asked for one then installs its recovery signer in a bracketed owner
   * op; and both views are read back before the address is handed out. The address follows from the owner, as the
   * counterfactual Kernel address does, so a second setup with the same owner signs into the account it made.
   */
  async function setUpAccount(input: CreateAccountInput): Promise<Session> {
    const step = (name: AccountSetupStep) => input.onStep?.(name);
    const signer = input.signer ?? { kind: 'passkey' as const, credentialId: (await createPasskey()).credentialId };
    const ownerWallet = signer.kind === 'wallet' ? signer.wallet.address : undefined;
    const credentialId = signer.kind === 'passkey' ? signer.credentialId : '';
    const address = ownerAddress(ownerWallet === undefined ? `account:passkey:${credentialId}` : `account:wallet:${ownerWallet.toLowerCase()}`);

    const existing = lookupAccount(world, address);
    if (existing !== undefined && existing.installedAt !== null) {
      await pause();
      return clone(startSession(existing));
    }

    step('approve');
    const firstOp = pseudoHash(`first-op:${address}:${world.clock.timestamp}`);
    if (signer.kind === 'wallet') await signer.wallet.signHash(firstOp);
    else if (passkeys !== undefined && realCredentials.has(credentialId)) await passkeys.approve(credentialId, challengeBytes(firstOp));
    step('deploy');
    await pause();
    step('install');
    await pause();
    if (input.recoverySigner !== null) {
      step('recovery');
      if (signer.kind === 'passkey' && passkeys !== undefined && realCredentials.has(credentialId)) {
        await passkeys.approve(credentialId, challengeBytes(pseudoHash(`recovery-op:${address}`)));
      }
      await pause();
    }
    step('check');
    await pause();

    const account = createAccount(world, input.rule, input.recoverySigner, { address, credentialId, ownerWallet });
    if (signer.kind === 'wallet') walletSigners.set(signer.wallet.address.toLowerCase(), signer.wallet);
    if (!account.deployed || account.installedAt === null) {
      throw new DataLayerError({ code: 'SourceUnavailable' }, `The Sleeve module is not installed on ${address}`);
    }
    return clone(startSession(account));
  }

  async function createPasskey(): Promise<PasskeyCredential> {
    if (passkeys === undefined) return respond(simulatedPasskey);
    const credential = await passkeys.register();
    realCredentials.add(credential.credentialId);
    return credential;
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
    createPasskey,
    createAccount: setUpAccount,
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
    checkEligibility: (input: EligibilityInput) =>
      options.eligibility === undefined
        ? respond(() => evaluateEligibility(input, world.ipCountry))
        : options.eligibility(input),

    setRule: (input: RuleInput) => ownerWrite('set-rule', (account) => setRule(account, input)),
    pauseRule: () => ownerWrite('pause-rule', (account) => pauseRule(account)),
    resumeRule: () => ownerWrite('resume-rule', (account) => resumeRule(account)),
    split: () =>
      ownerWrite('split', (account) => split(world, account, 'OWNER', contextAtClock(world, account, account.rule.tickerId))),
    settle: (tickerId: TickerId) =>
      ownerWrite('settle', (account) => settle(world, account, tickerId, 'OWNER', contextAtClock(world, account, tickerId))),
    release: (tickerId: TickerId) => ownerWrite('release', (account) => release(world, account, tickerId, world.clock)),
    getSellQuote: (request: SellRequest) =>
      respond((): SellQuote => {
        const account = owner();
        return quoteSell(world, account, request, contextAtClock(world, account, request.tickerId));
      }),
    sell: (request: SellRequest) =>
      ownerWrite('sell', (account) => sell(world, account, request, contextAtClock(world, account, request.tickerId))),
    createCard: (input: CreateCardInput) => ownerWrite('create-card', (account) => createCard(world, account, input)),
    withdraw: (request: WithdrawRequest) => ownerWrite('withdraw', (account) => withdraw(world, account, request)),
    previewAction: (action: OwnerAction) => respond((): ActionPreview => previewAction(world, owner(), action)),

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
