import { defineConfig } from 'vitest/config';

/**
 * Unit and schema tests. The fork test needs anvil and an archive RPC, so it runs on its own:
 * pnpm --filter @sleeve/keeper test:fork (vitest.fork.config.ts).
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/fork/**', 'node_modules/**', 'dist/**'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
