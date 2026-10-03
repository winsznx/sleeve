import { defineConfig } from 'vitest/config';

/** Unit tests: fixtures and fakes only, no network. The fork test has its own config (vitest.fork.config.ts). */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/fork/**', 'node_modules/**'],
  },
});
