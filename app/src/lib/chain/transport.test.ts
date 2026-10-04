// @vitest-environment node
import { PUBLIC_RPC_URL } from '@sleeve/core';
import { createPublicClient, custom, type Hex, type Transport } from 'viem';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { sleeveChain } from './chain';
import { readTransport, routeByMethod } from './transport';

const LOG_RANGE: [{ fromBlock: Hex; toBlock: Hex }] = [{ fromBlock: '0x1', toBlock: '0x2' }];
/** fetch sees the URL as viem normalizes it, with a trailing slash on a bare origin. */
const PUBLIC_RPC_HREF = new URL(PUBLIC_RPC_URL).href;

function recorder(name: string, calls: string[]): Transport {
  return custom({
    async request({ method }: { method: string }) {
      calls.push(`${name}:${method}`);
      return method === 'eth_getLogs' ? [] : '0x10';
    },
  });
}

interface RpcCall {
  id: number;
  method: string;
}

/** Answers every JSON-RPC call over fetch and records the URL each request went to. */
function stubRpcFetch(urls: string[]): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      urls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      const body = JSON.parse(String(init?.body)) as RpcCall | RpcCall[];
      const reply = (call: RpcCall) => ({ jsonrpc: '2.0', id: call.id, result: call.method === 'eth_getLogs' ? [] : '0x10' });
      return Response.json(Array.isArray(body) ? body.map(reply) : reply(body));
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('routeByMethod', () => {
  it('sends a routed method to its own transport and everything else to the fallback', async () => {
    const calls: string[] = [];
    const client = createPublicClient({
      chain: sleeveChain,
      transport: routeByMethod(recorder('main', calls), { eth_getLogs: recorder('logs', calls) }),
    });
    await client.getBlockNumber();
    await client.request({ method: 'eth_getLogs', params: LOG_RANGE });
    expect(calls).toEqual(['main:eth_blockNumber', 'logs:eth_getLogs']);
  });
});

describe('readTransport', () => {
  it('reads logs through the public RPC and everything else through a keyed provider', async () => {
    // #given the browser's keyed endpoint
    const urls: string[] = [];
    stubRpcFetch(urls);
    const client = createPublicClient({ chain: sleeveChain, transport: readTransport('https://keyed.example/token/', false) });
    // #when it reads the head and then a log range
    await client.getBlockNumber();
    await client.request({ method: 'eth_getLogs', params: LOG_RANGE });
    // #then only the log read left for the public RPC
    expect(urls).toEqual(['https://keyed.example/token/', PUBLIC_RPC_HREF]);
  });

  it('sends everything to the public RPC when no keyed provider is set', async () => {
    const urls: string[] = [];
    stubRpcFetch(urls);
    const client = createPublicClient({ chain: sleeveChain, transport: readTransport(PUBLIC_RPC_URL, true) });
    await client.getBlockNumber();
    await client.request({ method: 'eth_getLogs', params: LOG_RANGE });
    expect(urls).toEqual([PUBLIC_RPC_HREF, PUBLIC_RPC_HREF]);
  });
});
