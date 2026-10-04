import { execFile } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** The built bundle as systemd starts it: flags, exit codes, and what it prints. */

const run = promisify(execFile);
const KEEPER_DIR = new URL('../', import.meta.url).pathname;
let dir: string;

interface Outcome {
  code: number;
  stdout: string;
  stderr: string;
}

async function keeper(args: string[], env: Record<string, string>): Promise<Outcome> {
  try {
    const { stdout, stderr } = await run('node', ['dist/main.js', ...args], { cwd: KEEPER_DIR, env: { PATH: process.env.PATH ?? '', ...env } });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code ?? -1, stdout: failed.stdout ?? '', stderr: failed.stderr ?? '' };
  }
}

beforeAll(async () => {
  await run('node', ['scripts/build.mjs'], { cwd: KEEPER_DIR });
  dir = await mkdtemp(join(tmpdir(), 'sleeve-keeper-cli-'));
}, 120_000);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('dist/main.js', () => {
  it('prints the key file address and nothing of the key', async () => {
    // #given
    const key = generatePrivateKey();
    const file = join(dir, 'keeper.key');
    await writeFile(file, `${key}\n`, { mode: 0o600 });
    await chmod(file, 0o600);
    // #when
    const outcome = await keeper(['--print-address'], { KEEPER_PRIVATE_KEY_FILE: file });
    // #then
    expect([outcome.code, outcome.stdout.trim(), outcome.stdout.includes(key.slice(2, 18))]).toEqual([0, privateKeyToAccount(key).address, false]);
  });

  it('exits 2 when the configuration is refused, so systemd does not restart it', async () => {
    // #when
    const outcome = await keeper(['--once'], { KEEPER_RPC: 'https://rpc.example/v2/xxxxxxxxxxxx' });
    // #then
    expect([outcome.code, (JSON.parse(outcome.stdout.trim()) as { msg: string }).msg]).toEqual([2, 'keeper refused to start']);
  });

  it('exits 2 for a key file other users can read', async () => {
    // #given
    const file = join(dir, 'open.key');
    await writeFile(file, generatePrivateKey(), { mode: 0o644 });
    await chmod(file, 0o644);
    // #when
    const outcome = await keeper(['--once'], {
      KEEPER_RPC: 'http://127.0.0.1:9',
      KEEPER_PRIVATE_KEY_FILE: file,
      SUPABASE_URL: 'http://127.0.0.1:9',
      SUPABASE_SERVICE_ROLE_KEY: 'test-test-test-test',
    });
    // #then
    expect([outcome.code, outcome.stdout.includes('KEY_FILE_MODE')]).toEqual([2, true]);
  });

  it('refuses an unknown flag as a usage error', async () => {
    // #when
    const outcome = await keeper(['--send-everything'], {});
    // #then
    expect(outcome.code).toBe(2);
  });

  it('prints its usage', async () => {
    // #when
    const outcome = await keeper(['--help'], {});
    // #then
    expect([outcome.code, outcome.stdout.includes('--dry-run')]).toEqual([0, true]);
  });
});
