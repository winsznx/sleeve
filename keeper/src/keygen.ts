import { open } from 'node:fs/promises';

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

/**
 * Generates a keeper key on the server, so it never leaves it (prd-questions Q34 option B):
 *
 *   node dist/keygen.js /opt/sleeve/secrets/keeper.key
 *
 * The file is created with mode 600 and never overwritten. Only the address is printed.
 */
async function main(path: string | undefined): Promise<number> {
  if (path === undefined || path === '') {
    process.stderr.write('usage: node dist/keygen.js <key file>\n');
    return 2;
  }
  const key = generatePrivateKey();
  let file;
  try {
    file = await open(path, 'wx', 0o600);
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    process.stderr.write(code === 'EEXIST' ? `${path} exists; it is never overwritten\n` : `cannot create ${path}\n`);
    return 2;
  }
  try {
    await file.writeFile(`${key}\n`, 'utf8');
    await file.chmod(0o600);
  } finally {
    await file.close();
  }
  process.stdout.write(`${privateKeyToAccount(key).address}\n`);
  return 0;
}

main(process.argv[2]).then(
  (code) => {
    process.exitCode = code;
  },
  () => {
    process.stderr.write('key generation failed\n');
    process.exitCode = 1;
  },
);
