import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

/**
 * An anvil node forked from Robinhood Chain for the fork test. The fork RPC is an archive (D-008): dRPC by default,
 * FORK_RPC to override. No keys are involved; the test uses anvil's own accounts and keys it generates.
 */

export const FORK_RPC = process.env.FORK_RPC ?? 'https://robinhood.drpc.org';

export interface Anvil {
  url: string;
  stop: () => Promise<void>;
  /** Everything anvil printed, for a failure message. */
  output: () => string;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address === null || typeof address === 'string') reject(new Error('no port'));
        else resolve(address.port);
      });
    });
  });
}

async function ready(url: string, deadline: number): Promise<void> {
  for (;;) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      });
      if (response.ok) return;
    } catch (error) {
      if (Date.now() > deadline) throw new Error(`anvil did not answer at ${url}`, { cause: error });
    }
    if (Date.now() > deadline) throw new Error(`anvil did not answer at ${url}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

export async function startAnvil(): Promise<Anvil> {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const args = [
    '--fork-url',
    FORK_RPC,
    '--chain-id',
    '4663',
    '--port',
    String(port),
    '--compute-units-per-second',
    '50',
    '--retries',
    '10',
    '--fork-retry-backoff',
    '2000',
    '--timeout',
    '60000',
  ];
  let log = '';
  const child: ChildProcess = spawn(process.env.ANVIL_BIN ?? 'anvil', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout?.on('data', (chunk: Buffer) => {
    log += chunk.toString();
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    log += chunk.toString();
  });
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  const spawnFailed = new Promise<never>((_, reject) => child.once('error', (error) => reject(error)));
  await Promise.race([ready(url, Date.now() + 120_000), spawnFailed]);
  return {
    url,
    output: () => log,
    stop: async () => {
      if (child.exitCode === null) child.kill('SIGTERM');
      await exited;
    },
  };
}
