import {
  DISCLOSURE,
  EXPECTED_DECIMALS,
  RULE_LIMITS,
  discountBps,
  exceedsDiscount,
  premiumBps,
  PriceMathError,
  type Hex,
} from '@sleeve/core';

import { stockRound, usdgRound, type Context } from './context';
import {
  multiplierDueAt,
  openedAtReceipt,
  oraclePausedAt,
  pausedAt,
  premiumExceeded,
  recordedOutcome,
  replayGuard,
  sessionClosedAt,
  tickerRefused,
  usdgBand,
  usdgWithinBand,
  type Judgement,
} from './guard';
import { isBuyKind, isSplitKind } from './receipt';
import { checkRow, compareRow, unreadCheck } from './rows';
import { poolDeltas } from './trades';
import type { CheckRow } from './types';

/**
 * The invariants and guard conditions a receipt must satisfy, re-checked from chain data: I2 conservation, the fill
 * measured from the transaction's logs, I8's premium cap, fresh round and unpaused oracle, the session, the
 * multiplier, the pool allowlist, the lot record and the decimals.
 */

export interface CheckOptions {
  /** keccak256 of the disclosure text the caller serves, compared with the receipt's disclosure hash. */
  disclosureTextHash?: Hex;
}

function receiptHash(ctx: Context): CheckRow {
  return checkRow({
    id: 'receipt-hash',
    label: 'Receipt hash: keccak256(abi.encode(receipt)) equals receiptHash(id)',
    unit: 'hash',
    observed: ctx.recomputedHash,
    expected: ctx.ev.storedHash,
    relation: 'equals',
    ok: ctx.hashMatches,
    source: 'receiptHash(id) on the module',
  });
}

function conservation(ctx: Context): CheckRow | null {
  const { r, kind } = ctx;
  const outflows = r.usdgToSpend + r.usdgSpent + r.usdgQueued;
  if (isSplitKind(kind)) {
    return compareRow({
      id: 'conservation',
      label: 'I2: USDG in equals spend plus spent plus queued',
      unit: 'usdg',
      observed: outflows,
      expected: r.usdgIn,
      relation: 'equals',
      source: 'Receipt fields',
    });
  }
  if (kind === 'SETTLE_FILL' || kind === 'SETTLE_REFUSAL') {
    return compareRow({
      id: 'conservation',
      label: 'The bucket equals spend plus spent plus queued',
      unit: 'usdg',
      observed: outflows,
      expected: r.usdgToEquity,
      relation: 'equals',
      source: 'Receipt fields',
    });
  }
  if (kind === 'LEDGER_RECONCILE') {
    return compareRow({
      id: 'conservation',
      label: 'The shortfall equals the cut from spend plus the cuts from the buckets',
      unit: 'usdg',
      observed: r.usdgSpent + r.usdgQueued,
      expected: r.usdgIn,
      relation: 'equals',
      source: 'Receipt fields',
    });
  }
  return null;
}

function disclosure(ctx: Context, options: CheckOptions): CheckRow {
  const expected = options.disclosureTextHash ?? DISCLOSURE.keccak256;
  return checkRow({
    id: 'disclosure-text',
    label: "The disclosure hash is the issuer's text Sleeve ships",
    unit: 'hash',
    observed: ctx.r.disclosureHash,
    expected,
    relation: 'equals',
    ok: ctx.r.disclosureHash.toLowerCase() === expected.toLowerCase(),
    source:
      options.disclosureTextHash === undefined
        ? `keccak256 of the disclosure retrieved ${DISCLOSURE.retrievedOn}, pinned in packages/core`
        : 'keccak256 of the disclosure text the caller serves',
  });
}

function duplicates(ctx: Context): CheckRow | null {
  if (ctx.ev.duplicateLogs.length === 0) return null;
  return checkRow({
    id: 'receipt-log-once',
    label: 'The module logged this id once',
    unit: 'text',
    observed: ctx.ev.duplicateLogs.length + 1,
    expected: 1,
    relation: 'equals',
    ok: false,
    source: 'ReceiptWritten logs with this id',
  });
}

/** A guard condition as a row: it holds when the condition did not fail. */
function guardRow(id: string, label: string, judgement: Judgement, holdsWhen: string, source: string): CheckRow {
  if (!judgement.known) {
    return unreadCheck({ id, label, unit: 'text', expected: holdsWhen, relation: 'equals', reason: judgement.why, source });
  }
  return checkRow({ id, label, unit: 'text', observed: judgement.detail, expected: holdsWhen, relation: 'equals', ok: !judgement.failed, source });
}

function sessionOpen(ctx: Context): CheckRow {
  const authority = ctx.session !== null && ctx.session.ok ? ctx.session.value.authority : 'port';
  const source =
    authority === 'port'
      ? 'The SessionCalendar port in packages/core at the block time'
      : 'sessionState on the calendar extension, which holds writes the port lacks';
  return guardRow('session-open', 'The market session was open', sessionClosedAt(ctx), 'open', source);
}

/** The deployed calendar's answer beside the port's, when the port answered. */
function calendarAgrees(ctx: Context): CheckRow | null {
  const session = ctx.session;
  const extension = ctx.ev.calendar.session;
  if (session === null || !session.ok || session.value.authority !== 'port' || extension === null) return null;
  const port = session.value;
  const portSays = port.open ? `open since ${port.openedAt ?? 0n}` : `closed (${port.reason})`;
  const label = 'The deployed calendar gives the same session';
  const source = 'sessionState on the calendar extension';
  if (!extension.ok) {
    return unreadCheck({ id: 'calendar-agrees', label, unit: 'text', expected: portSays, relation: 'equals', reason: extension.error, source });
  }
  const onchain = extension.value.open ? `open since ${extension.value.openedAt}` : `closed (${extension.value.reason})`;
  return checkRow({ id: 'calendar-agrees', label, unit: 'text', observed: onchain, expected: portSays, relation: 'equals', ok: port.extensionAgrees === true, source });
}

/** Guard step 6 split into its conditions, so a failing one is named. The sell override keeps only the first two. */
function stockRoundRows(ctx: Context, override: boolean): CheckRow[] {
  const round = stockRound(ctx);
  const t = ctx.t;
  const source = 'getRoundData(roundId), read again at the latest block';
  if (!round.ok) {
    return [unreadCheck({ id: 'round-fresh', label: 'The feed round was fresh', unit: 'text', expected: 'fresh', relation: 'equals', reason: round.error, source })];
  }
  const { answer, startedAt, updatedAt } = round.value;
  const rows = [
    compareRow({ id: 'round-answer', label: 'The feed answer was above zero', unit: 'feed', observed: answer, expected: 0n, relation: 'above', source }),
    compareRow({ id: 'round-not-future', label: 'The round was not from after the receipt', unit: 'timestamp', observed: updatedAt, expected: t, relation: 'at most', source }),
  ];
  if (override) return rows;
  if (updatedAt <= t) {
    rows.push(
      compareRow({
        id: 'round-age',
        label: 'The round was at most the maximum age old (seconds)',
        unit: 'text',
        observed: t - updatedAt,
        expected: ctx.ev.guardParams.stockFeedMaxAge,
        relation: 'at most',
        source: `${source}; the maximum from guardParams() on the module`,
      }),
    );
  }
  const openedAt = openedAtReceipt(ctx);
  if (openedAt !== null) {
    rows.push(
      compareRow({
        id: 'round-after-open',
        label: 'The round was observed and sent after the session opened',
        unit: 'timestamp',
        observed: startedAt < updatedAt ? startedAt : updatedAt,
        expected: openedAt,
        relation: 'at least',
        source: `${source}: startedAt and updatedAt against the session's opening`,
      }),
    );
  }
  return rows;
}

/** Guard step 7, the USDG/USD round: within the band and fresh. */
function usdgRoundRows(ctx: Context): CheckRow[] {
  const round = usdgRound(ctx);
  const decimals = ctx.ev.decimals.usdgFeed;
  const source = 'getRoundData(usdgRoundId) on the USDG/USD feed';
  const label = 'USDG was within its peg band';
  if (!round.ok) return [unreadCheck({ id: 'usdg-peg', label, unit: 'text', expected: 'within', relation: 'equals', reason: round.error, source })];
  if (!decimals.ok) return [unreadCheck({ id: 'usdg-peg', label, unit: 'text', expected: 'within', relation: 'equals', reason: decimals.error, source })];
  const { answer, updatedAt } = round.value;
  const t = ctx.t;
  const { depegToleranceBps, usdgFeedMaxAge } = ctx.ev.guardParams;
  const band = usdgBand(decimals.value, depegToleranceBps);
  return [
    checkRow({
      id: 'usdg-peg',
      label: `USDG was within ${depegToleranceBps} bps of 1`,
      unit: 'feed',
      observed: answer,
      expected: `${band.low} to ${band.high}`,
      relation: 'within',
      ok: usdgWithinBand(answer, decimals.value, depegToleranceBps),
      source,
    }),
    checkRow({
      id: 'usdg-round-age',
      label: 'The USDG/USD round was at most the maximum age old (seconds)',
      unit: 'text',
      observed: updatedAt > t ? 'from after the receipt' : t - updatedAt,
      expected: usdgFeedMaxAge,
      relation: 'at most',
      ok: updatedAt <= t && t - updatedAt <= usdgFeedMaxAge,
      source: `${source}; the maximum from guardParams() on the module`,
    }),
  ];
}

function tokenStateRows(ctx: Context): CheckRow[] {
  const source = 'Pause and multiplier logs since the receipt, and the state now';
  return [
    guardRow('token-not-paused', 'The Stock Token was not paused', pausedAt(ctx), 'not paused', source),
    guardRow('oracle-not-paused', "The token's oracle was not paused", oraclePausedAt(ctx), 'oracle not paused', source),
    guardRow('no-multiplier-due', 'No multiplier change was due inside the guard window', multiplierDueAt(ctx), 'no change due inside the window', source),
  ];
}

function tickerActive(ctx: Context): CheckRow {
  return guardRow('ticker-active', 'The ticker was active with a feed', tickerRefused(ctx), 'active with a feed', 'TokenSource.ticker and its TickerRemoved logs');
}

function poolAllowlisted(ctx: Context): CheckRow {
  const pool = ctx.ev.pool;
  const label = "The pool was on the ticker's allowlist";
  const source = 'TokenSource.isPoolAllowed and its PoolSet logs since the receipt';
  if (pool === null) {
    return unreadCheck({ id: 'pool-allowlisted', label, unit: 'text', expected: 'allowlisted', relation: 'equals', reason: 'not read', source });
  }
  if (pool.firstChangeAfter === null && !pool.allowedNow.ok) {
    return unreadCheck({ id: 'pool-allowlisted', label, unit: 'text', expected: 'allowlisted', relation: 'equals', reason: pool.allowedNow.error, source });
  }
  const allowed = pool.firstChangeAfter === null ? pool.allowedNow.ok && pool.allowedNow.value : !pool.firstChangeAfter;
  return checkRow({
    id: 'pool-allowlisted',
    label,
    unit: 'text',
    observed: allowed ? 'allowlisted' : 'not allowlisted',
    expected: 'allowlisted',
    relation: 'equals',
    ok: allowed,
    source,
  });
}

/** Build contract: read decimals() at runtime and assert them. */
function decimalsRows(ctx: Context): CheckRow[] {
  const { usdg, token, feed, usdgFeed } = ctx.ev.decimals;
  const source = 'decimals() at the latest block';
  const entries = [
    ['decimals-usdg', 'USDG decimals()', usdg, EXPECTED_DECIMALS.USDG],
    ['decimals-token', 'Stock Token decimals()', token, EXPECTED_DECIMALS.STOCK_TOKEN],
    ['decimals-feed', 'Feed decimals()', feed, EXPECTED_DECIMALS.FEED],
    ['decimals-usdg-feed', 'USDG/USD feed decimals()', usdgFeed, EXPECTED_DECIMALS.FEED],
  ] as const;
  return entries.flatMap(([id, label, reading, expected]) => {
    if (reading === null) return [];
    if (!reading.ok) return [unreadCheck({ id, label, unit: 'text', expected, relation: 'equals', reason: reading.error, source })];
    return [compareRow({ id, label, unit: 'text', observed: BigInt(reading.value), expected: BigInt(expected), relation: 'equals', source })];
  });
}

function lotRows(ctx: Context): CheckRow[] {
  const lot = ctx.ev.lot;
  const source = 'lot(lotId) on the module';
  const ownerLabel = "The lot is the account's, for this ticker";
  if (lot === null) return [];
  if (!lot.ok) {
    return [unreadCheck({ id: 'lot-owner', label: ownerLabel, unit: 'text', expected: 'this account and ticker', relation: 'equals', reason: lot.error, source })];
  }
  const { r } = ctx;
  const rows = [
    checkRow({
      id: 'lot-owner',
      label: ownerLabel,
      unit: 'text',
      observed: `${lot.value.account} ticker ${lot.value.tickerId}`,
      expected: `${r.account} ticker ${r.tickerId}`,
      relation: 'equals',
      ok: lot.value.account.toLowerCase() === r.account.toLowerCase() && lot.value.tickerId === r.tickerId,
      source,
    }),
  ];
  if (isBuyKind(ctx.kind) && ctx.buy !== null) {
    rows.push(
      compareRow({
        id: 'lot-bought',
        label: 'The lot holds the tokens the buy received',
        unit: 'token',
        observed: lot.value.tokensBought,
        expected: ctx.buy.tokensOut,
        relation: 'equals',
        source: `${source}, against the Transfer logs`,
      }),
    );
  }
  if (ctx.kind === 'SELL') {
    const allowed: readonly string[] = r.status === 'SOLD' ? ['SOLD'] : ['PART_SOLD', 'SOLD'];
    rows.push(
      checkRow({
        id: 'lot-status',
        label: 'The lot moved on as the sell recorded (I7)',
        unit: 'text',
        observed: lot.value.status,
        expected: allowed.join(' or '),
        relation: 'equals',
        ok: allowed.includes(lot.value.status),
        source: `${source}: SOLD is final`,
      }),
    );
  }
  return rows;
}

/** The pool's own record of the swap, against the Transfer logs. Positive is what the pool received. */
function poolRows(ctx: Context, usdgIntoPool: bigint, tokensIntoPool: bigint): CheckRow[] {
  const swap = ctx.kind === 'SELL' ? ctx.sell?.swap : ctx.buy?.swap;
  const token0 = ctx.ev.pool?.token0;
  const source = 'The Swap log of the pool, against the Transfer logs';
  if (swap === undefined) return [];
  if (token0 === undefined || !token0.ok) {
    const reason = token0 === undefined ? 'token0() not read' : token0.error;
    return [unreadCheck({ id: 'pool-usdg', label: "The pool's USDG change", unit: 'usdg', expected: usdgIntoPool, relation: 'equals', reason, source })];
  }
  const deltas = poolDeltas(swap, token0.value, ctx.usdg);
  return [
    compareRow({ id: 'pool-usdg', label: "The pool's USDG change", unit: 'usdg', observed: deltas.usdg, expected: usdgIntoPool, relation: 'equals', source }),
    compareRow({ id: 'pool-tokens', label: "The pool's Stock Token change", unit: 'token', observed: deltas.token, expected: tokensIntoPool, relation: 'equals', source }),
  ];
}

function priceMath(run: () => bigint): { ok: true; value: bigint } | { ok: false; error: string } {
  try {
    return { ok: true, value: run() };
  } catch (error) {
    if (error instanceof PriceMathError) return { ok: false, error: `${error.code}: ${error.message}` };
    throw error;
  }
}

function premiumCapRow(ctx: Context, capBps: number): CheckRow {
  const label = 'I8: the premium was within the rule cap';
  const source = "exceedsPremium on the Transfer logs, the re-read answer and the rule's cap";
  const fill = ctx.buy;
  const round = stockRound(ctx);
  if (fill === null) return unreadCheck({ id: 'premium-cap', label, unit: 'bps', expected: capBps, relation: 'at most', reason: 'no swap', source });
  const exceeded = premiumExceeded(ctx, fill.usdgSpent, fill.tokensOut, capBps);
  if (!exceeded.known || !round.ok || !ctx.decimals.ok) {
    const reason = !exceeded.known ? exceeded.why : 'not judged';
    return unreadCheck({ id: 'premium-cap', label, unit: 'bps', expected: capBps, relation: 'at most', reason, source });
  }
  const decimals = ctx.decimals.value;
  const answer = round.value.answer;
  const premium = priceMath(() => premiumBps(fill.usdgSpent, fill.tokensOut, answer, decimals));
  return checkRow({
    id: 'premium-cap',
    label,
    unit: 'bps',
    observed: premium.ok ? premium.value : premium.error,
    expected: capBps,
    relation: 'at most',
    ok: !exceeded.failed,
    source,
  });
}

function buyRows(ctx: Context): CheckRow[] {
  const { r } = ctx;
  const fill = ctx.buy;
  const rows: CheckRow[] = [];
  if (fill === null) {
    rows.push(
      unreadCheck({ id: 'swap', label: 'A Swap log paid the account before the receipt', unit: 'text', expected: 'one', relation: 'equals', reason: 'none', source: 'The transaction logs' }),
    );
  } else {
    rows.push(
      ...poolRows(ctx, fill.usdgSpent, -fill.tokensOut),
      compareRow({ id: 'whole-amount', label: 'The buy spent the whole equity amount', unit: 'usdg', observed: fill.usdgSpent, expected: r.usdgToEquity, relation: 'equals', source: 'USDG Transfer logs' }),
      compareRow({ id: 'min-out', label: "The tokens received met the trigger's minimum", unit: 'token', observed: fill.tokensOut, expected: r.minOut, relation: 'at least', source: 'Stock Token Transfer logs' }),
    );
  }
  const rule = ctx.rule;
  if (rule === null) {
    rows.push(
      unreadCheck({ id: 'premium-cap', label: 'I8: the premium was within the rule cap', unit: 'bps', expected: 'the cap', relation: 'at most', reason: ctx.ruleProblem ?? 'no rule', source: 'RuleSet logs' }),
    );
  } else {
    rows.push(
      premiumCapRow(ctx, rule.premiumCapBps),
      compareRow({ id: 'min-clip', label: 'The amount met the minimum clip', unit: 'usdg', observed: r.usdgToEquity, expected: rule.minClip, relation: 'at least', source: "The rule's minimum clip" }),
    );
  }
  const calendar = calendarAgrees(ctx);
  rows.push(
    tickerActive(ctx),
    poolAllowlisted(ctx),
    sessionOpen(ctx),
    ...(calendar === null ? [] : [calendar]),
    ...stockRoundRows(ctx, false),
    ...usdgRoundRows(ctx),
    ...tokenStateRows(ctx),
    ...lotRows(ctx),
    ...decimalsRows(ctx),
  );
  return rows;
}

/** The discount cap a sell passed: overrideCapBps when set, else the rule's premium cap (SPEC 12, D-027). */
function discountRows(ctx: Context): CheckRow[] {
  const { r } = ctx;
  const rule = ctx.rule;
  const label = 'The discount was within the cap';
  if (rule === null) {
    return [unreadCheck({ id: 'discount-cap', label, unit: 'bps', expected: 'the cap', relation: 'at most', reason: ctx.ruleProblem ?? 'no rule', source: 'RuleSet logs' })];
  }
  const rows: CheckRow[] = [];
  const cap = r.overrideCapBps !== 0 ? r.overrideCapBps : rule.premiumCapBps;
  if (r.overrideCapBps !== 0) {
    rows.push(
      checkRow({
        id: 'override-cap',
        label: "The override cap sat between the rule's cap and the most a sell may ask for",
        unit: 'bps',
        observed: r.overrideCapBps,
        expected: `${rule.premiumCapBps} to ${RULE_LIMITS.sellOverrideCapBpsMax}`,
        relation: 'within',
        ok: r.overrideCapBps >= rule.premiumCapBps && r.overrideCapBps <= RULE_LIMITS.sellOverrideCapBpsMax,
        source: 'B2-14, and the rule for the cap it may not go below',
      }),
    );
  }
  const run = ctx.sell;
  const round = stockRound(ctx);
  const source = "exceedsDiscount on the run's Transfer logs and the re-read answer";
  if (run === null) return [...rows, unreadCheck({ id: 'discount-cap', label, unit: 'bps', expected: cap, relation: 'at most', reason: 'no sell run', source })];
  if (!round.ok) return [...rows, unreadCheck({ id: 'discount-cap', label, unit: 'bps', expected: cap, relation: 'at most', reason: round.error, source })];
  if (!ctx.decimals.ok) return [...rows, unreadCheck({ id: 'discount-cap', label, unit: 'bps', expected: cap, relation: 'at most', reason: ctx.decimals.error, source })];
  const decimals = ctx.decimals.value;
  const answer = round.value.answer;
  const exceeded = priceMath(() => (exceedsDiscount(run.usdgTransferred, run.tokensTransferred, answer, cap, decimals) ? 1n : 0n));
  const discount = priceMath(() => discountBps(run.usdgTransferred, run.tokensTransferred, answer, decimals));
  if (!exceeded.ok) return [...rows, unreadCheck({ id: 'discount-cap', label, unit: 'bps', expected: cap, relation: 'at most', reason: exceeded.error, source })];
  rows.push(
    checkRow({
      id: 'discount-cap',
      label,
      unit: 'bps',
      observed: discount.ok ? discount.value : discount.error,
      expected: cap,
      relation: 'at most',
      ok: exceeded.value === 0n,
      source,
    }),
  );
  return rows;
}

function sellRows(ctx: Context): CheckRow[] {
  const { r } = ctx;
  const run = ctx.sell;
  const rows: CheckRow[] = [];
  const runSource = 'SPEC 13: the receipts after one Swap log of the pool';
  const runLabel = "The receipt is in its sell's run";
  if (run === null) {
    rows.push(
      unreadCheck({ id: 'sell-run', label: runLabel, unit: 'text', expected: `contains ${r.id}`, relation: 'equals', reason: 'no Swap log of the pool before the receipt', source: runSource }),
    );
  } else {
    const ids = run.entries.map((entry) => entry.receipt.id.toString()).join(', ');
    rows.push(
      checkRow({ id: 'sell-run', label: runLabel, unit: 'text', observed: ids === '' ? 'no receipts' : `receipts ${ids}`, expected: `contains ${r.id}`, relation: 'equals', ok: run.containsTarget, source: runSource }),
      compareRow({ id: 'run-tokens', label: "The run's Stock Tokens in equal the tokens that left the account", unit: 'token', observed: run.tokensIn, expected: run.tokensTransferred, relation: 'equals', source: 'Stock Token Transfer logs to the pool' }),
      compareRow({ id: 'run-usdg', label: "The run's USDG out equals the USDG that arrived", unit: 'usdg', observed: run.usdgOut, expected: run.usdgTransferred, relation: 'equals', source: 'USDG Transfer logs from the pool' }),
      ...poolRows(ctx, -run.usdgTransferred, run.tokensTransferred),
      compareRow({ id: 'min-out', label: "The USDG received met the trigger's minimum", unit: 'usdg', observed: run.usdgTransferred, expected: r.minOut, relation: 'at least', source: 'USDG Transfer logs' }),
    );
  }
  rows.push(...discountRows(ctx), poolAllowlisted(ctx));
  if (r.overrideClosed) {
    rows.push(...stockRoundRows(ctx, true));
  } else {
    const calendar = calendarAgrees(ctx);
    rows.push(sessionOpen(ctx), ...(calendar === null ? [] : [calendar]), ...stockRoundRows(ctx, false));
  }
  rows.push(...usdgRoundRows(ctx), ...tokenStateRows(ctx), ...lotRows(ctx), ...decimalsRows(ctx));
  return rows;
}

/** A split or settle that did not buy: the outcome the guard gives on chain data. */
function outcomeRows(ctx: Context): CheckRow[] {
  const replay = replayGuard(ctx);
  const label = 'The guard on chain data gives the recorded outcome';
  const source = 'The guard steps of PRD 7.4 re-run on chain data';
  const recorded = recordedOutcome(ctx.r);
  if (replay.kind === 'blocklist') return [];
  if (replay.kind === 'stopped') {
    return [unreadCheck({ id: 'guard-outcome', label, unit: 'text', expected: recorded, relation: 'equals', reason: `not judged: ${replay.why}`, source })];
  }
  return [checkRow({ id: 'guard-outcome', label, unit: 'text', observed: replay.outcome, expected: recorded, relation: 'equals', ok: replay.outcome === recorded, source: `${source}: ${replay.basis}` })];
}

function queueRows(ctx: Context): CheckRow[] {
  const { r } = ctx;
  const rows = outcomeRows(ctx);
  if (ctx.kind !== 'SPLIT_QUEUE') return rows;
  if (r.reason === 'PREMIUM') {
    rows.push(poolAllowlisted(ctx));
    if (ctx.rule !== null) {
      rows.push(
        compareRow({ id: 'premium-over-cap', label: "The undone swap's premium was above the cap", unit: 'bps', observed: r.premiumBps, expected: BigInt(ctx.rule.premiumCapBps), relation: 'above', source: "The rule's cap" }),
      );
    }
  }
  if (r.usdgToEquity > 0n) {
    const calendar = calendarAgrees(ctx);
    if (calendar !== null) rows.push(calendar);
  }
  return rows;
}

function releaseRows(ctx: Context): CheckRow[] {
  const { r } = ctx;
  return [
    compareRow({ id: 'released-amount', label: 'The release moved a bucket that held USDG', unit: 'usdg', observed: r.usdgToSpend, expected: 0n, relation: 'above', source: 'release reverts EmptyBucket on an empty bucket' }),
    compareRow({ id: 'queued-before', label: 'The bucket started waiting before the release', unit: 'timestamp', observed: r.queuedSince, expected: ctx.t, relation: 'at most', source: 'Receipt field against the block time' }),
  ];
}

function lotReconcileRows(ctx: Context): CheckRow[] {
  const run = ctx.lotRun;
  const source = 'The LotsReconciled log after the run of RECONCILED receipts';
  const label = 'The trims add up to the LotsReconciled total';
  if (run === null) {
    return [unreadCheck({ id: 'lots-reconciled', label, unit: 'token', expected: 'the total', relation: 'equals', reason: 'no LotsReconciled log after the receipt', source })];
  }
  const ids = run.receipts.map((receipt) => receipt.id.toString()).join(', ');
  return [
    checkRow({ id: 'lot-run', label: 'The receipt is in the run before the LotsReconciled log', unit: 'text', observed: ids === '' ? 'no receipts' : `receipts ${ids}`, expected: `contains ${ctx.r.id}`, relation: 'equals', ok: run.containsTarget, source }),
    compareRow({ id: 'lots-reconciled', label, unit: 'token', observed: run.tokensIn, expected: run.trimmed, relation: 'equals', source }),
    ...lotRows(ctx),
  ];
}

export function checkRows(ctx: Context, options: CheckOptions): CheckRow[] {
  const rows: CheckRow[] = [receiptHash(ctx)];
  const duplicate = duplicates(ctx);
  if (duplicate !== null) rows.push(duplicate);
  const balance = conservation(ctx);
  if (balance !== null) rows.push(balance);
  switch (ctx.kind) {
    case 'SPLIT_FILL':
    case 'SETTLE_FILL':
      rows.push(...buyRows(ctx));
      break;
    case 'SELL':
      rows.push(...sellRows(ctx));
      break;
    case 'SPLIT_QUEUE':
    case 'SPLIT_REFUSAL':
    case 'SETTLE_REFUSAL':
      rows.push(...queueRows(ctx));
      break;
    case 'RELEASE':
      rows.push(...releaseRows(ctx));
      break;
    case 'LEDGER_RECONCILE':
      if (ctx.reconciled === null) {
        rows.push(
          unreadCheck({ id: 'reconciled-log', label: 'A Reconciled log names the receipt', unit: 'text', expected: 'one', relation: 'equals', reason: 'none in the transaction', source: 'Reconciled logs' }),
        );
      }
      break;
    case 'LOT_RECONCILE':
      rows.push(...lotReconcileRows(ctx));
      break;
  }
  rows.push(disclosure(ctx, options));
  return rows;
}
