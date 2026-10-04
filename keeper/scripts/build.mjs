// Builds the release bundle: dist/main.js (the keeper) and dist/keygen.js, each one ES module with every dependency
// inlined, so the server needs Node 22 and nothing from npm. The version is the package version plus the git commit,
// marked dirty when the keeper or packages/core has uncommitted changes.
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

function git(args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const commit = git(['rev-parse', '--short=12', 'HEAD']) || 'unknown';
const dirty = git(['status', '--porcelain', '--', '.', '../packages/core']) === '' ? '' : '.dirty';
const version = `${pkg.version}+${commit}${dirty}`;

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await build({
  entryPoints: { main: join(root, 'src/main.ts'), keygen: join(root, 'src/keygen.ts') },
  outdir: dist,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  legalComments: 'none',
  define: { __KEEPER_VERSION__: JSON.stringify(version) },
  // Some bundled CommonJS code calls require() for Node built-ins.
  banner: {
    js: "import { createRequire as __sleeveRequire } from 'node:module'; const require = __sleeveRequire(import.meta.url);",
  },
  logLevel: 'warning',
});
await writeFile(join(dist, 'package.json'), `${JSON.stringify({ type: 'module', version }, null, 2)}\n`);
await writeFile(join(dist, 'VERSION'), `${version}\n`);
process.stdout.write(`built ${version} in ${dist}\n`);
