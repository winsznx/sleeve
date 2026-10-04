import { type Address, LAUNCH_TICKERS, type Receipt, type Rule } from '@sleeve/core';
import { type TransactionReceipt, keccak256, parseTransaction } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { beforeEach, describe, expect, it } from 'vitest';

import type { KeeperCall } from '../src/chain/calls';
import type { SettlePreview, SplitPreview } from '../src/chain/gateway';
import { initialHealth } from '../src/health';
import { Indexer } from '../src/index/indexer';
import { Keeper } from '../src/keeper';
import { silentLogger } from '../src/log';
import { Market } from '../src/market';
import { RunRecorder } from '../src/runs';
import { NonceManager } from '../src/tx/nonce';
import { TxSender } from '../src/tx/sender';
import { ADA, blankReceipt, buyReceipt, encodeReceipt } from './schema/fixtures';
import { FakeChain, fakeAccount, idleSplitPreview, revert } from './support/fake-chain';
import { moduleLog, receiptLog, ruleTuple } from './support/logs';
import { MemoryStore } from './support/memory-store';

/** Sunday 4 October 2026 20:00 EDT, the reopen; the head sits a minute after it. */
const REOPEN = 1_791_158_400n;
const SATURDAY = REOPEN - 25n * 3_600n;
const SPY = LAUNCH_TICKERS[0];
const SPY_TOKEN = SPY.token.toLowerCase() as Address;
const SPY_FEED = SPY.feed.toLowerCase() as Address;
const SPY_POOL = SPY.pools[0].address.toLowerCase() as Address;
const OTHER_POOL = '0x783c9bbb765047cfdd2b84b92b2ca9f11d34b7ed';
const CEILING = 100_000_000n;
const RULE: Rule = { version: 1, status: 'ACTIVE', equityBps: 5_000, tickerId: 0, premiumCapBps: 100, slippageBps: 50, minClip: 1_000_000n };

const keeperKey = privateKeyToAccount(generatePrivateKey());
const KEEPER = keeperKey.address.toLowerCase() as Address;

let chain: FakeChain;
let store: MemoryStore;

const income: SplitPreview = { ...idleSplitPreview, unsorted: 10_000_000n, spendPart: 5_000_000n, equityPart: 5_000_000n, buy: true };

function filled(id: bigint): Receipt {
  return {
    ...buyReceipt(id, ADA, { tickerId: 0, tokensOut: 6_400_000_000_000_000n, usdgIn: 10_000_000n }),
    usdgToSpend: 5_000_000n,
    usdgToEquity: 5_000_000n,
    usdgSpent: 5_000_000n,
  };
}

function settled(id: bigint): Receipt {
  return { ...buyReceipt(id, ADA, { tickerId: 0, tokensOut: 6_000_000_000_000_000n, status: 'SETTLED' }), usdgToEquity: 5_000_000n, usdgSpent: 5_000_000n };
}

/** The chain mines the keeper's transaction and ends in the state the receipt describes. */
function mines(receipt: Receipt, after: () => void = () => undefined, status: 'success' | 'reverted' = 'success'): void {
  chain.receiptHashes.set(receipt.id, keccak256(encodeReceipt(receipt)));
  if (receipt.status === 'FILLED' || receipt.status === 'SETTLED') {
    chain.lots.set(receipt.id, { account: ADA, tickerId: 0, status: receipt.status, tokensBought: receipt.tokensOut, tokensRemaining: receipt.tokensOut });
  }
  chain.mined = (hash) => {
    after();
    return {
      transactionHash: hash,
      status,
      blockNumber: chain.head_.number,
      gasUsed: 520_000n,
      effectiveGasPrice: 20_000_000n,
      logs: status === 'success' ? [receiptLog(receipt, { block: chain.head_.number, index: 1, tx: hash })] : [],
    } as unknown as TransactionReceipt;
  };
}

function settlePreview(overrides: Partial<SettlePreview> = {}): SettlePreview {
  return {
    ruleStatus: 'ACTIVE',
    amount: 5_000_000n,
    since: SATURDAY,
    bucketReason: 'SESSION',
    minClip: 1_000_000n,
    status: 'SETTLED',
    reason: 'SESSION',
    buy: true,
    publicReadyAt: REOPEN + 3_600n,
    shortfall: 0n,
    ...overrides,
  };
}

function withBucket(): void {
  const account = chain.accounts.get(ADA);
  if (account === undefined) throw new Error('no ADA');
  account.ledger = { balance: 5_000_000n, spend: 0n, pendingTotal: 5_000_000n, unsorted: 0n };
  account.buckets.set(0, { amount: 5_000_000n, since: SATURDAY, reason: 'SESSION' });
  account.settlePreviews.set(0, settlePreview());
}

function build(options: { dryRun?: boolean } = {}): { keeper: Keeper; health: ReturnType<typeof initialHealth> } {
  const runs = new RunRecorder({ store, log: silentLogger, redact: (text) => text });
  const indexer = new Indexer(chain, store, runs, silentLogger, { confirmations: 0, maxChunkBlocks: 10_000, startBlock: 800n, cursorWriteIntervalMs: 0 });
  const market = new Market(chain, silentLogger);
  const health = initialHealth('test', KEEPER, options.dryRun === true, new Date());
  const sender = options.dryRun === true
    ? null
    : new TxSender({ chain, account: keeperKey, nonces: new NonceManager(() => chain.pendingNonce()), maxFeeWei: 1_000_000_000n, maxGas: 1_200_000n, log: silentLogger });
  const keeper = new Keeper(
    { keeper: KEEPER, dryRun: options.dryRun === true, gasCeilingWei: CEILING, maxFeeWei: 1_000_000_000n, minBalanceWei: 10n ** 15n },
    { chain, store, indexer, market, runs, sender, health, log: silentLogger },
  );
  return { keeper, health };
}

async function onePass(options: { dryRun?: boolean } = {}) {
  const { keeper, health } = build(options);
  await keeper.start();
  const report = await keeper.pass();
  return { keeper, health, report };
}

beforeEach(() => {
  chain = new FakeChain();
  store = new MemoryStore();
  chain.head_ = { number: 1_000n, hash: `0x${'1'.repeat(64)}`, timestamp: REOPEN + 60n, baseFeePerGas: 20_000_000n };
  chain.tickers = [{ id: 0, token: SPY_TOKEN, feed: SPY_FEED, sessionType: 'ALL_DAY', active: true }];
  chain.pools.set(0, [SPY_POOL]);
  chain.fees.set(SPY_POOL, 500);
  chain.quotes.set(SPY_POOL, 1_297_424_691_357_802n);
  chain.rounds.set(SPY_FEED, { roundId: 101n, answer: 77_071_210_575n, startedAt: REOPEN + 30n, updatedAt: REOPEN + 42n });
  chain.logs = [
    moduleLog('Installed', { account: ADA, keeper: KEEPER, spend: 0n }, { block: 900, index: 0 }),
    moduleLog('RuleSet', { account: ADA, version: 1, rule: ruleTuple(RULE) }, { block: 901, index: 0 }),
  ];
  chain.accounts.set(ADA, fakeAccount(KEEPER, { preview: income }));
  chain.simulateCall = (call: KeeperCall) => (call.fn === 'split' ? 1n : 2n);
});

describe('splits', () => {
  it('splits new income through the best pool, sends it, and records success read back from chain state', async () => {
    // #given
    mines(filled(1n));
    // #when
    const { report } = await onePass();
    // #then
    expect([report.actions.map((action) => [action.action, action.outcome]), store.summary(), chain.sent.length]).toEqual([
      [['SPLIT', 'SUCCEEDED']],
      [['SPLIT', 'SUCCEEDED', null]],
      1,
    ]);
  });

  it('passes the QuoterV2 quote per 1e6 USDG and the allowlisted pool', async () => {
    // #given
    mines(filled(1n));
    // #when
    await onePass();
    // #then
    expect(chain.calls.filter((call) => call.startsWith('simulate'))).toEqual([`simulate:split:${SPY_POOL}:1297424691357802`]);
  });

  it('holds sorting above the gas ceiling and records the hold once', async () => {
    // #given
    chain.head_ = { ...chain.head_, baseFeePerGas: CEILING + 1n };
    const { keeper } = build();
    await keeper.start();
    // #when
    await keeper.pass();
    await keeper.pass();
    // #then
    expect([store.summary(), chain.calls.some((call) => call.startsWith('simulate'))]).toEqual([[['SPLIT', 'SKIPPED', 'GAS_CEILING']], false]);
  });

  it('sorts above the ceiling once the oldest payment has waited 24 hours', async () => {
    // #given
    chain.head_ = { ...chain.head_, baseFeePerGas: CEILING * 5n };
    store.oldestPayment = chain.head_.timestamp - 86_400n;
    mines(filled(1n));
    // #when
    const { report } = await onePass();
    // #then
    expect(report.actions[0]?.outcome).toBe('SUCCEEDED');
  });

  it('waits on dust under 1 USDG', async () => {
    // #given
    chain.accounts.set(ADA, fakeAccount(KEEPER, { preview: { ...income, unsorted: 999_999n, equityPart: 499_999n, spendPart: 500_000n, buy: false } }));
    // #when
    await onePass();
    // #then
    expect(store.summary()).toEqual([['SPLIT', 'SKIPPED', 'DUST']]);
  });

  it('reconciles an outside pull even above the ceiling, with no swap', async () => {
    // #given
    chain.head_ = { ...chain.head_, baseFeePerGas: CEILING * 5n };
    chain.accounts.set(ADA, fakeAccount(KEEPER, { preview: { ...idleSplitPreview, shortfall: 150n } }));
    mines({ ...blankReceipt(1n, ADA), status: 'RECONCILED', usdgIn: 150n, usdgSpent: 150n, token: '0x0000000000000000000000000000000000000000' });
    // #when
    const { report } = await onePass();
    // #then
    expect([report.actions[0]?.outcome, chain.calls.filter((call) => call.startsWith('simulate'))]).toEqual([
      'SUCCEEDED',
      [`simulate:split:${SPY_POOL}:1`],
    ]);
  });

  it('moves to the next allowlisted pool when the first is blocked (D-011)', async () => {
    // #given
    chain.pools.set(0, [SPY_POOL, OTHER_POOL]);
    chain.fees.set(OTHER_POOL, 3000);
    chain.quotes.set(OTHER_POOL, 1_000_000_000_000_000n);
    chain.simulateCall = (call) => {
      if (call.pool === SPY_POOL) throw revert('PoolBlocked', [SPY_POOL]);
      return 1n;
    };
    mines(filled(1n));
    // #when
    await onePass();
    // #then
    expect(chain.calls.filter((call) => call.startsWith('simulate')).map((call) => call.split(':')[2])).toEqual([SPY_POOL, OTHER_POOL]);
  });

  it('reads the allowlist again after PoolNotAllowed (A1-17)', async () => {
    // #given
    let removed = false;
    chain.simulateCall = (call) => {
      if (call.pool === SPY_POOL && !removed) {
        removed = true;
        chain.pools.set(0, [OTHER_POOL]);
        chain.fees.set(OTHER_POOL, 3000);
        chain.quotes.set(OTHER_POOL, 1_000_000_000_000_000n);
        throw revert('PoolNotAllowed', [0, SPY_POOL]);
      }
      return 1n;
    };
    mines(filled(1n));
    // #when
    const { report } = await onePass();
    // #then
    expect([report.actions[0]?.outcome, chain.calls.filter((call) => call.startsWith('poolsOf')).length > 1]).toEqual(['SUCCEEDED', true]);
  });

  it('sends nothing while the base fee is above the fee cap, even for a payment that waited 24 hours', async () => {
    // #given
    chain.head_ = { ...chain.head_, baseFeePerGas: 2_000_000_000n };
    store.oldestPayment = chain.head_.timestamp - 90_000n;
    // #when
    await onePass();
    // #then
    expect([store.summary(), chain.sent.length, chain.calls.some((call) => call.startsWith('simulate'))]).toEqual([
      [['SPLIT', 'SKIPPED', 'FEE_ABOVE_CAP']],
      0,
      false,
    ]);
  });

  it('records a REVERTED run with its transaction when the chain reverts the call', async () => {
    // #given
    mines(filled(1n), () => undefined, 'reverted');
    // #when
    const { report } = await onePass();
    // #then
    expect([report.actions[0]?.outcome, report.actions[0]?.txHash !== null]).toEqual(['REVERTED', true]);
  });

  it('records FAILED when the mined transaction did not leave the promised state', async () => {
    // #given
    mines(filled(1n), () => {
      const account = chain.accounts.get(ADA);
      if (account !== undefined) account.ledger = { ...account.ledger, unsorted: 10_000_000n };
    });
    // #when
    await onePass();
    // #then
    expect(store.actionRuns()[0]?.finish?.outcome).toBe('FAILED');
  });
});

describe('accounts the keeper leaves alone', () => {
  it.each([
    ['the module is no longer listed', { listed: false }, 'MODULE_NOT_LISTED'],
    ['the account is not a Kernel v3.1 proxy (A1-23)', { code: '0x6080604052' as const }, 'NOT_KERNEL_V31'],
    ["the owner's bracket is open", { bracketOpen: true }, 'OWNER_OP_OPEN'],
  ])('skips when %s', async (_label, overrides, why) => {
    // #given
    chain.accounts.set(ADA, fakeAccount(KEEPER, { preview: income, ...overrides }));
    // #when
    await onePass();
    // #then
    expect([store.summary(), chain.calls.some((call) => call.startsWith('previewSplit'))]).toEqual([[['SPLIT', 'SKIPPED', why]], false]);
  });

  it('never reads an account whose live keeper is another key', async () => {
    // #given
    chain.accounts.set(ADA, fakeAccount('0x8649275ca7ce63d2f9e6487570ec0dce14b6bf46', { preview: income }));
    // #when
    await onePass();
    // #then
    expect([store.actionRuns().length, chain.calls.some((call) => call.startsWith('previewSplit'))]).toEqual([0, false]);
  });
});

describe('settles', () => {
  beforeEach(() => {
    chain.accounts.set(ADA, fakeAccount(KEEPER));
    withBucket();
  });

  it('settles at the reopen once the first fresh round is in, and clears the wait', async () => {
    // #given
    store.waits.set(`${ADA}:0`, { account: ADA, tickerId: 0, reason: 'SESSION', bucketSince: SATURDAY, firstSeenAt: SATURDAY, lastSeenAt: SATURDAY });
    mines(settled(2n), () => chain.accounts.get(ADA)?.buckets.delete(0));
    // #when
    const { report } = await onePass();
    // #then
    expect([report.actions.map((action) => [action.action, action.outcome]), store.waits.size]).toEqual([[['SETTLE', 'SUCCEEDED']], 0]);
  });

  it('waits for the first round after the opening before it asks the module', async () => {
    // #given
    chain.rounds.set(SPY_FEED, { roundId: 100n, answer: 77_071_210_575n, startedAt: REOPEN - 3_600n, updatedAt: REOPEN - 3_588n });
    const { keeper } = build();
    await keeper.start();
    await keeper.pass();
    chain.calls = [];
    // #when
    await keeper.pass();
    // #then
    expect(chain.calls.some((call) => call.startsWith('previewSettle'))).toBe(false);
  });

  it('records PREMIUM as the wait when the settle simulation says GuardNotClear(PREMIUM)', async () => {
    // #given
    chain.simulateCall = () => {
      throw revert('GuardNotClear', [8]);
    };
    // #when
    await onePass();
    // #then
    expect([store.waits.get(`${ADA}:0`)?.reason, store.summary()]).toEqual(['PREMIUM', [['SETTLE', 'SKIPPED', null]]]);
  });

  it('records the reason previewSettle gives while the guard is not clear, without simulating', async () => {
    // #given
    chain.accounts.get(ADA)?.settlePreviews.set(0, settlePreview({ status: 'QUEUED', reason: 'MULTIPLIER', buy: false }));
    // #when
    await onePass();
    // #then
    expect([store.waits.get(`${ADA}:0`)?.reason, chain.calls.some((call) => call.startsWith('simulate'))]).toEqual(['MULTIPLIER', false]);
  });

  it('sends a refused bucket to spend with no swap', async () => {
    // #given
    chain.accounts.get(ADA)?.settlePreviews.set(0, settlePreview({ status: 'REFUSED_TICKER', buy: false }));
    mines({ ...blankReceipt(2n, ADA), status: 'REFUSED_TICKER', usdgToEquity: 5_000_000n, usdgToSpend: 5_000_000n }, () => chain.accounts.get(ADA)?.buckets.delete(0));
    // #when
    const { report } = await onePass();
    // #then
    expect([report.actions[0]?.outcome, chain.calls.filter((call) => call.startsWith('simulate'))]).toEqual(['SUCCEEDED', [`simulate:settle:${SPY_POOL}:1297424691357802`]]);
  });
});

describe('dry run', () => {
  it('decides and simulates but never signs or sends', async () => {
    // #given
    mines(filled(1n));
    // #when
    const { report } = await onePass({ dryRun: true });
    // #then
    expect([report.actions[0]?.outcome, report.actions[0]?.detail.dryRun, chain.sent.length]).toEqual(['SKIPPED', true, 0]);
  });
});

describe('alerts', () => {
  it('raises LOW_BALANCE under the minimum', async () => {
    // #given
    chain.keeperBalance = 10n ** 14n;
    // #when
    const { health } = await onePass();
    // #then
    expect([...health.alerts.keys()]).toEqual(['LOW_BALANCE']);
  });

  it('warns 30 days before the calendar coverage ends, and says when it has ended (A1-36)', async () => {
    // #given
    chain.coverageEnd = chain.head_.timestamp + 10n * 86_400n;
    const soon = (await onePass()).health;
    chain.coverageEnd = chain.head_.timestamp;
    // #when
    const ended = (await onePass()).health;
    // #then
    expect([[...soon.alerts.keys()], [...ended.alerts.keys()]]).toEqual([['CALENDAR_COVERAGE'], ['CALENDAR_EXPIRED']]);
  });
});

describe('the transaction', () => {
  it('goes to the module with the keeper key', async () => {
    // #given
    mines(filled(1n));
    // #when
    await onePass();
    // #then
    const tx = parseTransaction(chain.sent[0] ?? '0x');
    expect(tx.to?.toLowerCase()).toBe('0x15fa6775fcdb5904aa673967461dc1fa3c6e7ac9');
  });
});
