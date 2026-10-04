// @vitest-environment node
import { createPublicClient, custom, encodeFunctionResult, getAddress, numberToHex, type Hex, type PublicClient } from 'viem';
import { entryPoint07Abi } from 'viem/account-abstraction';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { sleeveChain } from '@/lib/chain/chain';
import { UNINSTALL_CALL_GAS_LIMIT, buildOwnerOp } from '@/lib/chain/owner-ops';

import { kernelAccountFor } from './accounts';
import { keepsCallGasLimit, zeroDevRoute } from './user-ops';

/**
 * The uninstall's fixed call gas limit through ZeroDev's route (SPEC 6, D-019). viem puts the paymaster's own gas
 * limits over the request's, so these tests answer the bundler and paymaster methods over a stubbed fetch and check
 * which limit the prepared UserOp carries.
 */

const ACCOUNT = getAddress('0x5ee1e00000000000000000000000000000c0ffee');
const ZERODEV_RPC = 'https://zerodev.example/api/v3/project/chain/4663';

interface RpcCall {
  id: number;
  method: string;
  params?: unknown[];
}

/** The account's reads: deployed, nonce zero. */
function accountClient(): PublicClient {
  return createPublicClient({
    chain: sleeveChain,
    transport: custom({
      async request({ method }: { method: string }) {
        if (method === 'eth_chainId') return numberToHex(sleeveChain.id);
        if (method === 'eth_getCode') return '0xef0100';
        if (method === 'eth_call') return encodeFunctionResult({ abi: entryPoint07Abi, functionName: 'getNonce', result: 0n });
        throw new Error(`the fake chain does not answer ${method}`);
      },
    }),
  });
}

/** ZeroDev's bundler and paymaster over fetch. The paymaster answers `sponsoredCallGasLimit` as its call gas limit. */
function stubZeroDev(sponsoredCallGasLimit: bigint, calls: RpcCall[]): void {
  const fees = { maxFeePerGas: '0x3b9aca00', maxPriorityFeePerGas: '0x0' };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const call = JSON.parse(String(init?.body)) as RpcCall;
      calls.push(call);
      let result: unknown;
      switch (call.method) {
        case 'zd_getUserOperationGasPrice':
          result = { slow: fees, standard: fees, fast: fees };
          break;
        case 'zd_sponsorUserOperation':
          result = {
            callGasLimit: numberToHex(sponsoredCallGasLimit),
            verificationGasLimit: '0x7a120',
            preVerificationGas: '0xea60',
            paymaster: '0x0000000000000000000000000000000000000abc',
            paymasterVerificationGasLimit: '0x186a0',
            paymasterPostOpGasLimit: '0x1',
            paymasterData: '0x1234',
          };
          break;
        case 'eth_estimateUserOperationGas':
          result = { callGasLimit: '0x30d40', verificationGasLimit: '0x7a120', preVerificationGas: '0xea60' };
          break;
        default:
          return Response.json({ jsonrpc: '2.0', id: call.id, error: { code: -32601, message: `no ${call.method} here` } });
      }
      return Response.json({ jsonrpc: '2.0', id: call.id, result });
    }),
  );
}

async function prepareUninstall(sponsoredCallGasLimit: bigint, calls: RpcCall[], fixed: bigint | null = UNINSTALL_CALL_GAS_LIMIT) {
  stubZeroDev(sponsoredCallGasLimit, calls);
  const client = accountClient();
  const kernel = await kernelAccountFor(client, { kind: 'local', account: privateKeyToAccount(generatePrivateKey()) }, ACCOUNT);
  const callData: Hex = buildOwnerOp(ACCOUNT, [{ kind: 'uninstall' }]).callData;
  return zeroDevRoute(client, ZERODEV_RPC).prepare(kernel, { callData, callGasLimit: fixed });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('keepsCallGasLimit', () => {
  it('holds a sponsored op to the fixed limit its request asked for, and leaves an estimated one alone', () => {
    expect(keepsCallGasLimit({ callData: '0x', callGasLimit: 450_000n }, { callGasLimit: 450_000n })).toBe(true);
    expect(keepsCallGasLimit({ callData: '0x', callGasLimit: 450_000n }, { callGasLimit: 600_000n })).toBe(true);
    expect(keepsCallGasLimit({ callData: '0x', callGasLimit: 450_000n }, { callGasLimit: 449_999n })).toBe(false);
    expect(keepsCallGasLimit({ callData: '0x', callGasLimit: null }, { callGasLimit: 21_000n })).toBe(true);
  });
});

describe("the uninstall's call gas limit through ZeroDev", () => {
  it('offers the paymaster the fixed limit and keeps a sponsored op that kept it', async () => {
    const calls: RpcCall[] = [];
    const prepared = await prepareUninstall(UNINSTALL_CALL_GAS_LIMIT, calls);
    const sponsor = calls.find((call) => call.method === 'zd_sponsorUserOperation');
    expect((sponsor?.params?.[0] as { userOp: { callGasLimit: Hex } }).userOp.callGasLimit).toBe(numberToHex(UNINSTALL_CALL_GAS_LIMIT));
    expect([prepared.sponsored, prepared.userOp.callGasLimit]).toEqual([true, UNINSTALL_CALL_GAS_LIMIT]);
  });

  it('goes owner-paid with the fixed limit when the paymaster answers a lower one, since it signs over its own', async () => {
    // #given a paymaster that replaces the 450,000 with an estimate of its own
    const calls: RpcCall[] = [];
    // #when the uninstall is prepared
    const prepared = await prepareUninstall(300_000n, calls);
    // #then the op that reaches the owner carries the fixed limit, prepared without the paymaster
    expect([prepared.sponsored, prepared.userOp.callGasLimit]).toEqual([false, UNINSTALL_CALL_GAS_LIMIT]);
    expect(prepared.userOp.paymaster).toBeUndefined();
    expect(calls.map((call) => call.method)).toContain('eth_estimateUserOperationGas');
  });

  it("keeps the paymaster's estimate for an op with no fixed limit", async () => {
    const prepared = await prepareUninstall(120_000n, [], null);
    expect([prepared.sponsored, prepared.userOp.callGasLimit]).toEqual([true, 120_000n]);
  });
});
