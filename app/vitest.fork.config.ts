import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * The fork suite: the chain data layer against an anvil fork of Robinhood Chain at the latest block. Kept out of the
 * unit run (it needs anvil and an archive RPC, D-016) and run with `pnpm --filter @sleeve/app test:fork`.
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['test/fork/**/*.fork.ts'],
    testTimeout: 600_000,
    hookTimeout: 240_000,
    fileParallelism: false,
  },
});
