/**
 * Named errors. Every failure the keeper can report carries a stable code, so logs, keeper_runs rows and alerts can be
 * matched on it instead of on message text. Messages never contain a key, a service key or a full RPC URL.
 */
export class KeeperError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

/** A missing or malformed environment variable. The process exits before doing anything. */
export class ConfigError extends KeeperError {}

/** The keeper key file is missing, readable by other users, or does not hold one private key. */
export class KeyFileError extends KeeperError {}

/** Supabase refused or failed a request. `pgCode` is the Postgres or PostgREST code, `rule` the named rule if any. */
export class StoreError extends KeeperError {
  readonly operation: string;
  readonly pgCode: string | null;
  readonly rule: string | null;

  constructor(operation: string, pgCode: string | null, message: string, rule: string | null = null) {
    super('STORE_FAILED', `${operation}: ${message}`);
    this.operation = operation;
    this.pgCode = pgCode;
    this.rule = rule;
  }
}

/** The block the cursor points at has a different hash on chain: a reorg deeper than the confirmation window. */
export class ReorgBelowCursorError extends KeeperError {
  readonly block: bigint;

  constructor(block: bigint, stored: string, current: string) {
    super(
      'REORG_BELOW_CURSOR',
      `block ${block} was indexed with hash ${stored} but the chain now has ${current}; ` +
        'indexed history is append-only, so indexing stops until an operator rebuilds the index',
    );
    this.block = block;
  }
}

/** A log the index cannot accept as it is, such as a receipt whose stored hash differs from its event data. */
export class IndexIntegrityError extends KeeperError {}

/** A contract answered with decimals other than the ones the module and the keeper are built for. */
export class UnexpectedDecimalsError extends KeeperError {
  constructor(source: string, decimals: number, expected: number) {
    super('UNEXPECTED_DECIMALS', `${source} reports ${decimals} decimals, expected ${expected}`);
  }
}

/** The gas estimate of a keeper call is above the hard limit per call (audit A1-23). Nothing is sent. */
export class GasAboveCapError extends KeeperError {
  constructor(estimate: bigint, cap: bigint) {
    super('GAS_ABOVE_CAP', `gas estimate ${estimate} is above the per-call cap ${cap}`);
  }
}

/** The base fee is above the fee cap, so no transaction could be priced within it. Nothing is sent. */
export class FeeAboveCapError extends KeeperError {
  constructor(baseFee: bigint, cap: bigint) {
    super('FEE_ABOVE_CAP', `base fee ${baseFee} wei is above the fee cap ${cap} wei`);
  }
}

/** The RPC refused the signed transaction. The nonce manager resyncs before the next send. */
export class SendError extends KeeperError {}

/** A sent transaction had no receipt within the wait. It may still land; the index will show it. */
export class TxTimeoutError extends KeeperError {
  readonly txHash: string;

  constructor(txHash: string, waitedMs: number) {
    super('TX_TIMEOUT', `no receipt for ${txHash} after ${waitedMs} ms`);
    this.txHash = txHash;
  }
}

/** A mined transaction did not leave the chain state the action promises. */
export class PostconditionError extends KeeperError {
  constructor(message: string) {
    super('POSTCONDITION_FAILED', message);
  }
}
