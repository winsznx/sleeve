import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, relative } from 'node:path';

import type { Hex } from 'viem';
import { type PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts';

import { KeyFileError } from './errors';

const PRIVATE_KEY = /^(0x)?[0-9a-fA-F]{64}$/;

/** What the permission check reads from stat. */
export interface KeyFileOwnership {
  mode: number;
  uid: number;
  gid: number;
}

function isInside(path: string, directory: string | undefined): boolean {
  if (directory === undefined || directory === '') return false;
  const rest = relative(directory, path);
  return rest !== '' && !rest.startsWith('..') && !isAbsolute(rest);
}

/**
 * Why the key file's permissions are unsafe, or null. Only its owner may read it, with one exception: systemd 259
 * hands a LoadCredential= secret to the service as 0440 root:root inside the unit's 0550 root:root credentials
 * directory and lets the service's user read it through an ACL, so there the group bit names root and nobody else.
 */
export function keyFileModeProblem(path: string, info: KeyFileOwnership, credentialsDirectory: string | undefined): string | null {
  const mode = info.mode & 0o777;
  if ((mode & 0o077) === 0) return null;
  const systemdCredential = (mode & 0o007) === 0 && info.uid === 0 && info.gid === 0 && isInside(path, credentialsDirectory);
  if (systemdCredential) return null;
  return `${path} has mode ${mode.toString(8)}; other users can read it. Run chmod 600 on it`;
}

/**
 * The keeper's signer from KEEPER_PRIVATE_KEY_FILE. The file holds one hex private key and nothing else, optionally
 * with 0x and a trailing newline, and nobody but its owner may read it (keyFileModeProblem). No error repeats the
 * file's contents.
 */
export async function loadKeeperAccount(path: string): Promise<PrivateKeyAccount> {
  let info;
  try {
    info = await stat(path);
  } catch (error) {
    throw new KeyFileError('KEY_FILE_MISSING', `cannot read the keeper key file ${path}`, { cause: error });
  }
  if (!info.isFile()) throw new KeyFileError('KEY_FILE_MISSING', `${path} is not a file`);
  const problem = keyFileModeProblem(path, info, process.env.CREDENTIALS_DIRECTORY);
  if (problem !== null) throw new KeyFileError('KEY_FILE_MODE', problem);

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
