import { ADDRESSES, type Address, type Hex, type PriceDecimals, type Receipt } from '@sleeve/core';

import { findLotRun, findReconciled, type LotRun, type ReconciledEvent } from './events';
import type { Evidence, Reading, RoundData, RuleRecord } from './evidence';
import { flagAtReceipt, multiplierAtReceipt, type MultiplierAtReceipt } from './history';
import { hashReceipt, isBuyKind, receiptKind, type DecodedReceiptLog, type ReceiptKind } from './receipt';
import { calendarVersionAt, sessionAtReceipt, type SessionResult } from './session';
import { findBuyFill, findSellRun, type BuyFill, type SellRun } from './trades';

/**
 * What the row builders share: the decoded receipt, its kind, whether the stored hash matches, and every value
 * recomputed once from the evidence.
 */
export interface Context {
  ev: Evidence;
  log: DecodedReceiptLog;
  r: Receipt;
  kind: ReceiptKind;
  recomputedHash: Hex;
  hashMatches: boolean;
  /**
   * When the action ran: the block's timestamp, which the timestamp row checks the receipt against. Every guard
   * condition is judged at it, so a receipt cannot move its own clock.
   */
  t: bigint;
  /** The rule in force for the receipt's caps and shares, a zero rule for a sell without one. */
  rule: RuleRecord | null;
  /** Why the rule could not be found, when the receipt's kind needs one. */
  ruleProblem: string | null;
  /** Decimals for the price arithmetic, read at runtime (build contract: assert, never assume). */
  decimals: Reading<PriceDecimals>;
  calendarVersion: number;
  session: SessionResult | null;
  multiplier: MultiplierAtReceipt | null;
  /** token.paused() at the receipt: the token flag or the registry's global pause. */
  paused: boolean | null;
  oraclePaused: boolean | null;
  buy: BuyFill | null;
  sell: SellRun | null;
  /** A ledger reconcile's Reconciled log. */
  reconciled: ReconciledEvent | null;
  /** A lot reconcile's run and its LotsReconciled log. */
  lotRun: LotRun | null;
  usdg: Address;
}

/** The caps a sell without a rule uses (SPEC 12): no discount allowed and no slippage. */
export const NO_RULE: RuleRecord = {
  version: 0,
  status: 'NONE',
  equityBps: 0,
  tickerId: 0,
  premiumCapBps: 0,
  slippageBps: 0,
  minClip: 0n,
};

function needsRule(kind: ReceiptKind): boolean {
  return kind !== 'RELEASE' && kind !== 'LEDGER_RECONCILE' && kind !== 'LOT_RECONCILE';
}

function resolveRule(ev: Evidence, r: Receipt, kind: ReceiptKind): { rule: RuleRecord | null; problem: string | null } {
  if (!needsRule(kind)) return { rule: null, problem: null };
  if (r.ruleVersion === 0) {
    if (kind === 'SELL') return { rule: NO_RULE, problem: null };
    return { rule: null, problem: 'rule version 0: a split or settle needs an active rule' };
  }
  if (ev.rule === null || ev.rule === 'NOT_FOUND') {
    return { rule: null, problem: `no RuleSet log for rule version ${r.ruleVersion} from block ${ev.fromBlock}` };
  }
  return { rule: ev.rule, problem: null };
}

function priceDecimals(ev: Evidence): Reading<PriceDecimals> {
  const { usdg, token, feed } = ev.decimals;
  if (token === null || feed === null) return { ok: false, error: 'the Stock Token and feed decimals were not read' };
  if (!usdg.ok) return { ok: false, error: `USDG decimals(): ${usdg.error}` };
  if (!token.ok) return { ok: false, error: `token decimals(): ${token.error}` };
  if (!feed.ok) return { ok: false, error: `feed decimals(): ${feed.error}` };
  return { ok: true, value: { usdg: usdg.value, token: token.value, feed: feed.value } };
}

export function buildContext(ev: Evidence, log: DecodedReceiptLog): Context {
  const r = log.receipt;
  const kind = receiptKind(r);
  const recomputedHash = hashReceipt(r);
  const { rule, problem } = resolveRule(ev, r, kind);
  const calendarVersion = calendarVersionAt(ev.calendar);
  const ticker = ev.ticker !== null && ev.ticker.ok ? ev.ticker.value : null;
  const session =
    ticker === null ? null : sessionAtReceipt(ev.block.timestamp, ticker.sessionType, calendarVersion, ev.calendar);
  const history = ev.history;
  const usdg = ADDRESSES.USDG;
  return {
    ev,
    log,
    r,
    kind,
    recomputedHash,
    hashMatches: recomputedHash.toLowerCase() === ev.storedHash.toLowerCase(),
    t: ev.block.timestamp,
    rule,
    ruleProblem: problem,
    decimals: priceDecimals(ev),
    calendarVersion,
    session,
    multiplier: history === null ? null : multiplierAtReceipt(history.multiplier, ev.block.timestamp, ev.latestTimestamp),
    paused: history === null ? null : flagAtReceipt(history.tokenPaused) || flagAtReceipt(history.registryPaused),
    oraclePaused: history === null ? null : flagAtReceipt(history.oraclePaused),
    // The token comes from TokenSource where it was read, so the fill is measured in the ticker's own token rather
    // than in whatever the receipt names; the token row compares the two.
    buy: isBuyKind(kind)
      ? findBuyFill(ev.transaction.logs, ev.receiptLog.logIndex, {
          module: ev.module,
          account: r.account,
          usdg,
          token: ticker?.token ?? r.token,
        })
      : null,
    sell: kind === 'SELL' ? findSellRun(ev.transaction.logs, ev.receiptLog.logIndex, r, { module: ev.module, usdg }) : null,
    reconciled: kind === 'LEDGER_RECONCILE' ? findReconciled(ev.transaction.logs, ev.module, r.id) : null,
    lotRun: kind === 'LOT_RECONCILE' ? findLotRun(ev.transaction.logs, ev.receiptLog.logIndex, r, ev.module) : null,
    usdg,
  };
}

/** The stock round the receipt names, re-read with getRoundData, or why there is none to use. */
export function stockRound(ctx: Context): Reading<RoundData> {
  if (ctx.r.roundId === 0n) return { ok: false, error: 'the receipt names no feed round' };
  if (ctx.ev.stockRound === null) return { ok: false, error: 'getRoundData was not read' };
  return ctx.ev.stockRound;
}

export function usdgRound(ctx: Context): Reading<RoundData> {
  if (ctx.r.usdgRoundId === 0n) return { ok: false, error: 'the receipt names no USDG/USD round' };
  if (ctx.ev.usdgRound === null) return { ok: false, error: 'getRoundData was not read' };
  return ctx.ev.usdgRound;
}
