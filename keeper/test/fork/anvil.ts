import { type ChildProcess, spawn } from 'node:child_process';
import { createServer } from 'node:net';

import { type Address, type Hex, numberToHex, pad } from 'viem';

/**
 * An anvil fork of chain 4663 for the integration test, at the archive RPC's latest block, so it holds the deployed
 * module. Anvil cannot run Arbitrum's ArbSys precompile, which the module calls for every receipt, so the fork gets
 * a stand-in at 0x64 that returns the block number, as contracts/test/utils/ForkBase.sol does in Foundry.
 */

/** ArbSys stand-in: returns block.number for any call (NUMBER, MSTORE at 0, RETURN 32 bytes). */
export const ARB_SYS_STAND_IN: Hex = '0x4360005260206000f3';
export const ARB_SYS: Address = '0x0000000000000000000000000000000000000064';

export interface Anvil {
  url: string;
  rpc<T>(method: string, params?: readonly unknown[]): Promise<T>;
  stop(): Promise<void>;
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function call<T>(url: string, method: string, params: readonly unknown[]): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const body = (await response.json()) as { result?: T; error?: { message: string } };
  if (body.error !== undefined) throw new Error(`${method}: ${body.error.message}`);
  return body.result as T;
}

export async function startAnvil(forkUrl: string): Promise<Anvil> {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const args = [
    '--fork-url',
    forkUrl,
    '--chain-id',
    '4663',
    '--port',
    String(port),
    '--host',
    '127.0.0.1',
    '--retries',
    '10',
    '--fork-retry-backoff',
    '2000',
    '--timeout',
    '60000',
    '--silent',
  ];
  const cups = process.env.FORK_CUPS;
  if (cups !== undefined && cups !== '') args.push('--compute-units-per-second', cups);
  const child: ChildProcess = spawn('anvil', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const deadline = Date.now() + 120_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`anvil exited with ${child.exitCode}: ${stderr}`);
    try {
      await call<Hex>(url, 'eth_chainId', []);
      break;
    } catch {
      if (Date.now() > deadline) {
        child.kill('SIGKILL');
        throw new Error(`anvil did not answer within two minutes: ${stderr}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  await call(url, 'anvil_setCode', [ARB_SYS, ARB_SYS_STAND_IN]);

  return {
    url,
    rpc: (method, params = []) => call(url, method, params),
    stop: () =>
      new Promise((resolve) => {
        if (child.exitCode !== null) {
          resolve();
          return;
        }
        child.once('exit', () => resolve());
        child.kill('SIGTERM');
      }),
  };
}

/** A 32-byte storage word for anvil_setStorageAt. */
export function word(value: bigint): Hex {
  return pad(numberToHex(value), { size: 32 });
}
