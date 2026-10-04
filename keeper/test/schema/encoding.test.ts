import type { PGlite } from '@electric-sql/pglite';
import type { Receipt } from '@sleeve/core';
import { ACCOUNTING_MODES, REASONS, STATUSES, TRIGGERS } from '@sleeve/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Session, openDatabase } from './database';
import { ADA, RECEIPT_COLUMNS, RECEIPT_FIELD_NAMES, blankReceipt, encodeReceipt } from './fixtures';

/**
 * private.receipt_event_data is abi.encode(receipt) written in SQL, so the insert check can hold every receipt's typed
 * columns to its raw event data. These tests hold that encoder to viem's, over the edges of every Solidity type and
 * over random receipts.
 */

const UINT256_MAX = 2n ** 256n - 1n;
const INT256_MIN = -(2n ** 255n);
const INT256_MAX = 2n ** 255n - 1n;
const UINT128_MAX = 2n ** 128n - 1n;
const UINT80_MAX = 2n ** 80n - 1n;
const UINT64_MAX = 2n ** 64n - 1n;

/** A small deterministic generator, so a failure reproduces from the printed seed. */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function randomBits(next: () => number, bits: number): bigint {
  let value = 0n;
  for (let produced = 0; produced < bits; produced += 32) {
    value = (value << 32n) | BigInt(Math.floor(next() * 4_294_967_296));
  }
  return value & ((1n << BigInt(bits)) - 1n);
}

function randomHex(next: () => number, bytes: number): `0x${string}` {
  return `0x${randomBits(next, bytes * 8)
    .toString(16)
    .padStart(bytes * 2, '0')}`;
}

function pick<T>(next: () => number, members: readonly T[]): T {
  const member = members[Math.floor(next() * members.length)];
  if (member === undefined) throw new RangeError('empty member list');
  return member;
}

function randomReceipt(next: () => number): Receipt {
  const signed = (): bigint => randomBits(next, 256) + INT256_MIN;
  return {
    id: randomBits(next, 256),
    account: randomHex(next, 20),
    ruleVersion: Number(randomBits(next, 32)),
    trigger: pick(next, TRIGGERS),
    payer: randomHex(next, 20),
    status: pick(next, STATUSES),
    reason: pick(next, REASONS),
    mode: pick(next, ACCOUNTING_MODES),
    tickerId: Number(randomBits(next, 8)),
    token: randomHex(next, 20),
    tokenUid: randomHex(next, 32),
    usdgIn: randomBits(next, 256),
    usdgToSpend: randomBits(next, 256),
    usdgToEquity: randomBits(next, 256),
    usdgSpent: randomBits(next, 256),
    usdgQueued: randomBits(next, 256),
    tokensIn: randomBits(next, 256),
    tokensOut: randomBits(next, 256),
    usdgOut: randomBits(next, 256),
    uiMultiplier: randomBits(next, 256),
    execPrice: randomBits(next, 256),
    premiumBps: signed(),
    roundId: randomBits(next, 80),
    answer: signed(),
    updatedAt: randomBits(next, 256),
    usdgRoundId: randomBits(next, 80),
    usdgAnswer: signed(),
    quote: randomBits(next, 256),
    minOut: randomBits(next, 256),
    venueId: Number(randomBits(next, 8)),
    pool: randomHex(next, 20),
    calendarVersion: Number(randomBits(next, 32)),
    disclosureHash: randomHex(next, 32),
    l2Block: randomBits(next, 256),
    timestamp: randomBits(next, 256),
    lotId: randomBits(next, 256),
    queuedSince: randomBits(next, 64),
    overrideClosed: next() < 0.5,
    overrideCapBps: Number(randomBits(next, 16)),
  };
}

/** The receipt as the JSON object jsonb_populate_record turns into a receipts row. */
function asColumnsJson(receipt: Receipt): string {
  const row: Record<string, string | number | boolean> = {};
  for (const field of RECEIPT_FIELD_NAMES) {
    const value = receipt[field];
    row[RECEIPT_COLUMNS[field]] = typeof value === 'bigint' ? value.toString() : value;
  }
  return JSON.stringify(row);
}

let db: PGlite;

beforeAll(async () => {
  db = await openDatabase({ seed: false });
});

afterAll(async () => {
  await db?.close();
});

async function sqlEncoding(session: Session, receipts: readonly Receipt[]): Promise<string[]> {
  const rows = await session.rows<{ data: string }>(
    `select private.receipt_event_data(jsonb_populate_record(null::public.receipts, item)) as data
       from jsonb_array_elements($1::jsonb) with ordinality as list (item, position)
      order by position`,
    [`[${receipts.map(asColumnsJson).join(',')}]`],
  );
  return rows.map((row) => row.data);
}

describe('private.receipt_event_data', () => {
  it('matches viem at the edges of every Solidity type', async () => {
    const top: Receipt = {
      ...blankReceipt(UINT256_MAX, '0xffffffffffffffffffffffffffffffffffffffff'),
      ruleVersion: 4_294_967_295,
      trigger: 'PUBLIC',
      status: 'RECONCILED',
      reason: 'PREMIUM',
      tickerId: 255,
      usdgIn: UINT256_MAX,
      tokensOut: UINT128_MAX,
      premiumBps: INT256_MAX,
      roundId: UINT80_MAX,
      answer: INT256_MIN,
      usdgRoundId: UINT80_MAX,
      usdgAnswer: -1n,
      venueId: 255,
      calendarVersion: 4_294_967_295,
      tokenUid: `0x${'f'.repeat(64)}`,
      queuedSince: UINT64_MAX,
      overrideClosed: true,
      overrideCapBps: 65_535,
    };
    const bottom: Receipt = {
      ...blankReceipt(1n, ADA),
      trigger: 'KEEPER',
      status: 'FILLED',
      premiumBps: -1n,
      answer: 1n,
    };

    await Session.rolledBack(db, 'postgres', async (session) => {
      expect(await sqlEncoding(session, [top, bottom])).toEqual([encodeReceipt(top), encodeReceipt(bottom)]);
    });
  });

  it('matches viem on 300 random receipts', async () => {
    const seed = 4663;
    const next = generator(seed);
    const receipts = Array.from({ length: 300 }, () => randomReceipt(next));

    await Session.rolledBack(db, 'postgres', async (session) => {
      const encoded = await sqlEncoding(session, receipts);
      receipts.forEach((receipt, index) => {
        expect(encoded[index], `receipt ${index} of seed ${seed}`).toBe(encodeReceipt(receipt));
      });
    });
  });

  it('encodes enums by their contract position', async () => {
    await Session.rolledBack(db, 'postgres', async (session) => {
      const rows = await session.rows<{ label: string; word: string }>(
        `select label::text, private.abi_enum(label) as word from unnest(enum_range(null::public.receipt_status)) as label`,
      );
      expect(rows.map((row) => row.label)).toEqual([...STATUSES]);
      rows.forEach((row, index) => expect(BigInt(`0x${row.word}`)).toBe(BigInt(index)));
    });
  });

  it('refuses a value that is not a 256-bit integer instead of truncating it', async () => {
    await Session.rolledBack(db, 'postgres', async (session) => {
      const tooLarge = await session.refused(`select private.abi_word($1::numeric)`, [(UINT256_MAX + 1n).toString()]);
      expect(tooLarge.code).toBe('22003');
      const fraction = await session.refused(`select private.abi_word(1.5)`);
      expect(fraction.code).toBe('22003');
    });
  });
});
