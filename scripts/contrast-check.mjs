#!/usr/bin/env node
// Checks every color claim in docs/DESIGN.md against the values in app/src/styles/tokens.css.
//
//   node scripts/contrast-check.mjs [--tokens <path>] [--json]
//
// Exit 0 when every check passes, 1 when any fails, 2 when the tokens file cannot be read or a token
// cannot be resolved. Markdown output is pasted into docs/DESIGN.md section 3 as is; --json prints the
// same report for tools.
//
// The claims and the color math live in app/src/styles/contrast.mjs, which the /dev/palette page renders
// too, so the page and this gate always agree. No dependencies.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TokenError, checkTokens, toMarkdown } from '../app/src/styles/contrast.mjs';

const main = () => {
  const args = process.argv.slice(2);
  const flag = args.indexOf('--tokens');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const tokensPath =
    flag === -1 ? path.join(here, '..', 'app', 'src', 'styles', 'tokens.css') : path.resolve(args[flag + 1] ?? '');
  const report = checkTokens(readFileSync(tokensPath, 'utf8'));
  const label = path.relative(process.cwd(), tokensPath) || tokensPath;
  process.stdout.write(args.includes('--json') ? `${JSON.stringify(report, null, 2)}\n` : toMarkdown(report, label));
  return report.failures.length ? 1 : 0;
};

try {
  process.exitCode = main();
} catch (error) {
  if (error instanceof TokenError || error?.code === 'ENOENT') {
    process.stderr.write(`contrast-check: ${error.message}\n`);
    process.exitCode = 2;
  } else {
    throw error;
  }
}
