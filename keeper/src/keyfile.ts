import { readFile, stat } from 'node:fs/promises';

import type { Hex } from 'viem';
import { type PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts';

import { KeyFileError } from './errors';

const PRIVATE_KEY = /^(0x)?[0-9a-fA-F]{64}$/;

/**
 * The keeper's signer from KEEPER_PRIVATE_KEY_FILE. The file holds one hex private key and nothing else, optionally
 * with 0x and a trailing newline, and nobody but its owner may read it. No error repeats the file's contents.
 */
export async function loadKeeperAccount(path: string): Promise<PrivateKeyAccount> {
  let info;
  try {
    info = await stat(path);
  } catch (error) {
    throw new KeyFileError('KEY_FILE_MISSING', `cannot read the keeper key file ${path}`, { cause: error });
  }
  if (!info.isFile()) throw new KeyFileError('KEY_FILE_MISSING', `${path} is not a file`);
  const mode = info.mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new KeyFileError(
      'KEY_FILE_MODE',
      `${path} has mode ${mode.toString(8)}; other users can read it. Run chmod 600 on it`,
    );
  }

  const text = (await readFile(path, 'utf8')).trim();
  if (!PRIVATE_KEY.test(text)) {
    throw new KeyFileError('KEY_FILE_FORMAT', `${path} must hold exactly one 32-byte hex private key`);
  }
  const key: Hex = text.startsWith('0x') ? (text as Hex) : `0x${text}`;
  try {
    return privateKeyToAccount(key);
  } catch {
    throw new KeyFileError('KEY_FILE_INVALID', `${path} does not hold a valid secp256k1 private key`);
  }
}
