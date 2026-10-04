import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { KeyFileError } from '../src/errors';
import { loadKeeperAccount } from '../src/keyfile';

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sleeve-keyfile-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function keyFile(name: string, contents: string, mode: number): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, contents, { mode });
  await chmod(path, mode);
  return path;
}

async function refusal(path: string): Promise<KeyFileError> {
  try {
    await loadKeeperAccount(path);
  } catch (error) {
    if (error instanceof KeyFileError) return error;
    throw error;
  }
  throw new Error('expected a KeyFileError');
}

describe('loadKeeperAccount', () => {
  it('reads one hex key with or without 0x and a newline', async () => {
    // #given
    const key = generatePrivateKey();
    const withPrefix = await keyFile('a.key', `${key}\n`, 0o600);
    const bare = await keyFile('b.key', key.slice(2), 0o400);
    // #when
    const accounts = await Promise.all([loadKeeperAccount(withPrefix), loadKeeperAccount(bare)]);
    // #then
    expect(accounts.map((account) => account.address)).toEqual([
      privateKeyToAccount(key).address,
      privateKeyToAccount(key).address,
    ]);
  });

  it.each([0o644, 0o640, 0o604, 0o660])('refuses a file other users can read, mode %o', async (mode) => {
    // #given
    const path = await keyFile(`open-${mode.toString(8)}.key`, generatePrivateKey(), mode);
    // #when
    const error = await refusal(path);
    // #then
    expect(error.code).toBe('KEY_FILE_MODE');
  });

  it('refuses anything but one key, without repeating the contents', async () => {
    // #given
    const key = generatePrivateKey();
    const path = await keyFile('two.key', `${key}\n${key}\n`, 0o600);
    // #when
    const error = await refusal(path);
    // #then
    expect(error.code).toBe('KEY_FILE_FORMAT');
    expect(error.message).not.toContain(key.slice(2, 20));
  });

  it('refuses the zero key', async () => {
    // #given
    const path = await keyFile('zero.key', `0x${'0'.repeat(64)}`, 0o600);
    // #when
    const error = await refusal(path);
    // #then
    expect(error.code).toBe('KEY_FILE_INVALID');
  });

  it('refuses a missing file', async () => {
    // #when
    const error = await refusal(join(dir, 'absent.key'));
    // #then
    expect(error.code).toBe('KEY_FILE_MISSING');
  });
});
