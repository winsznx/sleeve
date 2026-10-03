import { defineConfig } from 'vitest/config';

/**
 * The fork test: anvil forked from Robinhood Chain through an archive RPC (FORK_RPC, default dRPC), the deployed
 * module, a real Kernel account and real pools. Slow and networked, so it runs only through `pnpm test:fork`.
 */
export default defineConfig({
  test: {
    include: ['test/fork/**/*.test.ts'],
    testTimeout: 900_000,
    hookTimeout: 900_000,
    fileParallelism: false,
  },
});
