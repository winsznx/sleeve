import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

import { ADDRESSES, RULE_DEFAULTS, erc20Abi, sleeveModuleAbi } from '@sleeve/core';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createChainDataLayer, handleOpsRoute, localCredentialStore, memorySessionStore } from '@/data/chain';
import { kernelAccountFor, readInstallState } from '@/data/chain/accounts';
import { CONTRACTS } from '@/data/chain/context';
import type { SleeveDataLayer, WalletSigner } from '@/data/types';
import { sleeveChain } from '@/lib/chain/chain';

/**
 * The chain data layer's owner-op path on an anvil fork of Robinhood Chain at the latest block (pinned at start and
 * printed, build contract rule 5): a Kernel v3.1 account with an ephemeral ECDSA owner through the deployed factory,
 * the module installed in its first UserOp, a rule set in a bracketed op, 10 USDG paid in, and a withdraw, every op
 * sent through the deployed EntryPoint's handleOps with no bundler. Every assertion reads chain state.
 *
 * Needs anvil on the PATH and an archive RPC: FORK_RPC, default https://robinhood.drpc.org (D-008).
 */

const FORK_RPC = process.env.FORK_RPC ?? 'https://robinhood.drpc.org';
/** ArbSys stand-in, as contracts/test/utils/ForkBase.sol etches one: any call returns block.number. */
const ARB_SYS_MOCK: Hex = '0x4360005260206000f3';
/** The NVDA launch pool holds USDG; the test takes 10 USDG from it the way a payer would send them. */
const USDG_SOURCE: Address = '0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3';
const TEN_USDG = 10_000_000n;
const FOUR_USDG = 4_000_000n;

let anvil: ChildProcess | null = null;
let rpcUrl = '';
let forkBlock = 0n;
let client: PublicClient;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function rpc<T>(url: string, method: string, params: unknown[] = []): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const body = (await response.json()) as { result?: T; error?: { message: string } };
  if (body.error !== undefined || body.result === undefined) throw new Error(`${method}: ${body.error?.message ?? 'no result'}`);
  return body.result;
}

async function waitForAnvil(url: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      if ((await rpc<string>(url, 'eth_chainId')) === '0x1237') return;
    } catch {
      // Not listening yet: try again until the deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('anvil did not start within a minute');
}

beforeAll(async () => {
  forkBlock = BigInt(await rpc<string>(FORK_RPC, 'eth_blockNumber'));
  const port = await freePort();
  rpcUrl = `http://127.0.0.1:${port}`;
  anvil = spawn(
    'anvil',
    ['--fork-url', FORK_RPC, '--fork-block-number', forkBlock.toString(), '--chain-id', '4663', '--port', String(port), '--silent'],
    { stdio: 'ignore' },
  );
  await waitForAnvil(rpcUrl);
  console.info(`fork of chain 4663 pinned at L2 block ${forkBlock} through ${FORK_RPC}`);
  await rpc(rpcUrl, 'anvil_setCode', [ADDRESSES.ARB_SYS, ARB_SYS_MOCK]);
  client = createPublicClient({ chain: sleeveChain, transport: http(rpcUrl), batch: { multicall: true } });
});

afterAll(() => {
  anvil?.kill('SIGTERM');
});

async function fund(address: Address, wei: bigint): Promise<void> {
  await rpc(rpcUrl, 'anvil_setBalance', [address, `0x${wei.toString(16)}`]);
}

async function usdgBalance(address: Address): Promise<bigint> {
  return client.readContract({ address: ADDRESSES.USDG, abi: erc20Abi, functionName: 'balanceOf', args: [address] });
}

describe('the chain data layer on a fork of Robinhood Chain', () => {
  it('creates an account with the module installed in its first UserOp, sets a rule, takes a payment and withdraws', async () => {
    // #given an ephemeral owner key, a funded key standing in for the bundler, and the data layer on the fork
    const owner = privateKeyToAccount(generatePrivateKey());
    const bundler = privateKeyToAccount(generatePrivateKey());
    await fund(bundler.address, parseEther('1'));
    const wallet = createWalletClient({ account: bundler, chain: sleeveChain, transport: http(rpcUrl) });
    const layer: SleeveDataLayer = createChainDataLayer({
      config: { readRpcUrl: rpcUrl, readRpcIsPublic: false, zeroDevRpcUrl: null, passkeyRpId: null, supabase: null },
      client,
      route: handleOpsRoute(client, { wallet }),
      sessions: memorySessionStore(),
      credentials: localCredentialStore(),
      logsFromBlock: forkBlock + 1n,
    });
    const signer: WalletSigner = {
      address: owner.address,
      signHash: (hash) => owner.signMessage({ message: { raw: hash } }),
    };
    const counterfactual = await kernelAccountFor(client, { kind: 'local', account: owner });
    expect(await client.getCode({ address: counterfactual.address })).toBeUndefined();
    // The account pays its own prefund: there is no paymaster on the fork.
    await fund(counterfactual.address, parseEther('0.01'));

    // #when the owner creates the account
    const steps: string[] = [];
    const session = await layer.createAccount({
      rule: null,
      recoverySigner: null,
      signer: { kind: 'wallet', wallet: signer },
      onStep: (step) => steps.push(step),
    });

    // #then the first UserOp deployed the account and installed the module, read back from both views (D-019)
    expect(session.account).toBe(counterfactual.address);
    expect(steps).toEqual(['approve', 'deploy', 'install', 'check']);
    expect(await readInstallState(client, session.account)).toEqual({ deployed: true, initialized: true, listed: true });
    const overview = await layer.getAccount(session.account);
    expect([overview.deployed, overview.moduleInstalled, overview.recoverySigner]).toEqual([true, true, null]);
    expect((await layer.getRule(session.account)).status).toBe('NONE');

    // #when the owner sets a rule through a bracketed owner op
    const rule = await layer.setRule({ ...RULE_DEFAULTS, equityBps: 2_000, spendBps: 8_000, tickerId: 1 });

    // #then the module holds the new version
    const onChain = await client.readContract({
      address: CONTRACTS.module,
      abi: sleeveModuleAbi,
      functionName: 'ruleOf',
      args: [session.account],
    });
    expect(rule).toMatchObject({ version: 1, status: 'ACTIVE', equityBps: 2_000, tickerId: 1 });
    expect([onChain.version, onChain.status, onChain.equityBps, onChain.tickerId]).toEqual([1, 1, 2_000, 1]);

    // #when a payer sends 10 USDG to the payment address
    await rpc(rpcUrl, 'anvil_impersonateAccount', [USDG_SOURCE]);
    await fund(USDG_SOURCE, parseEther('1'));
    const payer = createWalletClient({ account: USDG_SOURCE, chain: sleeveChain, transport: http(rpcUrl) });
    const paid = await payer.writeContract({ address: ADDRESSES.USDG, abi: erc20Abi, functionName: 'transfer', args: [session.account, TEN_USDG] });
    await client.waitForTransactionReceipt({ hash: paid });
    await rpc(rpcUrl, 'anvil_stopImpersonatingAccount', [USDG_SOURCE]);

    // #then it sits unsorted, after the install snapshot, and the inbox shows it
    expect(await usdgBalance(session.account)).toBe(TEN_USDG);
    const ledger = await layer.getLedger(session.account);
    expect([ledger.balance, ledger.spend, ledger.pendingTotal, ledger.unsorted]).toEqual([TEN_USDG, 0n, 0n, TEN_USDG]);
    const inbox = await layer.getInbox(session.account);
    expect(inbox.map((item) => [item.amount, item.state])).toEqual([[TEN_USDG, 'RECEIVED']]);

    // #when the owner previews and then sends 4 USDG to an address outside Sleeve
    const payee = privateKeyToAccount(generatePrivateKey()).address;
    const preview = await layer.previewAction({ kind: 'withdraw', request: { to: payee, amount: FOUR_USDG } });
    const result = await layer.withdraw({ to: payee, amount: FOUR_USDG });

    // #then the preview named the move from the simulation, and the balances moved by exactly that much on chain
    expect(preview.blocked).toBeNull();
    expect(preview.legs).toEqual([
      { from: { kind: 'unsorted' }, to: { kind: 'outside', address: payee }, sends: { asset: { kind: 'USDG' }, amount: FOUR_USDG }, receives: null },
    ]);
    expect(preview.fee.sponsored).toBe(false);
    expect([result.balanceBefore, result.balanceAfter]).toEqual([TEN_USDG, TEN_USDG - FOUR_USDG]);
    expect(result.from).toEqual({ spend: 0n, unsorted: FOUR_USDG, buckets: [] });
    expect(await usdgBalance(session.account)).toBe(TEN_USDG - FOUR_USDG);
    expect(await usdgBalance(payee)).toBe(FOUR_USDG);
    const after = await layer.getLedger(session.account);
    expect([after.balance, after.spend, after.pendingTotal, after.unsorted]).toEqual([TEN_USDG - FOUR_USDG, 0n, 0n, TEN_USDG - FOUR_USDG]);
  });
});
