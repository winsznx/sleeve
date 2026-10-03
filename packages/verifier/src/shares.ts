import { TOTAL_BPS } from '@sleeve/core';

/**
 * LedgerMath.splitShares (contracts/src/libraries/LedgerMath.sol): the equity part is floor(amount * equityBps /
 * 10,000) and the spend part takes the rest, so the dust, under one base unit, goes to spend (I2).
 */
export function splitShares(amount: bigint, equityBps: number): { spendPart: bigint; equityPart: bigint } {
  if (!Number.isInteger(equityBps) || equityBps < 0 || equityBps > TOTAL_BPS) {
    throw new RangeError(`equityBps must be a whole number from 0 to ${TOTAL_BPS}, got ${equityBps}`);
  }
  const equityPart = (amount * BigInt(equityBps)) / BigInt(TOTAL_BPS);
  return { spendPart: amount - equityPart, equityPart };
}
