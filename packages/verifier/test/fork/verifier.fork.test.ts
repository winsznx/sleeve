import {
  ADDRESSES,
  DEPLOYMENT_4663,
  aggregatorV3Abi,
  erc20Abi,
  nextSessionTransition,
  sessionIsOpen,
  sessionOpenedAt,
  sleeveModuleAbi,
  type Address,
  type Receipt,
} from '@sleeve/core';
import { encodeFunctionData, keccak256, toHex } from 'viem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runCli } from '../../src/cli/run';
import { createReader, verifyReceipt } from '../../src/verify';
import type { VerifyResult } from '../../src/types';
import { startAnvil, type Anvil } from './anvil';
import {
  SPY,
  actors,
  buyQuote,
  createAccount,
  forkClient,
  installArbSys,
  keeperCall,
  latestRoundId,
  mockFeed,
  ownerOp,
  pay,
  receiptHashSlot,
  receiptIds,
  sellQuote,
  setRound,
  settleCall,
  splitCall,
  warpTo,
  type Actors,
  type ForkClient,
} from './chain';

/**
 * The verifier against the deployed module on an anvil fork of chain 4663 at the latest block. A Kernel v3.1 account
 * installs the module in its first UserOp, receives USDG, and the keeper splits while the market is closed, which
 * queues SESSION on real chain data. The rest needs an open session: the test moves the fork's clock to the next
 * reopen and places fresh SPY and USDG/USD rounds with a mock over the two feed proxies, because the fork's frozen
 * feeds never post a round after the reopen. The tests that do so say so. Swaps go through the real SPY pool.
 */

const MODULE = DEPLOYMENT_4663.contracts.SleeveModule.address;
const RULE = { spendBps: 9_000, equityBps: 1_000, tickerId: SPY.tickerId, premiumCapBps: 100, slippageBps: 50, minClip: 25_000_000n };
const PAYMENT = 1_000_000_000n;
const EQUITY = 100_000_000n;

let anvil: Anvil;
let client: ForkClient;
let who: Actors;
let account: Address;
let fromBlock: bigint;

/** Receipt ids by the step that wrote them. */
const written = new Map<string, bigint>();

function idOf(step: string): bigint {
  const id = written.get(step);
  if (id === undefined) throw new Error(`no receipt from step "${step}": an earlier test failed`);
  return id;
}

async function verify(id: bigint): Promise<VerifyResult> {
  return verifyReceipt(id, { reader: createReader(anvil.url, { minIntervalMs: 0 }), fromBlock });
}

function failing(result: VerifyResult): string[] {
  return [...result.fields, ...result.checks]
    .filter((row) => row.status === 'MISMATCH')
    .map((row) => ('field' in row ? `${row.field}: ${row.receipt} vs ${row.recomputed}` : `${row.id}: ${row.observed} vs ${row.expected}`));
}

function expectAllMatch(result: VerifyResult, status: Receipt['status']): void {
  expect(failing(result)).toEqual([]);
  expect(result.verdict).toBe('MATCH');
  expect(result.receipt?.status).toBe(status);
  expect(result.fields).toHaveLength(39);
}

async function now(): Promise<bigint> {
  return (await client.getBlock()).timestamp;
}

/** The answer at which a buy of `usdgIn` for `tokensOut` pays no premium: ceil(usdgIn * 10^20 / tokensOut). */
function answerFor(usdgIn: bigint, tokensOut: bigint): bigint {
  const scaled = usdgIn * 10n ** 20n;
  return (scaled + tokensOut - 1n) / tokensOut;
}

beforeAll(async () => {
  anvil = await startAnvil();
  client = forkClient(anvil.url);
  await installArbSys(client);
  fromBlock = (await client.getBlockNumber()) + 1n;
  who = await actors(client);
  const t = await now();
  if (sessionIsOpen(t, 'ALL_DAY').open) {
    const close = nextSessionTransition(t, 'ALL_DAY');
    if (close === null) throw new Error('the calendar knows no close after the fork block');
    await warpTo(client, close.at + 60n);
  }
  account = await createAccount(client, who, RULE);
});

afterAll(async () => {
  await anvil?.stop();
});

describe('the verifier on a fork with the deployed module', () => {
  it('matches every field of a split that queued SESSION while the market was closed', async () => {
    await pay(client, account, PAYMENT);
    const { quote } = await buyQuote(client, EQUITY);
    const ids = receiptIds(await keeperCall(client, who.keeper, splitCall(account, quote)));
    expect(ids).toHaveLength(1);
    written.set('queued', ids[0] ?? 0n);

    const result = await verify(idOf('queued'));
    expectAllMatch(result, 'QUEUED');
    expect(result.receipt?.reason).toBe('SESSION');
    expect(result.fields.find((row) => row.field === 'reason')?.source).toMatch(/guard steps/);
    expect(result.derived.find((row) => row.id === 'inbound-total')?.value).toBe(PAYMENT.toString());
  });

  it('matches a settle after the reopen, on mocked fresh SPY and USDG/USD rounds', async () => {
    const open = nextSessionTransition(await now(), 'ALL_DAY');
    if (open === null || !open.opens) throw new Error('no reopen ahead');
    await warpTo(client, open.at + 120n);
    const spyRound = (await latestRoundId(client, SPY.feed)) + 1n;
    const usdgRound = (await latestRoundId(client, ADDRESSES.USDG_USD_FEED)) + 1n;
    await mockFeed(client, SPY.feed);
    await mockFeed(client, ADDRESSES.USDG_USD_FEED);
    const { quote, tokensOut } = await buyQuote(client, EQUITY);
    const at = open.at + 60n;
    await setRound(client, who.feeder, SPY.feed, { roundId: spyRound, answer: answerFor(EQUITY, tokensOut), startedAt: at, updatedAt: at });
    await setRound(client, who.feeder, ADDRESSES.USDG_USD_FEED, { roundId: usdgRound, answer: 100_000_000n, startedAt: at, updatedAt: at });

    const ids = receiptIds(await keeperCall(client, who.keeper, settleCall(account, quote)));
    written.set('settled', ids[0] ?? 0n);
    const result = await verify(idOf('settled'));
    expectAllMatch(result, 'SETTLED');
    expect(result.checks.find((row) => row.id === 'premium-cap')?.status).toBe('MATCH');
    expect(result.checks.find((row) => row.id === 'session-open')?.observed).toBe('open');
  });

  it('matches a split that filled in the open session', async () => {
    await pay(client, account, PAYMENT);
    const { quote } = await buyQuote(client, EQUITY);
    const ids = receiptIds(await keeperCall(client, who.keeper, splitCall(account, quote)));
    written.set('filled', ids[0] ?? 0n);
    const result = await verify(idOf('filled'));
    expectAllMatch(result, 'FILLED');
    expect(result.fields.find((row) => row.field === 'usdgSpent')?.source).toMatch(/Transfer logs/);
  });

  it('groups a sell across both lots into one run and matches each receipt in it', async () => {
    const lotA = await client.readContract({ address: MODULE, abi: sleeveModuleAbi, functionName: 'lot', args: [idOf('settled')] });
    const lotB = await client.readContract({ address: MODULE, abi: sleeveModuleAbi, functionName: 'lot', args: [idOf('filled')] });
    const amount = lotA.tokensRemaining + lotB.tokensRemaining / 2n;
    const quote = await sellQuote(client, amount);
    const sell = encodeFunctionData({ abi: sleeveModuleAbi, functionName: 'sell', args: [SPY.tickerId, amount, 0n, SPY.pool, quote, false, 0] });
    const ids = receiptIds(await ownerOp(client, who, account, [{ target: MODULE, data: sell }]));
    expect(ids).toHaveLength(2);
    const [sold, partSold] = ids;
    if (sold === undefined || partSold === undefined) throw new Error('the sell wrote fewer than two receipts');

    const first = await verify(sold);
    expectAllMatch(first, 'SOLD');
    const second = await verify(partSold);
    expectAllMatch(second, 'PART_SOLD');
    expect(second.derived.find((row) => row.id === 'sell-run-receipts')?.value).toBe(`${sold}, ${partSold}`);
    expect(second.derived.find((row) => row.id === 'sell-tokens')?.value).toBe(amount.toString());
  });

  it('matches a split below the clip and the release of its bucket', async () => {
    await pay(client, account, 100_000_000n);
    const { quote } = await buyQuote(client, 10_000_000n);
    const queued = receiptIds(await keeperCall(client, who.keeper, splitCall(account, quote)));
    written.set('clip', queued[0] ?? 0n);
    const clip = await verify(idOf('clip'));
    expectAllMatch(clip, 'QUEUED');
    expect(clip.receipt?.reason).toBe('CLIP');

    const release = encodeFunctionData({ abi: sleeveModuleAbi, functionName: 'release', args: [SPY.tickerId] });
    const released = receiptIds(await ownerOp(client, who, account, [{ target: MODULE, data: release }]));
    const result = await verify(released[0] ?? 0n);
    expectAllMatch(result, 'RELEASED');
  });

  it('matches the RECONCILED receipt of a split that found an outside pull', async () => {
    // #given the owner approved a third party in a bracketed op, and the third party pulled 50 USDG
    const pulled = 50_000_000n;
    const approve = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [who.feeder, pulled] });
    await ownerOp(client, who, account, [{ target: ADDRESSES.USDG, data: approve }]);
    const pull = await client.sendTransaction({
      account: who.feeder,
      chain: client.chain,
      to: ADDRESSES.USDG,
      data: encodeFunctionData({ abi: erc20Abi, functionName: 'transferFrom', args: [account, who.feeder, pulled] }),
    });
    await client.waitForTransactionReceipt({ hash: pull });
    // #when the keeper splits
    const { quote } = await buyQuote(client, EQUITY);
    const ids = receiptIds(await keeperCall(client, who.keeper, splitCall(account, quote)));
    // #then the split reconciled the pull, and the verifier matches its receipt and the Reconciled log
    const result = await verify(ids[0] ?? 0n);
    expectAllMatch(result, 'RECONCILED');
    expect(result.kind).toBe('LEDGER_RECONCILE');
    expect(result.receipt?.usdgIn).toBe(pulled);
    expect(result.fields.find((row) => row.field === 'usdgSpent')?.source).toMatch(/Reconciled log/);
  });

  it('matches the RECONCILED receipts of a lot reconcile after tokens left the account', async () => {
    // #given the owner moves half of the remaining lot's tokens out and trims the lots in the same bracketed op
    const lot = await client.readContract({ address: MODULE, abi: sleeveModuleAbi, functionName: 'lot', args: [idOf('filled')] });
    const moved = lot.tokensRemaining / 2n;
    const transfer = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [who.feeder, moved] });
    const trim = encodeFunctionData({ abi: sleeveModuleAbi, functionName: 'reconcileLots', args: [SPY.tickerId] });
    // #when
    const ids = receiptIds(await ownerOp(client, who, account, [{ target: SPY.token, data: transfer }, { target: MODULE, data: trim }]));
    // #then
    expect(ids).toHaveLength(1);
    const result = await verify(ids[0] ?? 0n);
    expectAllMatch(result, 'RECONCILED');
    expect(result.kind).toBe('LOT_RECONCILE');
    expect(result.receipt?.tokensIn).toBe(moved);
  });

  it('matches a split that queued PREMIUM after its swap was undone (mocked round far below the pool)', async () => {
    // #given a fresh SPY round at half the pool's price, so any fill is far above the cap
    const { quote, tokensOut } = await buyQuote(client, EQUITY);
    const t = await now();
    const roundId = (await client.readContract({ address: SPY.feed, abi: aggregatorV3Abi, functionName: 'latestRoundData' }))[0] + 1n;
    await setRound(client, who.feeder, SPY.feed, { roundId, answer: answerFor(EQUITY, tokensOut) / 2n, startedAt: t, updatedAt: t });
    await pay(client, account, PAYMENT);
    // #when
    const ids = receiptIds(await keeperCall(client, who.keeper, splitCall(account, quote)));
    // #then
    const result = await verify(ids[0] ?? 0n);
    expectAllMatch(result, 'QUEUED');
    expect(result.receipt?.reason).toBe('PREMIUM');
    expect(result.checks.find((row) => row.id === 'premium-over-cap')?.status).toBe('MATCH');
  });

  it('matches a split that queued STALE on a round sent before the session opened (mocked round)', async () => {
    // #given the latest SPY round predates the reopen
    const opened = sessionOpenedAt(await now(), 'ALL_DAY');
    const roundId = (await client.readContract({ address: SPY.feed, abi: aggregatorV3Abi, functionName: 'latestRoundData' }))[0] + 1n;
    await setRound(client, who.feeder, SPY.feed, { roundId, answer: 77_000_000_000n, startedAt: opened - 100n, updatedAt: opened - 100n });
    await pay(client, account, PAYMENT);
    const { quote } = await buyQuote(client, EQUITY);
    // #when
    const ids = receiptIds(await keeperCall(client, who.keeper, splitCall(account, quote)));
    // #then
    const result = await verify(ids[0] ?? 0n);
    expectAllMatch(result, 'QUEUED');
    expect(result.receipt?.reason).toBe('STALE');
    expect(result.checks.find((row) => row.id === 'guard-outcome')?.observed).toBe('QUEUED STALE');
  });

  it('prints the table and exits 0 from the CLI', async () => {
    let out = '';
    const code = await runCli(
      ['verify', idOf('filled').toString(), '--rpc', anvil.url, '--from-block', fromBlock.toString()],
      { out: (text) => (out += text), err: (text) => (out += text) },
      (id, options) => verifyReceipt(id, { ...options, throttle: { minIntervalMs: 0 } }),
    );
    expect(code).toBe(0);
    expect(out).toMatch(new RegExp(`Receipt ${idOf('filled')}: MATCH`));
  });

  it('reports MISMATCH when the round on chain no longer gives the receipt answer (altered on the mock)', async () => {
    const filled = await verify(idOf('filled'));
    const receipt = filled.receipt;
    if (receipt === null) throw new Error('no receipt');
    const t = receipt.updatedAt;
    await setRound(client, who.feeder, SPY.feed, { roundId: receipt.roundId, answer: receipt.answer * 2n, startedAt: t, updatedAt: t }, false);

    const result = await verify(idOf('filled'));
    expect(result.verdict).toBe('MISMATCH');
    const answer = result.fields.find((row) => row.field === 'answer');
    expect(answer?.status).toBe('MISMATCH');
    expect(answer?.recomputed).toBe((receipt.answer * 2n).toString());
    expect(result.fields.find((row) => row.field === 'premiumBps')?.status).toBe('MISMATCH');
    expect(result.checks.find((row) => row.id === 'receipt-hash')?.status).toBe('MATCH');
  });

  it('reports MISMATCH on the hash and every field only the hash vouches for when the stored hash is altered', async () => {
    const id = idOf('queued');
    const stored = await client.readContract({ address: MODULE, abi: sleeveModuleAbi, functionName: 'receiptHash', args: [id] });
    expect(await client.getStorageAt({ address: MODULE, slot: receiptHashSlot(id) }), 'the receipt hash slot').toBe(stored);
    await client.setStorageAt({ address: MODULE, index: receiptHashSlot(id), value: keccak256(toHex('not the receipt')) });
    const result = await verify(id);
    expect(result.verdict).toBe('MISMATCH');
    expect(result.checks.find((row) => row.id === 'receipt-hash')?.status).toBe('MISMATCH');
    const trigger = result.fields.find((row) => row.field === 'trigger');
    expect(trigger?.status).toBe('MISMATCH');
    expect(trigger?.recomputed).toMatch(/stored hash differs/);
    expect(result.fields.find((row) => row.field === 'usdgToEquity')?.status).toBe('MATCH');
  });
});
