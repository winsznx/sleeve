import { PUBLIC_RPC_URL } from '@sleeve/core';

import { InvalidReceiptIdError, VerifierError, parseReceiptId } from '../errors';
import type { VerifyResult } from '../types';
import type { VerifyOptions } from '../verify';
import { formatJson, formatReport } from './table';

/**
 * `sleeve verify <receiptId> [--rpc <url>] [--json] [--from-block <n>]`, without any Node API, so the parsing and the
 * exit codes are tested by calling it. src/cli.ts wires it to the process.
 */

export const EXIT = {
  MATCH: 0,
  MISMATCH: 1,
  NOT_FOUND: 2,
  /** The chain could not be read: a refusing provider, the wrong chain, a failed read. */
  UNVERIFIED: 3,
  USAGE: 64,
} as const;

export const USAGE = `Usage: sleeve verify <receiptId> [--rpc <url>] [--json] [--from-block <n>]

Recomputes a Sleeve receipt from public Robinhood Chain data and prints every field beside its recomputed value.

Options:
  --rpc <url>         RPC to read through. Default ${PUBLIC_RPC_URL}, a different provider from the keeper's.
  --json              Print the result as JSON.
  --from-block <n>    Start the module's log scans at block n, at or before the receipt's block.
  -h, --help          Show this help.

Exit codes: 0 every row matches, 1 a row differs, 2 no receipt with this id, 3 the chain could not be read,
64 a usage error.
`;

export interface CliIo {
  out: (text: string) => void;
  err: (text: string) => void;
  /** Progress lines go to err when set. */
  progress?: boolean;
}

export type Verify = (id: bigint, options: VerifyOptions) => Promise<VerifyResult>;

interface Parsed {
  id: bigint;
  rpcUrl: string;
  json: boolean;
  fromBlock: bigint | null;
}

class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

function parse(argv: readonly string[]): Parsed | 'help' {
  const args = [...argv];
  if (args.length === 0 || args.includes('-h') || args.includes('--help') || args[0] === 'help') return 'help';
  const command = args.shift();
  if (command !== 'verify') throw new UsageError(`unknown command "${command ?? ''}"`);
  let id: bigint | null = null;
  let rpcUrl = PUBLIC_RPC_URL;
  let json = false;
  let fromBlock: bigint | null = null;
  while (args.length > 0) {
    const arg = args.shift();
    if (arg === '--json') {
      json = true;
    } else if (arg === '--rpc') {
      const url = args.shift();
      if (url === undefined || !/^https?:\/\//.test(url)) throw new UsageError('--rpc needs an http or https URL');
      rpcUrl = url;
    } else if (arg === '--from-block') {
      const block = args.shift();
      if (block === undefined || !/^\d+$/.test(block)) throw new UsageError('--from-block needs a block number');
      fromBlock = BigInt(block);
    } else if (arg !== undefined && arg.startsWith('-')) {
      throw new UsageError(`unknown option "${arg}"`);
    } else if (arg !== undefined) {
      if (id !== null) throw new UsageError('give one receipt id');
      try {
        id = parseReceiptId(arg);
      } catch (error) {
        if (error instanceof InvalidReceiptIdError) throw new UsageError(error.message);
        throw error;
      }
    }
  }
  if (id === null) throw new UsageError('give a receipt id');
  return { id, rpcUrl, json, fromBlock };
}

function exitFor(result: VerifyResult): number {
  return EXIT[result.verdict];
}

export async function runCli(argv: readonly string[], io: CliIo, verify: Verify): Promise<number> {
  let parsed: Parsed | 'help';
  try {
    parsed = parse(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    io.err(`sleeve: ${error.message}\n\n${USAGE}`);
    return EXIT.USAGE;
  }
  if (parsed === 'help') {
    io.out(USAGE);
    return 0;
  }
  const options: VerifyOptions = {
    rpcUrl: parsed.rpcUrl,
    ...(parsed.fromBlock === null ? {} : { fromBlock: parsed.fromBlock }),
    ...(io.progress === true ? { onProgress: (step: string) => io.err(`reading ${step}\n`) } : {}),
  };
  try {
    const result = await verify(parsed.id, options);
    io.out(parsed.json ? formatJson(result) : formatReport(result));
    return exitFor(result);
  } catch (error) {
    // A VerifierError names what could not be read; anything else is reported with its own name.
    const message =
      error instanceof VerifierError ? error.message : error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    io.err(`sleeve: could not verify receipt ${parsed.id}: ${message}\n`);
    return EXIT.UNVERIFIED;
  }
}
