/**
 * Errors the verifier throws on purpose. Each carries a code, so the CLI and the app can tell a provider that refused
 * service from a receipt that does not check out. A receipt that fails a check is never an error: it is a result with
 * verdict MISMATCH.
 */

export type VerifierErrorCode =
  | 'ProviderBlocked'
  | 'ChainMismatch'
  | 'ReceiptLogMissing'
  | 'LogRangeTooNarrow'
  | 'InvalidReceiptId'
  | 'ReadFailed';

export class VerifierError extends Error {
  readonly code: VerifierErrorCode;

  constructor(code: VerifierErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'VerifierError';
    this.code = code;
  }
}

/** The RPC kept answering with a rate limit or a Cloudflare challenge after every retry (D-012). */
export class ProviderBlockedError extends VerifierError {
  readonly url: string;
  readonly attempts: number;
  /** HTTP status of the last refusal, when there was one. */
  readonly status: number | null;

  constructor(url: string, attempts: number, status: number | null, cause: unknown) {
    const what = status === null ? 'a rate limit' : `HTTP ${status}`;
    super(
      'ProviderBlocked',
      `${url} refused ${attempts} attempts in a row (${what}). The public Robinhood Chain RPC rate limits bursts and ` +
        'can challenge a client for several minutes; wait and retry, or pass another RPC.',
      { cause },
    );
    this.name = 'ProviderBlockedError';
    this.url = url;
    this.attempts = attempts;
    this.status = status;
  }
}

/** The RPC serves a chain other than Robinhood Chain mainnet. */
export class ChainMismatchError extends VerifierError {
  readonly expected: number;
  readonly actual: number;

  constructor(expected: number, actual: number) {
    super('ChainMismatch', `the RPC serves chain ${actual}, not chain ${expected}`);
    this.name = 'ChainMismatchError';
    this.expected = expected;
    this.actual = actual;
  }
}

/**
 * The module holds a hash for the receipt, so the receipt exists, but no ReceiptWritten log for it lies in the
 * scanned blocks. A scan that starts after the receipt's block causes this.
 */
export class ReceiptLogMissingError extends VerifierError {
  readonly receiptId: bigint;
  readonly fromBlock: bigint;
  readonly toBlock: bigint;

  constructor(receiptId: bigint, fromBlock: bigint, toBlock: bigint) {
    super(
      'ReceiptLogMissing',
      `receipt ${receiptId} exists, but its ReceiptWritten log is not between blocks ${fromBlock} and ${toBlock}; ` +
        'start the scan at an earlier block',
    );
    this.name = 'ReceiptLogMissingError';
    this.receiptId = receiptId;
    this.fromBlock = fromBlock;
    this.toBlock = toBlock;
  }
}

/** The RPC refused an eth_getLogs range even one block wide. */
export class LogRangeTooNarrowError extends VerifierError {
  constructor(fromBlock: bigint, toBlock: bigint, cause: unknown) {
    super('LogRangeTooNarrow', `the RPC refused eth_getLogs for blocks ${fromBlock} to ${toBlock} at every width`, {
      cause,
    });
    this.name = 'LogRangeTooNarrowError';
  }
}

/**
 * A read the verification cannot go on without failed: a module view, or the token state the guard checks need. A
 * failed read that only one row depends on is shown on that row instead.
 */
export class ReadFailedError extends VerifierError {
  readonly read: string;

  constructor(read: string, reason: string) {
    super('ReadFailed', `${read} failed: ${reason}`);
    this.name = 'ReadFailedError';
    this.read = read;
  }
}

/** A receipt id that is not a whole number from 1 to 2^256 - 1. */
export class InvalidReceiptIdError extends VerifierError {
  readonly input: string;

  constructor(input: string) {
    super('InvalidReceiptId', `"${input}" is not a receipt id: ids are whole numbers from 1`);
    this.name = 'InvalidReceiptIdError';
    this.input = input;
  }
}

const MAX_UINT256 = (1n << 256n) - 1n;

/** Reads a receipt id typed by a person or passed by a caller. Digits only, from 1 to 2^256 - 1. */
export function parseReceiptId(input: string | bigint | number): bigint {
  const text = typeof input === 'string' ? input.trim() : String(input);
  if (!/^\d+$/.test(text)) throw new InvalidReceiptIdError(String(input));
  const id = BigInt(text);
  if (id === 0n || id > MAX_UINT256) throw new InvalidReceiptIdError(String(input));
  return id;
}
