import process from 'node:process';

import { runCli } from './cli/run';
import { verifyReceipt } from './verify';

/** The sleeve bin. Everything but the process wiring lives in cli/run.ts. */
const code = await runCli(
  process.argv.slice(2),
  {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
    progress: process.stderr.isTTY === true,
  },
  (id, options) => verifyReceipt(id, options),
);
process.exitCode = code;
