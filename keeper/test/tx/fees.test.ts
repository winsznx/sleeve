import { describe, expect, it } from 'vitest';

import { FeeAboveCapError } from '../../src/errors';
import { feesFor, gasLimitFor } from '../../src/tx/fees';

const CAP = 1_000_000_000n;

describe('feesFor', () => {
  it('caps at twice the base fee with no tip, since ordering is first come first served', () => {
    // #when
    const fees = feesFor(22_294_000n, CAP);
    // #then
    expect(fees).toEqual({ maxFeePerGas: 44_588_000n, maxPriorityFeePerGas: 0n });
  });

  it('never prices above the configured cap', () => {
    // #when
    const fees = feesFor(700_000_000n, CAP);
    // #then
    expect(fees.maxFeePerGas).toBe(CAP);
  });

  it('sends nothing when the base fee is already above the cap', () => {
    // #when
    const attempt = () => feesFor(CAP + 1n, CAP);
    // #then
    expect(attempt).toThrow(FeeAboveCapError);
  });
});

describe('gasLimitFor', () => {
  it('adds a fifth and a margin to the estimate', () => {
    // #when
    const limit = gasLimitFor(543_779n, 1_200_000n);
    // #then
    expect(limit).toBe(662_534n);
  });

  it('stops at the hard cap per call (A1-23)', () => {
    // #when
    const limit = gasLimitFor(1_100_000n, 1_200_000n);
    // #then
    expect(limit).toBe(1_200_000n);
  });
});
