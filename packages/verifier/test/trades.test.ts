import { describe, expect, it } from 'vitest';

import { splitShares } from '../src/shares';
import { findBuyFill, findSellRun, poolDeltas, proRataShares } from '../src/trades';
import {
  ACCOUNT,
  EQUITY,
  MODULE,
  SPY,
  TOKENS,
  USDG,
  approvalLog,
  filledSplit,
  receiptLog,
  swapLog,
  transferLog,
  twoSells,
} from './support/fixtures';

const parties = { module: MODULE, account: ACCOUNT, usdg: USDG, token: SPY.token };

describe("a buy's fill from its transaction", () => {
  it('sums the swap transfers between the pool and the account', () => {
    const { evidence } = filledSplit();
    const fill = findBuyFill(evidence.transaction.logs, evidence.receiptLog.logIndex, parties);
    expect(fill).toMatchObject({ usdgSpent: EQUITY, tokensOut: TOKENS, usdgTransfers: 1, tokenTransfers: 1 });
    expect(fill?.swap.pool).toBe(SPY.pool);
  });

  it("ignores an earlier action's swap and receipt in the same transaction", () => {
    // #given an owner batch: a manual swap to the account, another receipt, then the buy
    const { receipt, evidence } = filledSplit();
    const earlier = [
      transferLog(SPY.token, SPY.pool, ACCOUNT, 5n, { logIndex: 0 }),
      transferLog(USDG, ACCOUNT, SPY.pool, 7n, { logIndex: 1 }),
      swapLog(SPY.pool, ACCOUNT, 7n, -5n, { logIndex: 2 }),
      receiptLog({ ...receipt, id: 1n }, { logIndex: 3 }),
    ];
    const shifted = evidence.transaction.logs.map((log) => ({ ...log, logIndex: log.logIndex + 4 }));
    // #when
    const fill = findBuyFill([...earlier, ...shifted], evidence.receiptLog.logIndex + 4, parties);
    // #then only the buy's own swap counts
    expect(fill).toMatchObject({ usdgSpent: EQUITY, tokensOut: TOKENS });
  });

  it('finds no fill without a swap to the account', () => {
    const { receipt } = filledSplit();
    const logs = [approvalLog(USDG, ACCOUNT, SPY.pool, 1n, { logIndex: 0 }), receiptLog(receipt, { logIndex: 1 })];
    expect(findBuyFill(logs, 1, parties)).toBeNull();
    expect(findBuyFill(logs, 99, parties)).toBeNull();
  });
});

describe("a sell's run", () => {
  it('is the receipts after the last Swap of the pool before the target', () => {
    const { receipts, logs } = twoSells();
    const target = receipts[1];
    if (target === undefined) throw new Error('fixture');
    const run = findSellRun(logs, 11, target, { module: MODULE, usdg: USDG });
    expect(run?.entries.map((entry) => entry.receipt.id)).toEqual([21n, 22n]);
    expect(run?.containsTarget).toBe(true);
    expect(run?.tokensIn).toBe(TOKENS + TOKENS / 2n);
    expect(run?.tokensTransferred).toBe(TOKENS + TOKENS / 2n);
  });

  it('is absent when no Swap of the pool precedes the target', () => {
    const { receipts, logs } = twoSells();
    const target = receipts[0];
    if (target === undefined) throw new Error('fixture');
    expect(findSellRun(logs.filter((log) => log.logIndex !== 3), 5, target, { module: MODULE, usdg: USDG })).toBeNull();
  });
});

describe('the pro rata shares of a sell', () => {
  it('round down and give the last lot the rest, so they sum to the proceeds', () => {
    const shares = proRataShares(100n, [1n, 1n, 1n], 3n);
    expect(shares).toEqual([33n, 33n, 34n]);
    expect(shares.reduce((sum, share) => sum + share, 0n)).toBe(100n);
  });

  it('are zero for zero tokens', () => {
    expect(proRataShares(100n, [0n], 0n)).toEqual([0n]);
  });
});

describe("the pool's deltas", () => {
  it('follow which token is token0', () => {
    const swap = { pool: SPY.pool, recipient: ACCOUNT, amount0: 10n, amount1: -20n, index: 0, logIndex: 0 };
    expect(poolDeltas(swap, USDG, USDG)).toEqual({ usdg: 10n, token: -20n });
    expect(poolDeltas(swap, SPY.token, USDG)).toEqual({ usdg: -20n, token: 10n });
  });
});

describe('the split shares', () => {
  it('round the equity part down and leave the dust to spend', () => {
    expect(splitShares(1_000_000_001n, 1_000)).toEqual({ spendPart: 900_000_001n, equityPart: 100_000_000n });
    expect(splitShares(5n, 10_000)).toEqual({ spendPart: 0n, equityPart: 5n });
    expect(splitShares(5n, 0)).toEqual({ spendPart: 5n, equityPart: 0n });
  });

  it('refuse a share outside 0 to 10,000', () => {
    expect(() => splitShares(1n, 10_001)).toThrow(RangeError);
    expect(() => splitShares(1n, -1)).toThrow(RangeError);
  });
});
