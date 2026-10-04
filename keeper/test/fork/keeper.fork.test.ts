import { execFile } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { PGlite } from '@electric-sql/pglite';
import {
  ADDRESSES,
  DEPLOYMENT_4663,
  LAUNCH_TICKERS,
  type Receipt,
  type RuleInput,
  aggregatorV3Abi,
  erc20Abi,
  nextSessionTransition,
  quoterV2Abi,
  sessionIsOpen,
  sleeveModuleAbi,
} from '@sleeve/core';
import {
  type Address,
  type Hex,
  type PublicClient,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  getAbiItem,
  http,
  keccak256,
  parseEther,
  stringToHex,
} from 'viem';
import { type PrivateKeyAccount, generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type KeeperApp, createKeeperApp } from '../../src/app';
import { robinhoodChain } from '../../src/chain/client';
import { decodeModuleLog } from '../../src/chain/events';
import { loadConfig } from '../../src/config';
import { healthReport, startHealthServer } from '../../src/health';
import { createLogger } from '../../src/log';
import { openDatabase } from '../schema/database';
import { type FakeRest, type ServedRest, postgrestOnPglite, serveRest } from '../support/postgrest';
import { type Anvil, startAnvil, word } from './anvil';
import { accountAddress, bracketedOwnerOp, initCode, installModuleCall, sendUserOp, sleeveInstallData } from './kernel-account';

/**
 * The keeper against an anvil fork of Robinhood Chain mainnet at the archive RPC's latest block, with the deployed
 * SleeveModule, TokenSource, calendar, tokens, feeds and pools. A Kernel v3.1 account is created through the deployed
 * factory with an ECDSA root and the module installed in its first UserOp (D-019); a bracketed owner op sets the
 * rule (50 percent to SPY, 1 USDG clip); a payer sends 10 USDG; the keeper runs once from the built bundle, as on the
 * VPS, with its index in PGlite behind the same supabase-js store it uses in production.
 *
 * The index starts at the fork block: dRPC's free tier answers eth_getLogs for at most 101 blocks on this chain, so
 * reading the 100,000 and more blocks since the deploy through the fork would take most of an hour. That skips
 * nothing the test reads while the module has written no receipt before the fork (nextReceiptId is 1), which the test
 * checks; the indexer's path from the deploy block is covered by test/index/indexer.test.ts.
 *
 * Phase 1 uses real chain state with the market closed: if the fork lands in a session, time is moved to the next
 * close first. The split must queue SESSION.
 * Phase 2 is labeled MOCKED: time moves to the next session opening and the SPY and USDG/USD feeds are replaced with
 * a stand-in posting a fresh round (priced at the pool, so the premium check passes), because the real feeds post
 * nothing on a fork. A new payment must fill and the queued bucket must settle.
 */

const execFileAsync = promisify(execFile);
const KEEPER_DIR = new URL('../../', import.meta.url).pathname;
const FORK_RPC = process.env.FORK_RPC ?? 'https://robinhood.drpc.org';
const MODULE: Address = DEPLOYMENT_4663.contracts.SleeveModule.address;
const USDG: Address = ADDRESSES.USDG;
const SPY = LAUNCH_TICKERS[0];
const SPY_POOL: Address = SPY.pools[0].address;
/** A USDG holder on the fork: the QQQ pool, which the test never trades through. */
const USDG_SOURCE: Address = LAUNCH_TICKERS[1].pools[0].address;
/** test/fork/MockAggregator.sol, compiled with solc 0.8.28 --optimize --metadata-hash none. */
const MOCK_AGGREGATOR: Hex =
  '0x608060405234801561000f575f5ffd5b506004361061003f575f3560e01c8063313ce567146100435780639a6fc8f514610057578063feaf968c146100bf575b5f5ffd5b604051600881526020015b60405180910390f35b6100886100653660046100df565b505f5460015460025460035469ffffffffffffffffffff90931693919290918490565b6040805169ffffffffffffffffffff968716815260208101959095528401929092526060830152909116608082015260a00161004e565b5f5460015460025460035469ffffffffffffffffffff9093169283610088565b5f602082840312156100ef575f5ffd5b813569ffffffffffffffffffff81168114610108575f5ffd5b939250505056fea164736f6c634300081c000a';
const RULE: RuleInput = { spendBps: 5_000, equityBps: 5_000, tickerId: 0, premiumCapBps: 100, slippageBps: 50, minClip: 1_000_000n };
const NO_RULE: RuleInput = { spendBps: 0, equityBps: 0, tickerId: 0, premiumCapBps: 0, slippageBps: 0, minClip: 0n };

let anvil: Anvil;
let client: PublicClient;
let db: PGlite;
let rest: FakeRest;
let served: ServedRest;
let keyDir: string;
let keeperKeyFile: string;
let keeper: PrivateKeyAccount;
let bundler: PrivateKeyAccount;
let payer: PrivateKeyAccount;
let account: Address;
let firstQueue: Receipt;
let forkBlock: bigint;

function wallet(signer: PrivateKeyAccount | Address) {
  return createWalletClient({ account: signer, chain: robinhoodChain(anvil.url), transport: http(anvil.url) });
}

async function setBalance(address: Address, ether: string): Promise<void> {
  await anvil.rpc('anvil_setBalance', [address, `0x${parseEther(ether).toString(16)}`]);
}

async function moveTimeTo(timestamp: bigint): Promise<void> {
  await anvil.rpc('evm_setNextBlockTimestamp', [`0x${timestamp.toString(16)}`]);
  await anvil.rpc('evm_mine', []);
}

async function pay(amount: bigint): Promise<void> {
  await anvil.rpc('anvil_impersonateAccount', [USDG_SOURCE]);
  await setBalance(USDG_SOURCE, '1');
  const source = wallet(USDG_SOURCE);
  const funding = await source.writeContract({ address: USDG, abi: erc20Abi, functionName: 'transfer', args: [payer.address, amount], chain: null });
  await client.waitForTransactionReceipt({ hash: funding });
  await anvil.rpc('anvil_stopImpersonatingAccount', [USDG_SOURCE]);
  const payment = await wallet(payer).writeContract({ address: USDG, abi: erc20Abi, functionName: 'transfer', args: [account, amount], chain: null });
  await client.waitForTransactionReceipt({ hash: payment });
}

function env(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    KEEPER_RPC: anvil.url,
    KEEPER_PRIVATE_KEY_FILE: keeperKeyFile,
    SUPABASE_URL: served.url,
    SUPABASE_SERVICE_ROLE_KEY: 'test-test-test-test',
    KEEPER_CONFIRMATIONS: '0',
    KEEPER_HEALTH_PORT: '0',
    KEEPER_LOG_LEVEL: 'warn',
    ...overrides,
  };
}

async function app(overrides: Record<string, string> = {}, dryRun = false): Promise<KeeperApp> {
  const config = loadConfig({ ...env(overrides), SUPABASE_URL: rest.url }, { dryRun });
  return createKeeperApp(config, { dryRun }, { storeFetch: rest.fetch, log: createLogger({ level: 'warn' }) });
}

/** The account's receipts, decoded from the module's ReceiptWritten logs on the fork. */
async function receiptsOnChain(): Promise<{ receipt: Receipt; data: Hex }[]> {
  const logs = await client.getLogs({
    address: MODULE,
    event: getAbiItem({ abi: sleeveModuleAbi, name: 'ReceiptWritten' }),
    args: { account },
    fromBlock: forkBlock,
  });
  return logs.flatMap((log) => {
    const event = decodeModuleLog(log);
    return event?.kind === 'ReceiptWritten' ? [{ receipt: event.receipt, data: event.data }] : [];
  });
}

async function readModule<T>(functionName: string, args: readonly unknown[]): Promise<T> {
  return client.readContract({ address: MODULE, abi: sleeveModuleAbi, functionName, args } as Parameters<typeof client.readContract>[0]) as Promise<T>;
}

async function rows<T>(sql: string): Promise<T[]> {
  return (await db.query<T>(sql)).rows;
}

/** A fresh round on a feed: the stand-in's code at the feed address and the round in its first four slots. */
async function postRound(feed: Address, answer: bigint, at: bigint): Promise<void> {
  const [roundId] = (await client.readContract({ address: feed, abi: aggregatorV3Abi, functionName: 'latestRoundData' })) as readonly [bigint, ...unknown[]];
  await anvil.rpc('anvil_setCode', [feed, MOCK_AGGREGATOR]);
  const slots = [roundId + 1n, answer, at - 30n, at - 20n];
  for (const [slot, value] of slots.entries()) await anvil.rpc('anvil_setStorageAt', [feed, word(BigInt(slot)), word(value)]);
}

beforeAll(async () => {
  await execFileAsync('node', ['scripts/build.mjs'], { cwd: KEEPER_DIR });
  anvil = await startAnvil(FORK_RPC);
  client = createPublicClient({ chain: robinhoodChain(anvil.url), transport: http(anvil.url) });
  forkBlock = await client.getBlockNumber();
  db = await openDatabase({ seed: false });
  const nextReceiptId = await client.readContract({ address: MODULE, abi: sleeveModuleAbi, functionName: 'nextReceiptId' });
  if (nextReceiptId !== 1n) throw new Error(`the module wrote ${nextReceiptId - 1n} receipts before the fork; index from the deploy block instead`);
  const forked = await client.getBlock({ blockNumber: forkBlock });
  for (const stream of ['sleeve_module', 'usdg_transfers']) {
    await db.query('insert into public.chain_cursor (stream, last_block, last_block_hash) values ($1, $2, $3)', [stream, forkBlock.toString(), forked.hash]);
  }
  rest = postgrestOnPglite(db);
  served = await serveRest(rest);
  keyDir = await mkdtemp(join(tmpdir(), 'sleeve-keeper-fork-'));
  const keeperKey = generatePrivateKey();
  keeper = privateKeyToAccount(keeperKey);
  keeperKeyFile = join(keyDir, 'keeper.key');
  await writeFile(keeperKeyFile, `${keeperKey}\n`, { mode: 0o600 });
  await chmod(keeperKeyFile, 0o600);
  bundler = privateKeyToAccount(generatePrivateKey());
  payer = privateKeyToAccount(generatePrivateKey());
  for (const funded of [keeper.address, bundler.address, payer.address]) await setBalance(funded, '1');
});

afterAll(async () => {
  await served?.close();
  await anvil?.stop();
  await db?.close();
  if (keyDir !== undefined) await rm(keyDir, { recursive: true, force: true });
});

describe('the keeper on a fork of chain 4663 with the deployed module', () => {
  it('phase 1, real state with the market closed: holds under a zero ceiling, then queues the payment with SESSION', async () => {
    // #given the market closed, at the fork's own time or at the next close
    const now = (await client.getBlock()).timestamp;
    if (sessionIsOpen(now, 'ALL_DAY').open) {
      const close = nextSessionTransition(now, 'ALL_DAY');
      if (close === null) throw new Error('no session close ahead in the calendar');
      await moveTimeTo(close.at + 60n);
    }
    // #given a Kernel v3.1 account with the module installed in its first UserOp, and the rule set in a bracketed op
    const owner = privateKeyToAccount(generatePrivateKey());
    const salt = keccak256(stringToHex(`sleeve keeper fork ${owner.address}`));
    account = await accountAddress(client, owner.address, salt);
    await setBalance(account, '1');
    const installed = await sendUserOp(client, wallet(bundler), owner, {
      sender: account,
      initCode: initCode(owner.address, salt),
      callData: installModuleCall(MODULE, sleeveInstallData(keeper.address, NO_RULE)),
    });
    const ruled = await sendUserOp(client, wallet(bundler), owner, {
      sender: account,
      initCode: '0x',
      callData: bracketedOwnerOp(MODULE, [{ to: MODULE, data: encodeFunctionData({ abi: sleeveModuleAbi, functionName: 'setRule', args: [RULE] }) }]),
    });
    expect([installed.success, ruled.success, (await readModule<Address>('keeperOf', [account])).toLowerCase()]).toEqual([
      true,
      true,
      keeper.address.toLowerCase(),
    ]);
    // #given a 10 USDG payment
    await pay(10_000_000n);

    // #when the keeper runs with a zero gas ceiling
    const held = await app({ KEEPER_GAS_CEILING_GWEI: '0' });
    await held.keeper.start();
    await held.keeper.pass();
    // #then it sorts nothing and records the hold
    expect(await readModule<bigint>('nextReceiptId', [])).toBe(1n);
    expect(await rows<{ skipped: string }>(`select detail->>'skipped' as skipped from public.keeper_runs where action = 'SPLIT'`)).toEqual([{ skipped: 'GAS_CEILING' }]);

    // #when the built keeper runs once, as on the server
    const { stdout } = await execFileAsync('node', ['dist/main.js', '--once'], { cwd: KEEPER_DIR, env: { ...process.env, ...env({ KEEPER_LOG_LEVEL: 'info' }) } });

    // #then the chain holds a QUEUED SESSION receipt for the payment, with the equity half in the SPY bucket
    const onChain = await receiptsOnChain();
    expect(onChain.map(({ receipt }) => [receipt.id, receipt.status, receipt.reason, receipt.trigger, receipt.usdgIn, receipt.usdgToSpend, receipt.usdgQueued])).toEqual([
      [1n, 'QUEUED', 'SESSION', 'KEEPER', 10_000_000n, 5_000_000n, 5_000_000n],
    ]);
    firstQueue = onChain[0]?.receipt as Receipt;
    expect(await readModule<Hex>('receiptHash', [1n])).toBe(keccak256(onChain[0]?.data ?? '0x'));
    expect(await readModule<readonly bigint[]>('ledger', [account])).toEqual([10_000_000n, 5_000_000n, 5_000_000n, 0n]);
    expect(await readModule<{ amount: bigint; reason: number }>('bucketOf', [account, 0])).toMatchObject({ amount: 5_000_000n, reason: 3 });

    // #then the index holds the account, its rule, the receipt and the sorted payment, and the wait
    expect(await rows(`select keeper::text, rule->>'status' as status, rule->>'version' as version, uninstalled_at_block from public.accounts`)).toEqual([
      { keeper: keeper.address.toLowerCase(), status: 'ACTIVE', version: '1', uninstalled_at_block: null },
    ]);
    expect(await rows(`select version, equity_bps, min_clip::text from public.rule_versions`)).toEqual([{ version: 1, equity_bps: 5_000, min_clip: '1000000' }]);
    expect(await rows(`select receipt_id::text, status::text, reason::text from public.receipts`)).toEqual([{ receipt_id: '1', status: 'QUEUED', reason: 'SESSION' }]);
    expect(await rows(`select amount::text, status::text, sorted_by_receipt_id::text, from_address::text from public.payments`)).toEqual([
      { amount: '10000000', status: 'SORTED', sorted_by_receipt_id: '1', from_address: payer.address.toLowerCase() },
    ]);
    expect(await rows(`select ticker_id, reason::text from public.bucket_waits`)).toEqual([{ ticker_id: 0, reason: 'SESSION' }]);
    expect(await rows(`select action::text, outcome::text from public.keeper_runs where action = 'SPLIT' and outcome = 'SUCCEEDED'`)).toEqual([
      { action: 'SPLIT', outcome: 'SUCCEEDED' },
    ]);

    console.info(
      JSON.stringify({ phase: 1, forkBlock: forkBlock.toString(), account, receipt: { id: '1', status: firstQueue.status, reason: firstQueue.reason, timestamp: firstQueue.timestamp.toString() } }),
    );

    // #then the process printed a health report with the index at the head
    const health = stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((line) => line.msg === 'health');
    expect([health?.lastIndexedBlock, health?.accountsTracked]).toEqual([(await client.getBlockNumber()).toString(), 1]);
  });

  it('phase 2, MOCKED fresh rounds after the reopen: a dry run sends nothing, then the payment fills and the bucket settles', async () => {
    // #given the next session opening, and fresh SPY and USDG/USD rounds posted by the stand-in (MOCKED)
    const now = (await client.getBlock()).timestamp;
    const open = nextSessionTransition(now, 'ALL_DAY');
    if (open === null || !open.opens) throw new Error('no session opening ahead in the calendar');
    await moveTimeTo(open.at + 120n);
    const opened = (await client.getBlock()).timestamp;
    const [tokensFor5Usdg] = (
      await client.simulateContract({
        address: ADDRESSES.QUOTER_V2,
        abi: quoterV2Abi,
        functionName: 'quoteExactInputSingle',
        args: [{ tokenIn: USDG, tokenOut: SPY.token, amountIn: 5_000_000n, fee: 500, sqrtPriceLimitX96: 0n }],
      })
    ).result;
    const poolPrice = (5_000_000n * 10n ** 20n) / tokensFor5Usdg;
    await postRound(SPY.feed, (poolPrice * 101n) / 100n, opened);
    await postRound(ADDRESSES.USDG_USD_FEED, 100_000_000n, opened);
    // #given a 4 USDG payment
    await pay(4_000_000n);

    // #when a dry run passes
    const dry = await app({}, true);
    await dry.keeper.start();
    const dryReport = await dry.keeper.pass();
    // #then it simulated a split and a settle and sent nothing
    expect([dryReport.actions.map((action) => [action.action, action.outcome, action.detail.dryRun]), await readModule<bigint>('nextReceiptId', [])]).toEqual([
      [
        ['SPLIT', 'SKIPPED', true],
        ['SETTLE', 'SKIPPED', true],
      ],
      2n,
    ]);

    // #when the keeper passes for real, with its health endpoint up
    const live = await app();
    await live.keeper.start();
    const server = await startHealthServer(0, () => healthReport(live.health, new Date(), live.limits), live.log);
    const report = await live.keeper.pass();
    const response = await fetch(`http://127.0.0.1:${server.port}/health`);
    const health = (await response.json()) as Record<string, unknown>;
    await server.close();

    // #then the split filled and the bucket settled, each confirmed from chain state
    expect(report.actions.map((action) => [action.action, action.outcome])).toEqual([
      ['SPLIT', 'SUCCEEDED'],
      ['SETTLE', 'SUCCEEDED'],
    ]);
    const onChain = (await receiptsOnChain()).map(({ receipt }) => receipt).filter((receipt) => receipt.id > 1n);
    expect(onChain.map((receipt) => [receipt.id, receipt.status, receipt.trigger, receipt.usdgIn, receipt.usdgSpent, receipt.lotId])).toEqual([
      [2n, 'FILLED', 'KEEPER', 4_000_000n, 2_000_000n, 2n],
      [3n, 'SETTLED', 'KEEPER', 0n, 5_000_000n, 3n],
    ]);
    expect(onChain[1]?.queuedSince).toBe(firstQueue.timestamp);
    const tokens = await client.readContract({ address: SPY.token, abi: erc20Abi, functionName: 'balanceOf', args: [account] });
    expect(tokens).toBe((onChain[0]?.tokensOut ?? 0n) + (onChain[1]?.tokensOut ?? 0n));
    expect(await readModule<readonly bigint[]>('ledger', [account])).toEqual([7_000_000n, 7_000_000n, 0n, 0n]);
    expect(await client.readContract({ address: USDG, abi: erc20Abi, functionName: 'allowance', args: [account, ADDRESSES.SWAP_ROUTER_02] })).toBe(0n);

    console.info(
      JSON.stringify({
        phase: 2,
        opening: open.at.toString(),
        receipts: onChain.map((receipt) => ({ id: receipt.id.toString(), status: receipt.status, tokensOut: receipt.tokensOut.toString(), premiumBps: receipt.premiumBps.toString() })),
      }),
    );

    // #then the index holds both new receipts, their lots, both payments sorted, and no wait
    expect(await rows(`select receipt_id::text, status::text from public.receipts order by receipt_id`)).toEqual([
      { receipt_id: '1', status: 'QUEUED' },
      { receipt_id: '2', status: 'FILLED' },
      { receipt_id: '3', status: 'SETTLED' },
    ]);
    expect(await rows(`select lot_id::text, status::text, tokens_remaining::text from public.lots order by lot_id`)).toEqual([
      { lot_id: '2', status: 'FILLED', tokens_remaining: (onChain[0]?.tokensOut ?? 0n).toString() },
      { lot_id: '3', status: 'SETTLED', tokens_remaining: (onChain[1]?.tokensOut ?? 0n).toString() },
    ]);
    expect(await rows(`select amount::text, sorted_by_receipt_id::text from public.payments order by block_number`)).toEqual([
      { amount: '10000000', sorted_by_receipt_id: '1' },
      { amount: '4000000', sorted_by_receipt_id: '2' },
    ]);
    expect(await rows('select 1 from public.bucket_waits')).toEqual([]);

    // #then /health reports the keeper current, with its address, balance and last action
    expect([
      response.status,
      health.status,
      health.lastIndexedBlock,
      health.accountsTracked,
      health.keeper,
      (health.lastAction as { action: string; outcome: string }).action,
      (health.lastAction as { action: string; outcome: string }).outcome,
      typeof (health.ethBalance as { wei: string }).wei,
    ]).toEqual([200, 'ok', (await client.getBlockNumber()).toString(), 1, keeper.address.toLowerCase(), 'SETTLE', 'SUCCEEDED', 'string']);
  });
});
