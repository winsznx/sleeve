import { FeeAboveCapError } from '../errors';

export interface Eip1559Fees {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

/**
 * EIP-1559 fees for a keeper transaction. Robinhood Chain orders transactions first come first served with no
 * priority fee auction, so the tip is zero. The fee cap is twice the base fee, for a base fee that rises before
 * inclusion, and never above the configured cap; a base fee already above the cap sends nothing.
 */
export function feesFor(baseFeePerGas: bigint, capWei: bigint): Eip1559Fees {
  if (baseFeePerGas > capWei) throw new FeeAboveCapError(baseFeePerGas, capWei);
  const doubled = baseFeePerGas * 2n;
  return { maxFeePerGas: doubled < capWei ? doubled : capWei, maxPriorityFeePerGas: 0n };
}

/** The gas limit for an estimate: a fifth more plus a margin, never above the hard cap per call (audit A1-23). */
export function gasLimitFor(estimate: bigint, cap: bigint): bigint {
  const padded = (estimate * 6n) / 5n + 10_000n;
  return padded < cap ? padded : cap;
}
