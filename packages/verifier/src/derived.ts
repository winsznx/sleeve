import { ADDRESSES, erc20Abi, type Hex } from '@sleeve/core';
import { decodeEventLog } from 'viem';

import { stockRound, type Context } from './context';
import type { LogPosition, RawLog } from './evidence';
import { comparePositions } from './history';
import { decodeReceiptLog, isSplitKind, receiptKind } from './receipt';
import { derivedRow } from './rows';
import type { DerivedRow } from './types';

/**
 * Facts read from logs that the receipt does not carry, each labeled derived (PRD 10): the transaction, what the
 * guard saw at the receipt, what changed in the token's multiplier since, a sell's run, and the inbound transfers a
 * split sorted.
 */

function positionOf(log: RawLog): LogPosition {
  return { blockNumber: log.blockNumber, logIndex: log.logIndex };
}

function transactionRows(ctx: Context): DerivedRow[] {
  const { ev } = ctx;
  return [
    derivedRow({ id: 'transaction', label: 'Transaction', unit: 'hash', value: ev.transaction.hash, source: 'The ReceiptWritten log' }),
    derivedRow({ id: 'log-index', label: 'Log index in the block', unit: 'text', value: ev.receiptLog.logIndex, source: 'The ReceiptWritten log' }),
    derivedRow({ id: 'sender', label: 'Transaction sent by', unit: 'address', value: ev.transaction.from, source: 'The transaction' }),
  ];
}

function marketRows(ctx: Context): DerivedRow[] {
  const rows: DerivedRow[] = [];
  const session = ctx.session;
  if (session !== null && session.ok) {
    const { open, reason, openedAt, authority } = session.value;
    const from = authority === 'port' ? 'The SessionCalendar port at the block time' : 'sessionState on the calendar extension';
    rows.push(derivedRow({ id: 'session', label: 'Market session at the receipt', unit: 'text', value: open ? 'open' : `closed (${reason})`, source: from }));
    if (openedAt !== null) {
      rows.push(derivedRow({ id: 'session-opened-at', label: 'The session opened at', unit: 'timestamp', value: openedAt, source: from }));
    }
  }
  const round = stockRound(ctx);
  if (round.ok) {
    rows.push(derivedRow({ id: 'round-started-at', label: 'Feed round observed at (startedAt)', unit: 'timestamp', value: round.value.startedAt, source: 'getRoundData(roundId)' }));
  }
  return rows;
}

function multiplierRows(ctx: Context): DerivedRow[] {
  const history = ctx.ev.history;
  if (history === null) return [];
  const rows = [
    derivedRow({ id: 'multiplier-now', label: 'Multiplier now', unit: 'multiplier', value: history.multiplier.uiMultiplier, source: 'uiMultiplier() at the latest block' }),
    derivedRow({
      id: 'multiplier-changes',
      label: 'Multiplier updates since the receipt',
      unit: 'text',
      value: history.multiplier.after.length,
      source: 'UIMultiplierUpdated logs of the Stock Token',
    }),
  ];
  history.multiplier.after.forEach((update, index) => {
    rows.push(
      derivedRow({
        id: `multiplier-change-${index + 1}`,
        label: `Multiplier update ${index + 1}`,
        unit: 'text',
        value: `${update.oldMultiplier} to ${update.newMultiplier} from ${update.effectiveAt}, block ${update.position.blockNumber}`,
        source: `UIMultiplierUpdated in ${update.transactionHash}`,
      }),
    );
  });
  return rows;
}

function sellRunRows(ctx: Context): DerivedRow[] {
  const run = ctx.sell;
  if (run === null) return [];
  return [
    derivedRow({ id: 'sell-run-receipts', label: "Receipts in this sell's run", unit: 'text', value: run.entries.map((entry) => entry.receipt.id.toString()).join(', '), source: 'SPEC 13 grouping' }),
    derivedRow({ id: 'sell-tokens', label: 'Stock Tokens the sell took from the account', unit: 'token', value: run.tokensTransferred, source: 'Transfer logs to the pool' }),
    derivedRow({ id: 'sell-usdg', label: 'USDG the sell paid the account', unit: 'usdg', value: run.usdgTransferred, source: 'Transfer logs from the pool' }),
  ];
}

function ruleRows(ctx: Context): DerivedRow[] {
  const rule = ctx.rule;
  if (rule === null) return [];
  const value =
    rule.version === 0
      ? 'no rule: caps of 0 bps'
      : `${rule.equityBps} bps to ticker ${rule.tickerId}, premium cap ${rule.premiumCapBps} bps, slippage ${rule.slippageBps} bps, clip ${rule.minClip}`;
  return [derivedRow({ id: 'rule', label: 'Rule used', unit: 'text', value, source: rule.version === 0 ? 'SPEC 12' : 'RuleSet log' })];
}

/**
 * The USDG transfers into the account that the split sorted: those after the account's install or previous sort and
 * before this receipt, leaving out transactions with the account's own bracketed owner op or a sell, whose USDG lands
 * in spend (PRD 7.2). Derived from logs; the receipt's usdgIn is the module's own measure.
 */
function inboundRows(ctx: Context): DerivedRow[] {
  const account = ctx.ev.account;
  if (account === null || !isSplitKind(ctx.kind)) return [];
  const here = positionOf(ctx.ev.receiptLog);
  const before = (log: RawLog): boolean => comparePositions(positionOf(log), here) < 0;
  let start: LogPosition | null = null;
  for (const log of account.installs) {
    if (before(log) && (start === null || comparePositions(positionOf(log), start) > 0)) start = positionOf(log);
  }
  const excluded = new Set<Hex>(account.ownerOps.map((log) => log.transactionHash));
  for (const log of account.receipts) {
    if (!before(log)) continue;
    const decoded = decodeReceiptLog(log);
    if (!decoded.ok) continue;
    const receipt = decoded.value.receipt;
    if (receipt.status === 'PART_SOLD' || receipt.status === 'SOLD') excluded.add(log.transactionHash);
    const sorted = isSplitKind(receiptKind(receipt));
    if (sorted && (start === null || comparePositions(positionOf(log), start) > 0)) start = positionOf(log);
  }
  const transfers = account.inbound.filter(
    (log) =>
      log.address.toLowerCase() === ADDRESSES.USDG.toLowerCase() &&
      before(log) &&
      (start === null || comparePositions(positionOf(log), start) > 0) &&
      !excluded.has(log.transactionHash),
  );
  const rows: DerivedRow[] = [];
  let total = 0n;
  transfers.forEach((log, index) => {
    const [signature, from, to] = log.topics;
    if (signature === undefined || from === undefined || to === undefined) return;
    const { args } = decodeEventLog({ abi: erc20Abi, eventName: 'Transfer', topics: [signature, from, to], data: log.data });
    total += args.value;
    rows.push(
      derivedRow({
        id: `inbound-${index + 1}`,
        label: `Inbound USDG from ${args.from}`,
        unit: 'usdg',
        value: args.value,
        source: `Transfer log in ${log.transactionHash}, block ${log.blockNumber}`,
      }),
    );
  });
  const since = start === null ? `block ${account.fromBlock}` : `block ${start.blockNumber}`;
  rows.push(
    derivedRow({
      id: 'inbound-total',
      label: 'Inbound USDG since the previous sort',
      unit: 'usdg',
      value: total,
      source: `USDG Transfer logs into the account after ${since}, without the account's own owner ops and sells`,
    }),
  );
  return rows;
}

/** Notes on what the verifier did not re-read, so a reader knows what a MATCH covers. */
function noteRows(ctx: Context): DerivedRow[] {
  if (ctx.r.status !== 'REFUSED_ACCOUNT') return [];
  return [
    derivedRow({
      id: 'blocklist-note',
      label: 'Blocklist at the receipt',
      unit: 'text',
      value: 'not re-read: REFUSED_ACCOUNT stands on the receipt hash',
      source: 'The access registry keeps no history the verifier reads',
    }),
  ];
}

export function derivedRows(ctx: Context): DerivedRow[] {
  return [
    ...transactionRows(ctx),
    ...marketRows(ctx),
    ...multiplierRows(ctx),
    ...sellRunRows(ctx),
    ...ruleRows(ctx),
    ...inboundRows(ctx),
    ...noteRows(ctx),
  ];
}
