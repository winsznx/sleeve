import { defineConfig } from 'vitest/config';

/**
 * The integration test against an anvil fork of chain 4663 at the latest block, with the deployed module. Needs
 * anvil on the PATH and FORK_RPC, an archive RPC (default https://robinhood.drpc.org).
 */
export default defineConfig({
  test: {
    include: ['test/fork/**/*.test.ts'],
    testTimeout: 600_000,
    hookTimeout: 600_000,
    fileParallelism: false,
  },
});
