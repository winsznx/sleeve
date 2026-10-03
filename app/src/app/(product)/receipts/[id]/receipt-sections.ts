import {
  ACCOUNTING_MODES,
  DISCLOSURE,
  REASONS,
  RECEIPT_FIELDS,
  STATUSES,
  TRIGGERS,
  formatBps,
  type Reason,
  type Receipt,
  type Rule,
  type Trigger,
} from '@sleeve/core';

import { tickerSymbol, triggerLabel, usdgText } from '@/components/sleeve/text';
import { REASON_LABEL } from '@/components/ui/badge';
import type { InboundRef, ReceiptRecord } from '@/data/types';

/**
 * The proof section's fact lists, worded for a person (PRD 10, docs/DESIGN.md 12.4): how the action ran, the
 * receipt it wrote onchain and what the chain logs add. The money, the price, the route and the session have their
 * own panels (receipt-panels.ts). Values keep every digit the receipt holds. Fields read from logs or from the rule's
 * history carry `derived`. Nothing here touches React, so the wording is tested on its own.
 */

export type FieldValue =
  | { kind: 'text'; text: string }
  /**
   * An address, hash, id or raw integer: mono, wrapping anywhere, with a copy button when labelled. `explorer` is
   * the block explorer path for it, shown only when the data comes from the chain.
   */
  | { kind: 'machine'; value: string; copyLabel?: string; explorer?: string }
  | { kind: 'time'; seconds: bigint }
  | { kind: 'transfers'; transfers: readonly InboundRef[] };

export interface ReceiptField {
  id: string;
  term: string;
  value: FieldValue;
  /** One plain line under the value. */
  note?: string;
  /** Read from logs or the rule's history, not stored in the receipt (PRD 10). */
  derived?: boolean;
}

export interface ReceiptSection {
  id: string;
  title: string;
  intro?: string;
  fields: ReceiptField[];
}

/** The line every receipt's accounting mode carries (PRD 7.2, build contract copy rules). */
export const WRAPPED_LINE = 'Sorting is exact for actions taken through Sleeve, not for actions signed outside it.';

const text = (value: string): FieldValue => ({ kind: 'text', text: value });
const machine = (value: string, copyLabel?: string, explorer?: string): FieldValue => ({ kind: 'machine', value, copyLabel, explorer });
const time = (seconds: bigint): FieldValue => ({ kind: 'time', seconds });

export function isZeroHex(value: string): boolean {
  return /^0x0*$/i.test(value);
}

const BUY_STATUSES = new Set<Receipt['status']>(['FILLED', 'SETTLED']);

/** Chainlink proxy round ids carry the phase in the bits above 64. */
export function roundWords(roundId: bigint): string {
  const phase = roundId >> 64n;
  const round = roundId & ((1n << 64n) - 1n);
  return `Phase ${phase}, round ${round} of that phase.`;
}

/** SessionCalendarExtension.version(): the library version in the high 16 bits, timelocked writes in the low 16. */
export function calendarWords(version: number): string {
  const library = version >>> 16;
  const writes = version & 0xffff;
  return `Calendar ${library}, with ${writes} timelocked ${writes === 1 ? 'change' : 'changes'}.`;
}

/** "4 basis points above the market reference": the receipt's signed premium, in words. */
export function premiumWords(premiumBps: bigint): string {
  if (premiumBps === 0n) return 'At the market reference';
  const magnitude = premiumBps < 0n ? -premiumBps : premiumBps;
  const unit = magnitude === 1n ? 'basis point' : 'basis points';
  return `${magnitude} ${unit} ${premiumBps > 0n ? 'above' : 'below'} the market reference`;
}

export function ruleWords(rule: Rule): string {
  return `${formatBps(rule.equityBps)} to ${tickerSymbol(rule.tickerId)}, premium cap ${formatBps(rule.premiumCapBps)}, slippage cap ${formatBps(rule.slippageBps)}, minimum buy ${usdgText(rule.minClip)}`;
}

function triggerNote(trigger: Trigger): string | undefined {
  switch (trigger) {
    case 'KEEPER':
      return 'The keeper can do only what anyone may do once the one hour grace period ends.';
    case 'OWNER':
      return 'Signed by the account owner.';
    case 'PUBLIC':
      return 'Anyone may start a split once unsorted USDG has waited past the one hour grace period.';
    case 'PAYLINK':
      return undefined;
  }
}

/** Where the guard stopped when it never reached the price feed (PRD 7.4 steps 1 to 5). */
function stopBeforeFeed(receipt: Receipt): string | null {
  if (receipt.roundId !== 0n) return null;
  if (receipt.status === 'REFUSED_TICKER') return 'the ticker and pool check';
  if (receipt.status === 'REFUSED_ACCOUNT') return 'the account check';
  if (receipt.status !== 'QUEUED') return null;
  const stops: Partial<Record<Reason, string>> = {
    PAUSED: 'the token pause check',
    ORACLE_PAUSED: 'the price update check',
    SESSION: 'the market session check',
    MULTIPLIER: 'the multiplier check',
  };
  return stops[receipt.reason] ?? null;
}

function contextSection(record: ReceiptRecord): ReceiptSection {
  const r = record.receipt;
  const symbol = tickerSymbol(r.tickerId);
  const fields: ReceiptField[] = [
    { id: 'tickerId', term: 'Ticker', value: text(`${symbol}, ticker ${r.tickerId}`) },
    { id: 'trigger', term: 'Started by', value: text(triggerLabel(r.trigger)), note: triggerNote(r.trigger) },
  ];
  if (r.reason !== 'NONE') {
    fields.push({
      id: 'reason',
      term: 'Reason',
      value: text(REASON_LABEL[r.reason]),
      note: r.status === 'QUEUED' ? 'Why the equity share waits.' : 'Why this USDG waited before.',
    });
  }
  const stop = stopBeforeFeed(r);
  if (stop !== null) {
    fields.push({
      id: 'feed',
      term: 'Price feed',
      value: text('Not read'),
      note: `The guard stopped at ${stop}, before it reads the price, so the price fields hold zero.`,
    });
  }
  fields.push({ id: 'ruleVersion', term: 'Rule version', value: text(String(r.ruleVersion)) });
  const rule = record.derived.rule;
  if (rule !== null) fields.push({ id: 'rule', term: 'Rule settings', value: text(ruleWords(rule)), derived: true });
  fields.push({ id: 'mode', term: 'Accounting mode', value: text(r.mode), note: WRAPPED_LINE });
  return { id: 'context', title: 'How it ran', fields };
}

function recordSection(record: ReceiptRecord): ReceiptSection {
  const r = record.receipt;
  const symbol = tickerSymbol(r.tickerId);
  const fields: ReceiptField[] = [
    { id: 'id', term: 'Receipt id', value: machine(r.id.toString(), 'Copy receipt id') },
    {
      id: 'receiptHash',
      term: 'Receipt hash',
      value: machine(record.receiptHash, 'Copy receipt hash'),
      note: 'keccak256 of the encoded receipt, stored by the module when the receipt was written.',
    },
    { id: 'account', term: 'Account', value: machine(r.account, 'Copy account address', `/address/${r.account}`) },
  ];
  if (!isZeroHex(r.token)) {
    fields.push({ id: 'token', term: `${symbol} token`, value: machine(r.token, 'Copy token address', `/token/${r.token}`) });
  }
  if (!isZeroHex(r.tokenUid)) fields.push({ id: 'tokenUid', term: 'Token uid', value: machine(r.tokenUid) });
  fields.push({
    id: 'payer',
    term: 'Payer',
    value: machine(r.payer),
    note: isZeroHex(r.payer) ? 'No payer is recorded on this kind of receipt.' : undefined,
  });
  if (BUY_STATUSES.has(r.status) && r.lotId !== 0n) {
    fields.push({
      id: 'lotId',
      term: 'Lot',
      value: text(`Lot ${r.lotId}`),
      note: 'This buy opened the lot. Sells draw from lots oldest first.',
    });
  }
  fields.push(
    {
      id: 'l2Block',
      term: 'L2 block',
      value: machine(r.l2Block.toString(), undefined, `/block/${r.l2Block.toString()}`),
      note: 'From ArbSys: the Robinhood Chain block, not the L1 estimate.',
    },
    { id: 'timestamp', term: 'Block time', value: time(r.timestamp) },
    {
      id: 'disclosureHash',
      term: 'Disclosure hash',
      value: machine(r.disclosureHash, 'Copy disclosure hash'),
      note:
        r.disclosureHash.toLowerCase() === DISCLOSURE.keccak256
          ? 'Matches the issuer disclosure below.'
          : 'Differs from the issuer disclosure below, which is the text Sleeve ships now. This receipt was written under an earlier text.',
    },
  );
  return { id: 'record', title: 'The receipt', fields };
}

function logsSection(record: ReceiptRecord): ReceiptSection {
  return {
    id: 'logs',
    title: 'From chain logs',
    intro: 'Read from the transaction and its logs. The receipt itself does not store these.',
    fields: [
      {
        id: 'txHash',
        term: 'Transaction hash',
        value: machine(record.derived.txHash, 'Copy transaction hash', `/tx/${record.derived.txHash}`),
        derived: true,
      },
      { id: 'inbound', term: 'Payments it sorted', value: { kind: 'transfers', transfers: record.derived.inbound }, derived: true },
    ],
  };
}

/** The proof section's fact lists in reading order: the receipt itself, how it ran, then what the logs add. */
export function receiptSections(record: ReceiptRecord): ReceiptSection[] {
  return [recordSection(record), contextSection(record), logsSection(record)];
}

export interface RawField {
  name: keyof Receipt;
  /** The Solidity type in the receipt struct; enums encode as uint8. */
  type: string;
  value: string;
}

const ENUM_MEMBERS: Partial<Record<keyof Receipt, readonly string[]>> = {
  trigger: TRIGGERS,
  status: STATUSES,
  reason: REASONS,
  mode: ACCOUNTING_MODES,
};

/** The receipt exactly as stored, in SPEC 13 order: what anyone abi-encodes to check the receipt hash. */
export function rawReceiptFields(receipt: Receipt): RawField[] {
  return (Object.keys(RECEIPT_FIELDS) as (keyof typeof RECEIPT_FIELDS)[]).map((name) => {
    const value = receipt[name];
    const members = ENUM_MEMBERS[name];
    const shown = members === undefined ? String(value) : `${String(value)} (${members.indexOf(String(value))})`;
    return { name, type: RECEIPT_FIELDS[name], value: shown };
  });
}
