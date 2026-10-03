import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

/**
 * The app's /verify page imports the library entry in the browser, so it must bundle for the browser with no Node
 * built-in. esbuild refuses a node: import or a bare Node module on the browser platform, which makes this the check.
 */
describe('the library entry', () => {
  it('bundles for the browser without a Node built-in', async () => {
    // #given the entry the app imports
    // #when esbuild bundles it for the browser
    const result = await build({
      entryPoints: [new URL('../src/index.ts', import.meta.url).pathname],
      bundle: true,
      platform: 'browser',
      format: 'esm',
      write: false,
      logLevel: 'silent',
      metafile: true,
    });
    // #then nothing failed and no input is a Node module
    expect(result.errors).toEqual([]);
    const inputs = Object.keys(result.metafile.inputs);
    expect(inputs.some((input) => input.startsWith('node:'))).toBe(false);
    expect(inputs.some((input) => input.endsWith('src/cli.ts'))).toBe(false);
  });
});
