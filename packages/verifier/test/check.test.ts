import { DISCLOSURE, premiumBps, type Receipt } from '@sleeve/core';
import { keccak256, toHex } from 'viem';
import { describe, expect, it } from 'vitest';

import { checkEvidence } from '../src/check';
import type { Evidence } from '../src/evidence';
import { encodeReceipt, hashReceipt } from '../src/receipt';
import type { VerifyResult } from '../src/types';
import { disclosureHashOf } from '../src/verify';
import {
  ACCOUNT,
  EQUITY,
  MONDAY,
  RULE,
  TOKENS,
  evidenceFor,
  filledSplit,
  queuedSplit,
  receiptLog,
  sellEvidence,
  settledBucket,
  twoSells,
} from './support/fixtures';

/** The rows that do not match, by id, so a test states exactly which ones a change touches. */
function mismatches(result: VerifyResult): string[] {
  return [...result.fields, ...result.checks].filter((row) => row.status === 'MISMATCH').map((row) => row.id);
}

function field(result: VerifyResult, name: keyof Receipt): VerifyResult['fields'][number] {
  const row = result.fields.find((candidate) => candidate.field === name);
  if (row === undefined) throw new Error(`no row for ${name}`);
  return row;
}

function check(result: VerifyResult, id: string): VerifyResult['checks'][number] {
  const row = result.checks.find((candidate) => candidate.id === id);
  if (row === undefined) throw new Error(`no check ${id}; checks: ${result.checks.map((c) => c.id).join(', ')}`);
  return row;
}

/** The receipt logged with one field changed, the stored hash left as the module wrote it. */
function tampered(evidence: Evidence, receipt: Receipt, change: Partial<Receipt>): Evidence {
  const changed = { ...receipt, ...change };
  return { ...evidence, receiptLog: { ...evidence.receiptLog, data: encodeReceipt(changed) } };
}

describe('a good receipt', () => {
  it('matches every field and check of a split that filled', () => {
    // #given a keeper split that filled, with the logs and reads the chain holds for it
    const { evidence } = filledSplit();
    // #when
    const result = checkEvidence(evidence);
    // #then
    expect(mismatches(result)).toEqual([]);
    expect(result.verdict).toBe('MATCH');
    expect(result.kind).toBe('SPLIT_FILL');
    expect(result.fields).toHaveLength(39);
    expect(result.storedHash).toBe(result.recomputedHash);
    expect(field(result, 'usdgSpent').source).toMatch(/Transfer logs/);
    expect(field(result, 'answer').source).toMatch(/getRoundData/);
    expect(check(result, 'premium-cap').observed).toBe('0');
    expect(result.derived.find((row) => row.id === 'inbound-total')?.value).toBe('1000000000');
  });

  it('matches a settle of a bucket queued over the weekend', () => {
    const result = checkEvidence(settledBucket().evidence);
    expect(mismatches(result)).toEqual([]);
    expect(field(result, 'reason').recomputed).toBe('SESSION');
    expect(field(result, 'usdgIn').source).toMatch(/leaves it zero/);
  });

  it('matches a split that queued SESSION on a Saturday, and names the session in the reason', () => {
    const result = checkEvidence(queuedSplit().evidence);
    expect(mismatches(result)).toEqual([]);
    expect(field(result, 'reason').source).toMatch(/closed \(WEEKEND\)/);
    expect(check(result, 'guard-outcome').observed).toBe('QUEUED SESSION');
  });
});

describe('a tampered field', () => {
  it('fails the hash and the field, and every field only the hash vouches for', () => {
    // #given the logged receipt says one base unit less was spent than the module hashed
    const { receipt, evidence } = filledSplit();
    // #when
    const result = checkEvidence(tampered(evidence, receipt, { usdgSpent: EQUITY - 1n }));
    // #then
    expect(result.verdict).toBe('MISMATCH');
    expect(mismatches(result)).toEqual(
      expect.arrayContaining(['receipt-hash', 'field:usdgSpent', 'field:usdgIn', 'field:quote', 'field:trigger', 'conservation']),
    );
    expect(field(result, 'usdgSpent').recomputed).toBe(EQUITY.toString());
    expect(field(result, 'quote').recomputed).toMatch(/stored hash differs/);
    expect(field(result, 'tokensOut').status).toBe('MATCH');
  });

  it('fails the hash and every committed field when a field nothing else records changed', () => {
    const { receipt, evidence } = filledSplit();
    const result = checkEvidence(tampered(evidence, receipt, { quote: receipt.quote + 1_000_000n }));
    expect(result.verdict).toBe('MISMATCH');
    expect(mismatches(result)).toEqual(expect.arrayContaining(['receipt-hash', 'field:quote', 'field:trigger', 'field:minOut']));
    expect(field(result, 'tokensOut').status).toBe('MATCH');
  });
});

describe('a wrong stored hash', () => {
  it('fails the hash and the committed fields while the recomputed ones still match', () => {
    // #given a module that stored another hash for the id
    const { evidence } = filledSplit();
    // #when
    const result = checkEvidence({ ...evidence, storedHash: keccak256(toHex('another receipt')) });
    // #then
    expect(result.verdict).toBe('MISMATCH');
    expect(check(result, 'receipt-hash').status).toBe('MISMATCH');
    expect(mismatches(result).sort()).toEqual(
      ['receipt-hash', 'field:trigger', 'field:usdgIn', 'field:roundId', 'field:usdgRoundId', 'field:quote'].sort(),
    );
  });
});

describe('a stale round', () => {
  it('fails the age check when the round was older than 25 hours at the fill', () => {
    // #given a Wednesday fill on a round one second past the 90,000-second limit
    const wednesday = MONDAY + 2n * 86_400n;
    const { evidence } = filledSplit({ timestamp: wednesday, updatedAt: wednesday - 90_001n });
    // #when
    const result = checkEvidence(evidence);
    // #then only the age check fails
    expect(mismatches(result)).toEqual(['round-age']);
    expect(check(result, 'round-age').observed).toBe('90001');
  });

  it('fails the reopen check when the round was observed before the session opened', () => {
    const { evidence } = filledSplit({ updatedAt: MONDAY - 15n * 3_600n - 1n });
    const result = checkEvidence(evidence);
    expect(mismatches(result)).toEqual(['round-after-open']);
  });

  it('fails the answer and the premium when getRoundData no longer gives the receipt answer', () => {
    const { receipt, evidence } = filledSplit();
    const stockRound = { ok: true as const, value: { roundId: receipt.roundId, answer: receipt.answer * 2n, startedAt: receipt.updatedAt, updatedAt: receipt.updatedAt } };
    const result = checkEvidence({ ...evidence, stockRound });
    expect(mismatches(result).sort()).toEqual(['field:answer', 'field:premiumBps'].sort());
  });

  it('fails every round row when the round is gone', () => {
    const { evidence } = filledSplit();
    const result = checkEvidence({ ...evidence, stockRound: { ok: false, error: 'no data present for the round' } });
    expect(mismatches(result)).toEqual(expect.arrayContaining(['field:answer', 'field:updatedAt', 'field:premiumBps', 'premium-cap', 'round-fresh']));
  });
});

describe('a premium over the cap', () => {
  it('fails I8 when the fill paid more than the cap above the feed', () => {
    // #given a fill 150 bps above the round's answer under a 100 bps cap
    const answer = premiumAnswer(150n);
    const { evidence } = filledSplit({ answer });
    // #when
    const result = checkEvidence(evidence);
    // #then
    expect(mismatches(result)).toEqual(['premium-cap']);
    expect(check(result, 'premium-cap').observed).toBe(premiumBps(EQUITY, TOKENS, answer).toString());
    expect(check(result, 'premium-cap').expected).toBe(RULE.premiumCapBps.toString());
  });

  it('passes a fill exactly at the cap', () => {
    const answer = premiumAnswer(100n);
    const { evidence } = filledSplit({ answer });
    expect(premiumBps(EQUITY, TOKENS, answer)).toBe(100n);
    expect(mismatches(checkEvidence(evidence))).toEqual([]);
  });

  it('fails one basis point over the cap', () => {
    const answer = premiumAnswer(101n);
    expect(premiumBps(EQUITY, TOKENS, answer)).toBe(101n);
    expect(mismatches(checkEvidence(filledSplit({ answer }).evidence))).toEqual(['premium-cap']);
  });
});

/** The smallest answer at which the fill's premium is at most `bps`: the receipt's premium is then exactly `bps`. */
function premiumAnswer(bps: bigint): bigint {
  const numerator = EQUITY * 10n ** 20n * 10_000n;
  const denominator = TOKENS * (10_000n + bps);
  return (numerator + denominator - 1n) / denominator;
}

describe('sell runs', () => {
  it('keeps two sells in one transaction apart and checks each against its own swap', () => {
    // #given one owner batch with a sell by lot and a sell by amount across two lots
    const { receipts, logs } = twoSells();
    // #when / #then every receipt matches against its own run
    for (const receipt of receipts) {
      const result = checkEvidence(sellEvidence(receipt, logs));
      expect(mismatches(result), `receipt ${receipt.id}`).toEqual([]);
    }
    const last = receipts[2];
    if (last === undefined) throw new Error('fixture');
    const result = checkEvidence(sellEvidence(last, logs));
    expect(check(result, 'sell-run').observed).toBe('receipts 21, 22');
    expect(result.derived.find((row) => row.id === 'sell-tokens')?.value).toBe((TOKENS + TOKENS / 2n).toString());
  });

  it("does not sum over the whole transaction: the first sell's run is that sell alone", () => {
    const { receipts, logs } = twoSells();
    const first = receipts[0];
    if (first === undefined) throw new Error('fixture');
    const result = checkEvidence(sellEvidence(first, logs));
    expect(check(result, 'sell-run').observed).toBe('receipts 20');
    expect(check(result, 'run-usdg').observed).toBe('99901158');
  });

  it('breaks the run at a receipt that does not share the whole-sell fields', () => {
    const { receipts, logs } = twoSells();
    const [, second, third] = receipts;
    if (second === undefined || third === undefined) throw new Error('fixture');
    const odd = { ...third, quote: third.quote + 1n };
    const changed = logs.map((log) => (log.logIndex === 12 ? receiptLog(odd, { logIndex: 12 }) : log));
    const result = checkEvidence(sellEvidence(odd, changed));
    expect(check(result, 'sell-run').status).toBe('MISMATCH');
    expect(check(result, 'sell-run').observed).toBe('receipts 21');
    expect(field(result, 'usdgOut').status).toBe('MISMATCH');
  });

  it("fails the lot's status when a SOLD lot is not SOLD now", () => {
    const { receipts, logs } = twoSells();
    const first = receipts[0];
    if (first === undefined) throw new Error('fixture');
    const result = checkEvidence(sellEvidence(first, logs, 'PART_SOLD'));
    expect(mismatches(result)).toEqual(['lot-status']);
  });

  it('fails the discount cap when the sale received too little, and checks an override cap', () => {
    const { receipts, logs, answer } = twoSells();
    const first = receipts[0];
    if (first === undefined) throw new Error('fixture');
    const low = checkEvidence({ ...sellEvidence(first, logs), stockRound: { ok: true, value: { roundId: first.roundId, answer: answer + answer / 50n, startedAt: first.updatedAt, updatedAt: first.updatedAt } } });
    expect(mismatches(low)).toEqual(expect.arrayContaining(['discount-cap', 'field:answer', 'field:premiumBps']));
  });

  it('applies an override cap between the rule cap and 500 bps, and fails one outside it', async () => {
    const { sellReceipts, sellSwapLogs, receiptLog: logOf } = await import('./support/fixtures');
    const { answer } = twoSells();
    const usdgOut = 98_000_000n;
    const [wide] = sellReceipts([{ id: 40n, lotId: 10n, tokensIn: TOKENS, status: 'SOLD' }], usdgOut, 760_000_000n, answer, { overrideCapBps: 300 });
    if (wide === undefined) throw new Error('fixture');
    const logs = [...sellSwapLogs(TOKENS, usdgOut, 0), logOf(wide, { logIndex: 5 })];
    const result = checkEvidence(sellEvidence(wide, logs));
    expect(mismatches(result)).toEqual([]);
    expect(check(result, 'discount-cap').expected).toBe('300');
    expect(check(result, 'override-cap').status).toBe('MATCH');
    const [narrow] = sellReceipts([{ id: 40n, lotId: 10n, tokensIn: TOKENS, status: 'SOLD' }], usdgOut, 760_000_000n, answer, { overrideCapBps: 50 });
    if (narrow === undefined) throw new Error('fixture');
    const narrowLogs = [...sellSwapLogs(TOKENS, usdgOut, 0), logOf(narrow, { logIndex: 5 })];
    expect(mismatches(checkEvidence(sellEvidence(narrow, narrowLogs)))).toEqual(['override-cap', 'discount-cap']);
  });
});

describe('queued receipts', () => {
  it('fails the reason when the guard on chain data gives another one', () => {
    const { evidence } = queuedSplit({ reason: 'STALE' });
    const result = checkEvidence(evidence);
    expect(field(result, 'reason').recomputed).toBe('SESSION');
    expect(check(result, 'guard-outcome').observed).toBe('QUEUED SESSION');
    expect(result.verdict).toBe('MISMATCH');
  });

  it('accepts CLIP for a zero equity part without a guard, and nothing queued', () => {
    const { evidence } = queuedSplit({ reason: 'CLIP', usdgToSpend: 1_000_000_000n, usdgToEquity: 0n, usdgQueued: 0n });
    const result = checkEvidence({ ...evidence, rule: { ...RULE, equityBps: 0 } });
    expect(mismatches(result)).toEqual([]);
    expect(check(result, 'guard-outcome').source).toMatch(/zero equity part/);
  });

  it('accepts PREMIUM above the cap and refuses it within the cap', () => {
    const swap = { quote: 1_294_053_283_802_300n, venueId: 1, pool: '0xa7Bb1AC63BBaB0C44316E6c8C455213441689167' as const, timestamp: MONDAY };
    const rounds = { roundId: 1n, answer: 77_276_570_642n, updatedAt: MONDAY - 600n, usdgRoundId: 2n, usdgAnswer: 100_000_000n };
    const minOut = (EQUITY * swap.quote) / 1_000_000n * 9_950n / 10_000n;
    const above = queuedSplit({ reason: 'PREMIUM', premiumBps: 150n, minOut, ...swap, ...rounds });
    expect(mismatches(checkEvidence(above.evidence))).toEqual([]);
    const within = queuedSplit({ reason: 'PREMIUM', premiumBps: 50n, minOut, ...swap, ...rounds });
    const result = checkEvidence(within.evidence);
    expect(check(result, 'guard-outcome').observed).toBe('FILLED');
    expect(mismatches(result)).toEqual(expect.arrayContaining(['field:reason', 'guard-outcome', 'premium-over-cap']));
  });

  it('names a paused oracle at the receipt from the first switch after it', () => {
    const { evidence } = queuedSplit({ reason: 'ORACLE_PAUSED', timestamp: MONDAY });
    const history = evidence.history;
    if (history === null) throw new Error('fixture');
    const unpausedLater = { set: false, position: { blockNumber: evidence.receiptLog.blockNumber + 5n, logIndex: 0 }, transactionHash: evidence.receiptLog.transactionHash };
    const result = checkEvidence({ ...evidence, history: { ...history, oraclePaused: { now: false, after: [unpausedLater] } } });
    expect(mismatches(result)).toEqual([]);
    expect(check(result, 'guard-outcome').observed).toBe('QUEUED ORACLE_PAUSED');
  });
});

describe('refusals', () => {
  it('accepts REFUSED_TICKER when the ticker was removed before the receipt', () => {
    const { evidence } = queuedSplit({ status: 'REFUSED_TICKER', reason: 'NONE', usdgToSpend: 1_000_000_000n, usdgQueued: 0n });
    const ticker = evidence.ticker;
    if (ticker === null || !ticker.ok) throw new Error('fixture');
    const result = checkEvidence({ ...evidence, ticker: { ok: true, value: { ...ticker.value, active: false } }, tickerRemovedAfter: false });
    expect(mismatches(result)).toEqual([]);
    expect(check(result, 'guard-outcome').observed).toBe('REFUSED_TICKER');
  });

  it('fails REFUSED_TICKER for a ticker active now, or removed only after the receipt', () => {
    const { evidence } = queuedSplit({ status: 'REFUSED_TICKER', reason: 'NONE', usdgToSpend: 1_000_000_000n, usdgQueued: 0n });
    expect(mismatches(checkEvidence(evidence))).toEqual(['guard-outcome']);
    const ticker = evidence.ticker;
    if (ticker === null || !ticker.ok) throw new Error('fixture');
    const later = checkEvidence({ ...evidence, ticker: { ok: true, value: { ...ticker.value, active: false } }, tickerRemovedAfter: true });
    expect(mismatches(later)).toEqual(['guard-outcome']);
  });

  it('leaves REFUSED_ACCOUNT to the hash and says the blocklist is not re-read', () => {
    const { evidence } = queuedSplit({ status: 'REFUSED_ACCOUNT', reason: 'NONE', usdgToSpend: 1_000_000_000n, usdgQueued: 0n });
    const result = checkEvidence(evidence);
    expect(mismatches(result)).toEqual([]);
    expect(result.checks.some((row) => row.id === 'guard-outcome')).toBe(false);
    expect(result.derived.find((row) => row.id === 'blocklist-note')?.value).toMatch(/not re-read/);
  });
});

describe('releases and reconciles', () => {
  const release = (overrides: Partial<Receipt> = {}): Evidence => {
    const receipt = { ...queuedSplit().receipt, id: 7n, trigger: 'OWNER' as const, status: 'RELEASED' as const, reason: 'CLIP' as const, usdgIn: 0n, usdgToSpend: 10_000_000n, usdgToEquity: 0n, usdgQueued: 0n, queuedSince: MONDAY - 60n, timestamp: MONDAY, ...overrides };
    return evidenceFor(receipt, [receiptLog(receipt, { logIndex: 1 })]);
  };

  it('matches a release, and fails one whose bucket started waiting after it', () => {
    expect(mismatches(checkEvidence(release()))).toEqual([]);
    expect(mismatches(checkEvidence(release({ queuedSince: MONDAY + 1n })))).toEqual(['queued-before']);
  });

  it('matches a ledger reconcile against its Reconciled log, and fails a different cut', async () => {
    const { reconciledLog } = await import('./support/fixtures');
    const receipt = { ...queuedSplit().receipt, id: 9n, status: 'RECONCILED' as const, reason: 'NONE' as const, token: '0x0000000000000000000000000000000000000000' as const, usdgIn: 30n, usdgToSpend: 0n, usdgToEquity: 0n, usdgSpent: 20n, usdgQueued: 10n, timestamp: MONDAY };
    const logs = [receiptLog(receipt, { logIndex: 1 }), reconciledLog(ACCOUNT, 9n, 970n, 20n, [10n, 0n, 0n, 0n], { logIndex: 2 })];
    expect(mismatches(checkEvidence(evidenceFor(receipt, logs)))).toEqual([]);
    const other = [receiptLog(receipt, { logIndex: 1 }), reconciledLog(ACCOUNT, 9n, 970n, 25n, [5n, 0n, 0n, 0n], { logIndex: 2 })];
    expect(mismatches(checkEvidence(evidenceFor(receipt, other))).sort()).toEqual(['field:usdgQueued', 'field:usdgSpent'].sort());
    expect(mismatches(checkEvidence(evidenceFor(receipt, [receiptLog(receipt, { logIndex: 1 })]))).sort()).toEqual(
      ['field:usdgIn', 'field:usdgQueued', 'field:usdgSpent', 'reconciled-log'].sort(),
    );
  });

  it("matches a lot reconcile's run against LotsReconciled", async () => {
    const { lotsReconciledLog } = await import('./support/fixtures');
    const base = { ...queuedSplit().receipt, trigger: 'OWNER' as const, status: 'RECONCILED' as const, reason: 'NONE' as const, usdgIn: 0n, usdgToSpend: 0n, usdgToEquity: 0n, usdgQueued: 0n, timestamp: MONDAY };
    const first = { ...base, id: 30n, lotId: 3n, tokensIn: 5n };
    const second = { ...base, id: 31n, lotId: 4n, tokensIn: 7n };
    const logs = [receiptLog(first, { logIndex: 0 }), receiptLog(second, { logIndex: 1 }), lotsReconciledLog(ACCOUNT, 0, 88n, 12n, { logIndex: 2 })];
    const lot = { ok: true as const, value: { account: ACCOUNT, tickerId: 0, status: 'FILLED' as const, tokensBought: 100n, tokensRemaining: 0n } };
    const result = checkEvidence({ ...evidenceFor(first, logs), lot });
    expect(mismatches(result)).toEqual([]);
    expect(check(result, 'lot-run').observed).toBe('receipts 30, 31');
    const short = [receiptLog(first, { logIndex: 0 }), receiptLog(second, { logIndex: 1 }), lotsReconciledLog(ACCOUNT, 0, 88n, 13n, { logIndex: 2 })];
    expect(mismatches(checkEvidence({ ...evidenceFor(second, short), lot }))).toEqual(['lots-reconciled']);
  });
});

describe('the token, the pool and the calendar at the receipt', () => {
  it('reads the multiplier at the fill from the last update before it when updates follow', () => {
    const { evidence } = filledSplit();
    const history = evidence.history;
    if (history === null) throw new Error('fixture');
    const later = { oldMultiplier: 1_001_717_991_187_472_003n, newMultiplier: 1_002_000_000_000_000_000n, effectiveAt: MONDAY + 86_400n * 10n, position: { blockNumber: evidence.receiptLog.blockNumber + 10n, logIndex: 0 }, transactionHash: evidence.receiptLog.transactionHash };
    const before = { ...later, oldMultiplier: 10n ** 18n, newMultiplier: 1_001_717_991_187_472_003n, effectiveAt: MONDAY - 86_400n, position: { blockNumber: 1n, logIndex: 0 } };
    const result = checkEvidence({ ...evidence, history: { ...history, multiplier: { ...history.multiplier, newUIMultiplier: later.newMultiplier, effectiveAt: later.effectiveAt, after: [later], lastBefore: before } } });
    expect(mismatches(result)).toEqual([]);
    expect(result.derived.find((row) => row.id === 'multiplier-changes')?.value).toBe('1');
  });

  it('fails the multiplier check when a change was due inside the window at the fill', () => {
    const { evidence } = filledSplit();
    const history = evidence.history;
    if (history === null) throw new Error('fixture');
    const multiplier = { ...history.multiplier, newUIMultiplier: 1_002_000_000_000_000_000n, effectiveAt: MONDAY + 600n, uiMultiplier: 1_002_000_000_000_000_000n, lastBefore: { oldMultiplier: history.multiplier.uiMultiplier, newMultiplier: 1_002_000_000_000_000_000n, effectiveAt: MONDAY + 600n, position: { blockNumber: 1n, logIndex: 0 }, transactionHash: evidence.receiptLog.transactionHash } };
    const result = checkEvidence({ ...evidence, latestTimestamp: MONDAY + 3_600n, history: { ...history, multiplier } });
    expect(mismatches(result)).toEqual(['no-multiplier-due']);
  });

  it('accepts a pool removed from the allowlist after the receipt, and fails one never on it', () => {
    const { evidence } = filledSplit();
    const pool = evidence.pool;
    if (pool === null) throw new Error('fixture');
    expect(mismatches(checkEvidence({ ...evidence, pool: { ...pool, allowedNow: { ok: true, value: false }, firstChangeAfter: false } }))).toEqual([]);
    expect(mismatches(checkEvidence({ ...evidence, pool: { ...pool, allowedNow: { ok: true, value: false } } }))).toEqual(['pool-allowlisted']);
  });

  it('takes the session from the deployed calendar once a timelocked write is in force, and recomputes the version', () => {
    const { receipt, evidence } = filledSplit();
    const withWrite = { ...receipt, calendarVersion: 65_537 };
    const logs = evidence.transaction.logs.map((log) => (log.logIndex === 5 ? receiptLog(withWrite, { logIndex: 5 }) : log));
    const changed = { ...evidence, receiptLog: receiptLog(withWrite, { logIndex: 5 }), storedHash: hashReceipt(withWrite), transaction: { ...evidence.transaction, logs }, calendar: { ...evidence.calendar, versionNow: 65_538, writeCountNow: 2, writesAfter: 1 } };
    const result = checkEvidence(changed);
    expect(mismatches(result)).toEqual([]);
    expect(check(result, 'session-open').source).toMatch(/calendar extension/);
    expect(result.checks.some((row) => row.id === 'calendar-agrees')).toBe(false);
  });

  it('fails when the deployed calendar disagrees with the port', () => {
    const { evidence } = filledSplit();
    const result = checkEvidence({ ...evidence, calendar: { ...evidence.calendar, session: { ok: true, value: { open: false, reason: 'HOLIDAY', openedAt: 0n } } } });
    expect(mismatches(result)).toEqual(['calendar-agrees']);
  });

  it('fails a token that does not report 18 decimals', () => {
    const { evidence } = filledSplit();
    const result = checkEvidence({ ...evidence, decimals: { ...evidence.decimals, token: { ok: true, value: 6 } } });
    expect(mismatches(result)).toEqual(expect.arrayContaining(['decimals-token']));
  });
});

describe('the clock a receipt is judged at', () => {
  it('is the block time, not the time the receipt states', () => {
    // #given a fill whose block ran on a Saturday while the receipt claims Monday
    const { evidence } = filledSplit();
    const saturday = { ...evidence, block: { ...evidence.block, timestamp: 1_791_070_332n } };
    // #when
    const result = checkEvidence(saturday);
    // #then the timestamp row and the session fail, judged at the block
    expect(mismatches(result)).toEqual(expect.arrayContaining(['field:timestamp', 'session-open']));
    expect(check(result, 'session-open').observed).toBe('closed (WEEKEND)');
  });
});

describe('the disclosure, decoding and duplicates', () => {
  it('compares the disclosure hash with the text a caller serves', () => {
    const { evidence } = filledSplit();
    expect(mismatches(checkEvidence(evidence, { disclosureTextHash: DISCLOSURE.keccak256 }))).toEqual([]);
    const other = checkEvidence(evidence, { disclosureTextHash: disclosureHashOf('a different text') });
    expect(mismatches(other)).toEqual(['disclosure-text']);
    expect(check(other, 'disclosure-text').source).toMatch(/the caller serves/);
  });

  it('fails a log that does not decode as a Receipt', () => {
    const { evidence } = filledSplit();
    const result = checkEvidence({ ...evidence, receiptLog: { ...evidence.receiptLog, data: '0x1234' } });
    expect(result.verdict).toBe('MISMATCH');
    expect(result.checks.map((row) => row.id)).toEqual(['receipt-decodes']);
  });

  it('fails a second ReceiptWritten log with the same id', () => {
    const { evidence } = filledSplit();
    const result = checkEvidence({ ...evidence, duplicateLogs: [evidence.receiptLog] });
    expect(mismatches(result)).toEqual(['receipt-log-once']);
  });

  it('fails the rule rows when no RuleSet log names the version', () => {
    const { evidence } = filledSplit();
    const result = checkEvidence({ ...evidence, rule: 'NOT_FOUND' });
    expect(mismatches(result)).toEqual(expect.arrayContaining(['field:ruleVersion', 'field:tickerId', 'field:usdgToSpend', 'field:minOut', 'premium-cap']));
  });

  it('reports the receipt values exactly, with no rounding', () => {
    const { evidence } = filledSplit();
    const result = checkEvidence(evidence);
    expect(field(result, 'tokensOut').receipt).toBe(TOKENS.toString());
    expect(field(result, 'account').receipt).toBe(ACCOUNT);
  });
});
