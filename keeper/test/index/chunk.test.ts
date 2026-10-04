import { type Address, type Hex, type Receipt, ZERO_ADDRESS } from '@sleeve/core';
import { keccak256 } from 'viem';
import { describe, expect, it } from 'vitest';

import type { LogPosition, ModuleEvent, TransferLog } from '../../src/chain/events';
import { IndexIntegrityError } from '../../src/errors';
import {
  type ChunkInput,
  insideOwnerBracket,
  processChunk,
  sortsPayments,
  transactionsNeedingBoundaries,
  transferRecipients,
} from '../../src/index/chunk';
import { EMPTY_RULE } from '../../src/store/rows';
import type { AccountRecord } from '../../src/store/store';
import { ADA, BO, KEEPER, PAYER, SPY_POOL, blankReceipt, buyReceipt, encodeReceipt, queuedReceipt, txHashFor } from '../schema/fixtures';

const GRACE = 3_600n;

function pos(block: number, index: number, tx?: string): LogPosition {
  return { blockNumber: BigInt(block), logIndex: index, txHash: txHashFor(tx ?? `${block}:${index}`) };
}

function installed(address: Address, block: number, index = 0): AccountRecord {
  return {
    address,
    installedAt: { blockNumber: BigInt(block), logIndex: index },
    uninstalledAtBlock: null,
    keeper: KEEPER,
    rule: { version: 1, status: 'ACTIVE', equityBps: 5_000, tickerId: 0, premiumCapBps: 100, slippageBps: 50, minClip: 1_000_000n },
  };
}

function receiptEvent(receipt: Receipt, at: LogPosition): ModuleEvent {
  return { kind: 'ReceiptWritten', pos: at, receipt, data: encodeReceipt(receipt) };
}

function transfer(to: Address, amount: bigint, at: LogPosition, from: Address = PAYER): TransferLog {
  return { pos: at, from, to, amount };
}

function chunk(overrides: Partial<ChunkInput>): ChunkInput {
  const events = overrides.events ?? [];
  const hashes = new Map<bigint, Hex>();
  for (const event of events) if (event.kind === 'ReceiptWritten') hashes.set(event.receipt.id, keccak256(event.data));
  const transfers = overrides.transfers ?? [];
  return {
    fromBlock: 100n,
    toBlock: 200n,
    accounts: new Map(),
    events,
    transfers,
    receiptHashes: hashes,
    userOpBoundaries: new Map(),
    blockTimestamps: new Map(transfers.map((t) => [t.pos.blockNumber, 1_791_000_000n + t.pos.blockNumber])),
    graceSeconds: GRACE,
    ...overrides,
  };
}

describe('processChunk: accounts and rules', () => {
  it('starts an account at Installed with its keeper and the empty rule', () => {
    // #when
    const result = processChunk(chunk({ events: [{ kind: 'Installed', pos: pos(120, 3), account: ADA, keeper: KEEPER, spend: 0n }] }));
    // #then
    expect(result.accounts).toEqual([
      { address: ADA, installedAt: { blockNumber: 120n, logIndex: 3 }, uninstalledAtBlock: null, keeper: KEEPER, rule: EMPTY_RULE },
    ]);
  });

  it('follows RuleSet, RulePaused, RuleResumed and KeeperSet, and keeps every rule version', () => {
    // #given
    const rule = { version: 1, status: 'ACTIVE' as const, equityBps: 5_000, tickerId: 0, premiumCapBps: 100, slippageBps: 50, minClip: 1_000_000n };
    const events: ModuleEvent[] = [
      { kind: 'Installed', pos: pos(120, 0), account: ADA, keeper: KEEPER, spend: 0n },
      { kind: 'RuleSet', pos: pos(121, 0), account: ADA, version: 1, rule },
      { kind: 'RulePaused', pos: pos(122, 0), account: ADA, version: 1 },
      { kind: 'RuleResumed', pos: pos(123, 0), account: ADA, version: 1 },
      { kind: 'RulePaused', pos: pos(124, 0), account: ADA, version: 1 },
      { kind: 'KeeperSet', pos: pos(125, 0), account: ADA, keeper: BO },
    ];
    // #when
    const result = processChunk(chunk({ events }));
    // #then
    expect([result.accounts[0]?.rule, result.accounts[0]?.keeper, result.ruleVersions.map((row) => row.rule.version)]).toEqual([
      { ...rule, status: 'PAUSED' },
      BO,
      [1],
    ]);
  });

  it('empties the rule and the keeper at Uninstalled', () => {
    // #when
    const result = processChunk(
      chunk({ accounts: new Map([[ADA, installed(ADA, 50)]]), events: [{ kind: 'Uninstalled', pos: pos(150, 1), account: ADA, released: 0n }] }),
    );
    // #then
    expect(result.accounts).toEqual([{ ...installed(ADA, 50), uninstalledAtBlock: 150n, keeper: ZERO_ADDRESS, rule: EMPTY_RULE }]);
  });

  it('refuses a module log for an account the index never saw installed', () => {
    // #when
    const attempt = () => processChunk(chunk({ events: [{ kind: 'KeeperSet', pos: pos(150, 1), account: ADA, keeper: BO }] }));
    // #then
    expect(attempt).toThrow(IndexIntegrityError);
  });

  it('refuses a receipt whose hash was not checked', () => {
    // #given
    const event = receiptEvent(queuedReceipt(1n, ADA, 10_000_000n), pos(150, 1));
    // #when
    const attempt = () =>
      processChunk(chunk({ accounts: new Map([[ADA, installed(ADA, 50)]]), events: [event], receiptHashes: new Map() }));
    // #then
    expect(attempt).toThrow('has no checked hash');
  });
});

describe('processChunk: which transfers are payments', () => {
  const ada = new Map([[ADA, installed(ADA, 50)]]);

  it('records a transfer to an installed account as a payment', () => {
    // #when
    const result = processChunk(chunk({ accounts: ada, transfers: [transfer(ADA, 10_000_000n, pos(130, 2))] }));
    // #then
    expect(result.payments).toEqual([
      {
        pos: pos(130, 2),
        blockTimestamp: 1_791_000_130n,
        from: PAYER,
        to: ADA,
        amount: 10_000_000n,
        status: 'RECEIVED',
        graceEndsAt: null,
        sortedBy: null,
      },
    ]);
  });

  it.each([
    ['before its Installed log in the same range', [{ kind: 'Installed', pos: pos(140, 5), account: ADA, keeper: KEEPER, spend: 0n }] as ModuleEvent[], new Map(), pos(140, 2), 'NOT_INSTALLED'],
    ['after an uninstall', [{ kind: 'Uninstalled', pos: pos(120, 0), account: ADA, released: 0n }] as ModuleEvent[], ada, pos(130, 0), 'NOT_INSTALLED'],
    ['at or before the install the index holds', [] as ModuleEvent[], new Map([[ADA, installed(ADA, 130, 4)]]), pos(130, 1), 'BEFORE_INSTALL'],
  ])('skips a transfer %s', (_label, events, accounts, at, reason) => {
    // #when
    const result = processChunk(chunk({ accounts, events, transfers: [transfer(ADA, 1_000_000n, at)] }));
    // #then
    expect([result.payments.length, result.skipped.map((skip) => skip.reason)]).toEqual([0, [reason]]);
  });

  it('skips zero transfers and transfers to itself', () => {
    // #when
    const result = processChunk(
      chunk({ accounts: ada, transfers: [transfer(ADA, 0n, pos(130, 1)), transfer(ADA, 5n, pos(131, 1), ADA)] }),
    );
    // #then
    expect(result.skipped.map((skip) => skip.reason)).toEqual(['ZERO_AMOUNT', 'SELF_TRANSFER']);
  });

  it("skips USDG that moved inside the account's bracketed owner op", () => {
    // #given
    const owner = { kind: 'OwnerOpEnded', pos: pos(130, 9, 'op'), account: ADA, ownerDelta: 5n, moduleDelta: 0n } as const;
    // #when
    const result = processChunk(chunk({ accounts: ada, events: [owner], transfers: [transfer(ADA, 5n, pos(130, 4, 'op'))] }));
    // #then
    expect(result.skipped.map((skip) => skip.reason)).toEqual(['OWNER_BRACKET']);
  });

  it("keeps a payer's transfer from an earlier UserOp in the same bundle as a payment", () => {
    // #given
    const owner = { kind: 'OwnerOpEnded', pos: pos(130, 9, 'bundle'), account: ADA, ownerDelta: 0n, moduleDelta: 0n } as const;
    const boundaries = new Map([[txHashFor('bundle'), [5, 10]]]);
    // #when
    const result = processChunk(
      chunk({ accounts: ada, events: [owner], transfers: [transfer(ADA, 5_000_000n, pos(130, 4, 'bundle'))], userOpBoundaries: boundaries }),
    );
    // #then
    expect(result.payments.map((payment) => payment.amount)).toEqual([5_000_000n]);
  });

  it('skips sale proceeds from the pool a PART_SOLD or SOLD receipt names', () => {
    // #given
    const sale: Receipt = { ...blankReceipt(7n, ADA), status: 'SOLD', trigger: 'OWNER', pool: SPY_POOL, tokensIn: 5n, usdgOut: 4n, usdgToSpend: 4n, lotId: 3n };
    // #when
    const result = processChunk(
      chunk({ accounts: ada, events: [receiptEvent(sale, pos(130, 8, 'sell'))], transfers: [transfer(ADA, 4n, pos(130, 6, 'sell'), SPY_POOL)] }),
    );
    // #then
    expect(result.skipped.map((skip) => skip.reason)).toEqual(['SALE_PROCEEDS']);
  });
});

describe('processChunk: payment status', () => {
  const ada = new Map([[ADA, installed(ADA, 50)]]);

  it('puts unsorted payments before an Observed log in WAITING_GRACE until observedAt plus the grace', () => {
    // #given
    const observed = { kind: 'Observed', pos: pos(140, 0), account: ADA, observedAt: 1_791_068_000n, observedUnsorted: 10_000_000n } as const;
    // #when
    const result = processChunk(
      chunk({ accounts: ada, events: [observed], transfers: [transfer(ADA, 10_000_000n, pos(130, 0)), transfer(ADA, 5_000_000n, pos(150, 0))] }),
    );
    // #then
    expect(result.payments.map((payment) => [payment.status, payment.graceEndsAt])).toEqual([
      ['WAITING_GRACE', 1_791_068_000n + GRACE],
      ['RECEIVED', null],
    ]);
  });

  it('sorts every unsorted payment before a split receipt with that receipt', () => {
    // #given
    const split = receiptEvent(queuedReceipt(1n, ADA, 15_000_000n), pos(160, 2));
    // #when
    const result = processChunk(
      chunk({
        accounts: ada,
        events: [split],
        transfers: [transfer(ADA, 10_000_000n, pos(130, 0)), transfer(ADA, 5_000_000n, pos(150, 0)), transfer(ADA, 1_000_000n, pos(170, 0))],
      }),
    );
    // #then
    expect(result.payments.map((payment) => [payment.status, payment.sortedBy])).toEqual([
      ['SORTED', 1n],
      ['SORTED', 1n],
      ['RECEIVED', null],
    ]);
  });

  it.each([
    ['a settle', { ...buyReceipt(2n, ADA, { tickerId: 0, tokensOut: 5n, status: 'SETTLED' }) }],
    ['a release', { ...blankReceipt(2n, ADA), status: 'RELEASED', trigger: 'OWNER', usdgToSpend: 5n } as Receipt],
    ['a reconcile', { ...blankReceipt(2n, ADA), status: 'RECONCILED', usdgIn: 5n, usdgSpent: 5n } as Receipt],
    ['a settle refusal', { ...blankReceipt(2n, ADA), status: 'REFUSED_TICKER', usdgToEquity: 5n, usdgToSpend: 5n } as Receipt],
  ])('does not sort with %s', (_label, receipt) => {
    // #when
    const result = processChunk(chunk({ accounts: ada, events: [receiptEvent(receipt, pos(160, 0))], transfers: [transfer(ADA, 5n, pos(130, 0))] }));
    // #then
    expect([sortsPayments(receipt), result.payments[0]?.status]).toEqual([false, 'RECEIVED']);
  });

  it('moves payments from earlier ranges with one update per account: the first split wins over observations', () => {
    // #given
    const events: ModuleEvent[] = [
      { kind: 'Observed', pos: pos(110, 0), account: ADA, observedAt: 1_791_068_000n, observedUnsorted: 1n },
      receiptEvent(queuedReceipt(4n, ADA, 15_000_000n), pos(120, 0)),
      receiptEvent(queuedReceipt(5n, ADA, 1_000_000n), pos(130, 0)),
      { kind: 'Observed', pos: pos(140, 0), account: ADA, observedAt: 1_791_069_000n, observedUnsorted: 1n },
    ];
    // #when
    const result = processChunk(chunk({ accounts: ada, events }));
    // #then
    expect(result.earlierPayments).toEqual([
      { account: ADA, epoch: { blockNumber: 50n, logIndex: 0 }, beforeBlock: 100n, change: { status: 'SORTED', sortedBy: 4n } },
    ]);
  });

  it('moves earlier payments to WAITING_GRACE with the latest observation when nothing sorts them', () => {
    // #given
    const events: ModuleEvent[] = [
      { kind: 'Observed', pos: pos(110, 0), account: ADA, observedAt: 1_791_068_000n, observedUnsorted: 1n },
      { kind: 'Observed', pos: pos(140, 0), account: ADA, observedAt: 1_791_069_000n, observedUnsorted: 1n },
    ];
    // #when
    const result = processChunk(chunk({ accounts: ada, events }));
    // #then
    expect(result.earlierPayments.map((update) => update.change)).toEqual([
      { status: 'WAITING_GRACE', graceEndsAt: 1_791_069_000n + GRACE },
    ]);
  });

  it('leaves an earlier install’s payments alone after a reinstall: they are in the new snapshot (I5)', () => {
    // #given
    const events: ModuleEvent[] = [
      { kind: 'Installed', pos: pos(140, 0), account: ADA, keeper: KEEPER, spend: 20_000_000n },
      receiptEvent(queuedReceipt(4n, ADA, 3_000_000n), pos(160, 0)),
    ];
    // #when
    const result = processChunk(
      chunk({ accounts: ada, events, transfers: [transfer(ADA, 10_000_000n, pos(130, 0)), transfer(ADA, 3_000_000n, pos(150, 0))] }),
    );
    // #then
    expect([result.earlierPayments, result.payments.map((payment) => payment.status)]).toEqual([[], ['RECEIVED', 'SORTED']]);
  });
});

describe('transferRecipients', () => {
  it('queries accounts installed at the start or inside the range, not uninstalled ones', () => {
    // #given
    const accounts = new Map<Address, AccountRecord>([
      [ADA, installed(ADA, 50)],
      [BO, { ...installed(BO, 50), uninstalledAtBlock: 60n }],
    ]);
    const carl = '0xca71000000000000000000000000000000000006';
    // #when
    const recipients = transferRecipients(accounts, [{ kind: 'Installed', pos: pos(150, 0), account: carl, keeper: KEEPER, spend: 0n }]);
    // #then
    expect(recipients).toEqual([ADA, carl]);
  });
});

describe('transactionsNeedingBoundaries', () => {
  it('lists transactions where a transfer precedes an OwnerOpEnded of its account', () => {
    // #given
    const events: ModuleEvent[] = [
      { kind: 'OwnerOpEnded', pos: pos(130, 9, 'a'), account: ADA, ownerDelta: 0n, moduleDelta: 0n },
      { kind: 'OwnerOpEnded', pos: pos(131, 1, 'b'), account: ADA, ownerDelta: 0n, moduleDelta: 0n },
    ];
    // #when
    const txs = transactionsNeedingBoundaries(events, [transfer(ADA, 1n, pos(130, 3, 'a')), transfer(ADA, 1n, pos(131, 5, 'b'))]);
    // #then
    expect(txs).toEqual([txHashFor('a')]);
  });
});

describe('insideOwnerBracket', () => {
  it.each([
    ['no bracket end', 3, undefined, undefined, false],
    ['a bracket end before it', 3, [2], undefined, false],
    ['a bracket end after it, no UserOps', 3, [9], undefined, true],
    ['a bracket end in the same UserOp', 3, [9], [10], true],
    ['a UserOp boundary between them', 3, [9], [5, 10], false],
  ])('%s', (_label, index, ends, boundaries, inside) => {
    // #when
    const answer = insideOwnerBracket(index, ends, boundaries);
    // #then
    expect(answer).toBe(inside);
  });
});
