import {
  ACCOUNTING_MODES,
  DISCLOSURE,
  EXPECTED_DECIMALS,
  REASONS,
  RECEIPT_FIELDS,
  STATUSES,
  TRIGGERS,
  formatBps,
  formatUnits,
  isPoolAllowlisted,
  type Reason,
  type Receipt,
  type Rule,
  type Trigger,
} from '@sleeve/core';

import { premiumSentence, type PremiumSide } from '@/components/sleeve/premium-line';
import { tickerSymbol, triggerLabel, usdgExact, usdgText, waitCause } from '@/components/sleeve/text';
import type { AmountKind } from '@/components/ui/amount';
import { REASON_LABEL } from '@/components/ui/badge';
import type { InboundRef, ReceiptRecord } from '@/data/types';

/**
 * Every field of a receipt, grouped and worded for a person (PRD 10, docs/DESIGN.md 12.4). Values keep every digit
 * the receipt holds. Fields read from logs rather than stored in the receipt carry `derived`. The page renders
 * these sections as definition lists; nothing here touches React, so the wording is tested on its own.
 */

export type FieldValue =
  | { kind: 'text'; text: string }
  /** A number and its unit, colored by what it is (spend, equity, waiting), never by direction. */
  | { kind: 'amount'; value: string; unit: string; tone: AmountKind; debtLine?: boolean }
  /** An address, hash, id or raw integer: mono, wrapping anywhere, with a copy button when labelled. */
  | { kind: 'machine'; value: string; copyLabel?: string }
  | { kind: 'time'; seconds: bigint }
  | { kind: 'link'; text: string; href: string }
  | { kind: 'transfers'; transfers: readonly InboundRef[] };

export interface ReceiptField {
  id: string;
  term: string;
  value: FieldValue;
  /** One plain line under the value. */
  note?: string;
  /** Read from logs, not stored in the receipt (PRD 10). */
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

const tokenExact = (value: bigint): string =>
  formatUnits(value, EXPECTED_DECIMALS.STOCK_TOKEN, { minFractionDigits: 2 });
const feedExact = (value: bigint): string => formatUnits(value, EXPECTED_DECIMALS.FEED, { minFractionDigits: 2 });
const multiplierExact = (value: bigint): string => formatUnits(value, 18, { minFractionDigits: 1 });

const text = (value: string): FieldValue => ({ kind: 'text', text: value });
const machine = (value: string, copyLabel?: string): FieldValue => ({ kind: 'machine', value, copyLabel });
const time = (seconds: bigint): FieldValue => ({ kind: 'time', seconds });
/** A zero is no money of any kind, so it keeps plain ink instead of the green or amber of its kind. */
const usdg = (value: bigint, tone: AmountKind = 'plain'): FieldValue => ({
  kind: 'amount',
  value: usdgExact(value),
  unit: 'USDG',
  tone: value === 0n ? 'plain' : tone,
});

export function isZeroHex(value: string): boolean {
  return /^0x0*$/i.test(value);
}

const BUY_STATUSES = new Set<Receipt['status']>(['FILLED', 'SETTLED']);
const SELL_STATUSES = new Set<Receipt['status']>(['PART_SOLD', 'SOLD']);

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

export function venueWords(venueId: number): string {
  if (venueId === 0) return 'None. No swap ran.';
  if (venueId === 1) return 'Uniswap v3 through SwapRouter02';
  return `Venue ${venueId}`;
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

function splitSection(record: ReceiptRecord): ReceiptSection {
  const r = record.receipt;
  const symbol = tickerSymbol(r.tickerId);
  const usdgInNote =
    r.status === 'SETTLED' || r.status === 'RELEASED'
      ? `USDG that waited in the account to buy ${symbol}.`
      : 'Unsorted USDG this split sorted.';
  const toSpendNote =
    r.status === 'REFUSED_TICKER' || r.status === 'REFUSED_ACCOUNT'
      ? 'All of it, because the equity share could not buy and went to spend.'
      : r.status === 'RELEASED'
        ? 'The waiting USDG, moved to spend by the owner.'
        : undefined;
  const fields: ReceiptField[] = [
    { id: 'usdgIn', term: 'USDG in', value: usdg(r.usdgIn), note: usdgInNote },
    { id: 'usdgToSpend', term: 'To spend', value: usdg(r.usdgToSpend, 'spend'), note: toSpendNote },
    { id: 'usdgToEquity', term: 'To equity', value: usdg(r.usdgToEquity) },
    { id: 'usdgSpent', term: `Spent on ${symbol}`, value: usdg(r.usdgSpent, 'equity') },
    {
      id: 'usdgQueued',
      term: 'Queued',
      value: usdg(r.usdgQueued, 'waiting'),
      note: r.status === 'QUEUED' ? `Waits as USDG in the account because ${waitCause(r.reason)}.` : undefined,
    },
  ];
  if (r.queuedSince > 0n) fields.push({ id: 'queuedSince', term: 'Waiting since', value: time(r.queuedSince) });
  return { id: 'split', title: 'Where the USDG went', fields };
}

function saleSection(receipt: Receipt): ReceiptSection {
  const symbol = tickerSymbol(receipt.tickerId);
  return {
    id: 'sale',
    title: 'The sale',
    intro: 'One sell writes a receipt for each lot it draws from, oldest lot first.',
    fields: [
      {
        id: 'tokensIn',
        term: 'Tokens sold',
        value: { kind: 'amount', value: tokenExact(receipt.tokensIn), unit: symbol, tone: 'plain', debtLine: true },
      },
      { id: 'usdgOut', term: 'USDG received', value: usdg(receipt.usdgOut, 'spend') },
      { id: 'usdgToSpend', term: 'Moved to spend', value: usdg(receipt.usdgToSpend, 'spend') },
      {
        id: 'lotId',
        term: 'From lot',
        value: { kind: 'link', text: `Lot ${receipt.lotId}`, href: `/receipts/${receipt.lotId}` },
        note: receipt.status === 'SOLD' ? 'Nothing is left in this lot.' : 'The rest of this lot is still held.',
      },
    ],
  };
}

function correctionSection(record: ReceiptRecord): ReceiptSection {
  const intro = 'The ledgers come down in a fixed order: spend first, then USDG waiting to buy, lowest ticker first.';
  const reconciliation = record.reconciliation;
  if (reconciliation === null) {
    return {
      id: 'correction',
      title: 'The correction',
      intro,
      fields: [{ id: 'cuts', term: 'Ledger cuts', value: text('Not found in the logs read for this receipt'), derived: true }],
    };
  }
  return {
    id: 'correction',
    title: 'The correction',
    intro,
    fields: [
      { id: 'shortfall', term: 'Shortfall', value: usdg(reconciliation.shortfall), derived: true },
      { id: 'fromSpend', term: 'Taken from spend', value: usdg(reconciliation.fromSpend, 'spend'), derived: true },
      ...reconciliation.fromBuckets.map((bucket) => ({
        id: `fromBucket-${bucket.tickerId}`,
        term: `Taken from waiting ${tickerSymbol(bucket.tickerId)}`,
        value: usdg(bucket.amount, 'waiting'),
        derived: true,
      })),
    ],
  };
}

function premiumField(side: PremiumSide, receipt: Receipt): ReceiptField {
  return {
    id: 'premiumBps',
    term: side === 'buy' ? 'Premium' : 'Against the market reference',
    value: text(premiumWords(receipt.premiumBps)),
    note: `${premiumSentence(side, receipt.premiumBps)} The receipt stores ${receipt.premiumBps}, rounded against the owner.`,
  };
}

function multiplierField(receipt: Receipt): ReceiptField {
  return {
    id: 'uiMultiplier',
    term: 'Multiplier at fill',
    value: machine(multiplierExact(receipt.uiMultiplier)),
    note: `The issuer's uiMultiplier for ${tickerSymbol(receipt.tickerId)} at the fill. The Chainlink price already includes it.`,
  };
}

function buyFillSection(receipt: Receipt): ReceiptSection {
  const symbol = tickerSymbol(receipt.tickerId);
  return {
    id: 'fill',
    title: 'The fill',
    fields: [
      {
        id: 'tokensOut',
        term: 'Tokens received',
        value: { kind: 'amount', value: tokenExact(receipt.tokensOut), unit: symbol, tone: 'equity', debtLine: true },
        note: 'Measured from the account balance before and after the swap.',
      },
      {
        id: 'execPrice',
        term: 'All-in price',
        value: { kind: 'amount', value: usdgExact(receipt.execPrice), unit: `USDG per ${symbol}`, tone: 'plain' },
        note: 'The pool price as paid: what left and entered the account, so every pool fee is in it.',
      },
      premiumField('buy', receipt),
      {
        id: 'quote',
        term: 'Quote from the trigger',
        value: { kind: 'amount', value: tokenExact(receipt.quote), unit: `${symbol} per USDG`, tone: 'plain' },
      },
      {
        id: 'minOut',
        term: 'Least accepted',
        value: { kind: 'amount', value: tokenExact(receipt.minOut), unit: symbol, tone: 'plain' },
        note: 'The swap reverts if fewer tokens arrive.',
      },
      multiplierField(receipt),
    ],
  };
}

function sellFillSection(receipt: Receipt): ReceiptSection {
  const symbol = tickerSymbol(receipt.tickerId);
  return {
    id: 'fill',
    title: 'The fill',
    fields: [
      {
        id: 'execPrice',
        term: 'All-in price',
        value: { kind: 'amount', value: usdgExact(receipt.execPrice), unit: `USDG per ${symbol}`, tone: 'plain' },
        note: 'The pool price as received: what left and entered the account, so every pool fee is in it.',
      },
      premiumField('sell', receipt),
      {
        id: 'quote',
        term: 'Quote from the trigger',
        value: { kind: 'amount', value: usdgExact(receipt.quote), unit: `USDG per ${symbol}`, tone: 'plain' },
      },
      { id: 'minOut', term: 'Least accepted', value: usdg(receipt.minOut), note: 'The swap reverts if less USDG arrives.' },
      multiplierField(receipt),
      {
        id: 'overrideClosed',
        term: 'Off-hours override',
        value: text(receipt.overrideClosed ? 'Used' : 'Not used'),
        note: receipt.overrideClosed
          ? 'This sell skipped the market session and price age checks once, after the owner saw the gap risk.'
          : undefined,
      },
      {
        id: 'overrideCapBps',
        term: 'Discount cap',
        value: text(receipt.overrideCapBps === 0 ? "The rule's cap" : `${formatBps(receipt.overrideCapBps)} below the market reference`),
        note: receipt.overrideCapBps === 0 ? undefined : 'Widened for this sell only.',
      },
    ],
  };
}

function referenceSection(receipt: Receipt): ReceiptSection | null {
  if (receipt.roundId === 0n) return null;
  const symbol = tickerSymbol(receipt.tickerId);
  const fields: ReceiptField[] = [
    { id: 'roundId', term: 'Chainlink round', value: machine(receipt.roundId.toString()), note: roundWords(receipt.roundId) },
    {
      id: 'answer',
      term: 'Answer',
      value: { kind: 'amount', value: feedExact(receipt.answer), unit: `USD per ${symbol}`, tone: 'plain' },
    },
    { id: 'updatedAt', term: 'Published', value: time(receipt.updatedAt) },
  ];
  if (receipt.usdgRoundId !== 0n) {
    fields.push(
      { id: 'usdgRoundId', term: 'USDG/USD round', value: machine(receipt.usdgRoundId.toString()), note: roundWords(receipt.usdgRoundId) },
      {
        id: 'usdgAnswer',
        term: 'USDG/USD answer',
        value: { kind: 'amount', value: feedExact(receipt.usdgAnswer), unit: 'USD per USDG', tone: 'plain' },
      },
    );
  }
  return {
    id: 'reference',
    title: 'Market reference',
    intro: `The Chainlink price the guard read for ${symbol}. It stays apart from the pool price, and Sleeve never merges the two.`,
    fields,
  };
}

function venueSection(receipt: Receipt): ReceiptSection | null {
  if (isZeroHex(receipt.pool) && receipt.venueId === 0) return null;
  const symbol = tickerSymbol(receipt.tickerId);
  const fields: ReceiptField[] = [{ id: 'venueId', term: 'Venue', value: text(venueWords(receipt.venueId)) }];
  if (!isZeroHex(receipt.pool)) {
    fields.push({
      id: 'pool',
      term: 'Pool',
      value: machine(receipt.pool, 'Copy pool address'),
      note: isPoolAllowlisted(receipt.tickerId, receipt.pool)
        ? `On the ${symbol} pool allowlist.`
        : `Not on the ${symbol} pool allowlist.`,
    });
  }
  return { id: 'venue', title: 'Pool and venue', fields };
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
  fields.push(
    { id: 'mode', term: 'Accounting mode', value: text(r.mode), note: WRAPPED_LINE },
    { id: 'calendarVersion', term: 'Session calendar', value: machine(String(r.calendarVersion)), note: calendarWords(r.calendarVersion) },
  );
  return { id: 'context', title: 'How it ran', fields };
}

function recordSection(record: ReceiptRecord): ReceiptSection {
  const r = record.receipt;
  const symbol = tickerSymbol(r.tickerId);
  const fields: ReceiptField[] = [
    { id: 'id', term: 'Receipt id', value: machine(r.id.toString()) },
    { id: 'account', term: 'Account', value: machine(r.account, 'Copy account address') },
  ];
  if (!isZeroHex(r.token)) fields.push({ id: 'token', term: `${symbol} token`, value: machine(r.token, 'Copy token address') });
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
      value: machine(r.l2Block.toString()),
      note: 'From ArbSys: the Robinhood Chain block, not the L1 estimate.',
    },
    { id: 'timestamp', term: 'Block time', value: time(r.timestamp) },
    {
      id: 'receiptHash',
      term: 'Receipt hash',
      value: machine(record.receiptHash, 'Copy receipt hash'),
      note: 'keccak256 of the encoded receipt, stored by the module when the receipt was written.',
    },
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
  return { id: 'record', title: 'Onchain record', fields };
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
        value: machine(record.derived.txHash, 'Copy transaction hash'),
        derived: true,
      },
      { id: 'inbound', term: 'Payments it sorted', value: { kind: 'transfers', transfers: record.derived.inbound }, derived: true },
    ],
  };
}

/** The receipt's sections in reading order: money first, then price, then how it ran and the record itself. */
export function receiptSections(record: ReceiptRecord): ReceiptSection[] {
  const r = record.receipt;
  const sections: (ReceiptSection | null)[] = [];
  if (SELL_STATUSES.has(r.status)) sections.push(saleSection(r), sellFillSection(r));
  else if (r.status === 'RECONCILED') sections.push(correctionSection(record));
  else sections.push(splitSection(record), BUY_STATUSES.has(r.status) ? buyFillSection(r) : null);
  sections.push(referenceSection(r), venueSection(r), contextSection(record), recordSection(record), logsSection(record));
  return sections.filter((section): section is ReceiptSection => section !== null);
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
