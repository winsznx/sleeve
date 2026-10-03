import { CHAIN_ID, CHAIN_NAME, TOTAL_BPS, formatBps, shortAddress, type TickerId } from '@sleeve/core';

import { tickerSymbol, tokenText, usdgText } from '@/components/sleeve/text';
import {
  isTokenKey,
  tokenShape,
  tokenVisual,
  type LogoKey,
  type TokenArt,
  type TokenKey,
  type TokenShape,
} from '@/components/token/registry';
import { formatUtcDate } from '@/components/ui/format-time';
import type { CardData, ReceiptCard, WeekCard } from '@/data/types';
import { BRAND_NAME, DEBT_SECURITY_LINE, DISCLAIMER, SAMPLE_DATA_LINE } from '@/lib/copy';

/**
 * What a shared card says (PRD 7.10, D-024), worked out once so the preview, the PNG, the OpenGraph image and the
 * text version never disagree. A payday card says what one payday became: the share of pay, the Stock Token it
 * became, the split, and the debt security line. A week card says how many paydays the rule split and which Stock
 * Tokens they bought. Amounts appear only when the owner showed them, and the receipt numbers and the account only
 * with proof, the one part that leads anyone to the account onchain. The date is a day, never a time: a ticker and
 * an exact second would be enough to find the buy.
 */

export type CardKind = 'payday' | 'week';

export interface CardToken {
  key: TokenKey;
  symbol: string;
  /** Stock Tokens sit in a rounded-square tile, USDG in a disc (docs/design/icon-system.md 4.2). */
  shape: TokenShape;
  /** "mark" artwork sits inset on a white plate, as TokenIcon draws it. */
  art: TokenArt;
  /** The logo file's key, or null for a token the manifest withholds, which draws the neutral Stock Token glyph. */
  logo: LogoKey | null;
}

export interface CardLegendItem {
  kind: 'spend' | 'equity';
  share: string;
  label: string;
}

export interface CardRail {
  spendBps: number;
  equityBps: number;
  /** The equity share waited as USDG before it bought, drawn as stripes leading into the bought segment. */
  waited: boolean;
}

/** USDG and token amounts as printed, number then unit. */
export interface PaydayAmounts {
  /** FILLED only: a SETTLED receipt records the buy, not the payment. */
  arrived: string | null;
  /** FILLED only, for the same reason. */
  spendable: string | null;
  /** The USDG the equity share spent. */
  spent: string;
  /** The Stock Tokens it bought. */
  bought: string;
}

export interface WeekAmounts {
  arrived: string;
  bought: string;
}

export interface CardProofView {
  /** "Receipt 455", or "Receipts 455, 503 and 611". */
  receipts: string;
  receiptIds: readonly bigint[];
  /** "0x3efE…9b36". */
  account: string;
  /** "Robinhood Chain, chain id 4663". */
  network: string;
  /** Where anyone can recompute the card, printed without the scheme. Null before the page knows its address. */
  verifyLabel: string | null;
  /** The same address in full, for the QR code. */
  verifyUrl: string | null;
}

interface CardViewBase {
  cardId: string;
  brand: string;
  /** "22 Sep 2026" or "Week of 21 Sep 2026". */
  dateLine: string;
  /** The large figure: the share of pay, or the payday count. */
  figure: string;
  /** The words that finish the figure's sentence. */
  lead: string;
  debtLine: string | null;
  /** The guard's promise, true of every buy and so safe to show without amounts. */
  stamp: string | null;
  rail: CardRail;
  legend: readonly CardLegendItem[];
  proof: CardProofView | null;
  /** "sleeve.example/card/r8KQm2xV4nPz". Null before the page knows its address. */
  link: string | null;
  /** SAMPLE_DATA_LINE while the mock data layer runs. */
  sampleLine: string | null;
  /** Printed whenever the card names Robinhood Chain, which proof does. */
  disclaimer: string | null;
}

export interface PaydayCardView extends CardViewBase {
  kind: 'payday';
  status: ReceiptCard['status'];
  token: CardToken;
  amounts: PaydayAmounts | null;
}

export interface WeekCardView extends CardViewBase {
  kind: 'week';
  paydays: number;
  /** Stock Tokens bought in the week, ascending ticker id. */
  tokens: readonly CardToken[];
  /** "Bought this week" or "Nothing bought this week". */
  boughtLine: string;
  legendTitle: string;
  amounts: WeekAmounts | null;
}

export type CardView = PaydayCardView | WeekCardView;

export interface CardViewOptions {
  /** Print the amounts the card holds. False hides them even when the owner showed them; true never adds any. */
  amounts: boolean;
  /** Print the proof the card holds, under the same rule. */
  proof: boolean;
  /** "https://sleeve.example", or null before the page knows where it is. */
  origin: string | null;
  /** The mock data layer is selected, so the card says it is sample data. */
  sample: boolean;
}

/** Receipt numbers a week card spells out before it says how many more there are. */
const LISTED_RECEIPTS = 5;

/** "SPY", "SPY and QQQ", "SPY, QQQ and NVDA". */
export function joinWords(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

function receiptList(ids: readonly bigint[]): string {
  if (ids.length === 1) return `Receipt ${ids[0]}`;
  const listed = ids.slice(0, LISTED_RECEIPTS).map(String);
  const rest = ids.length - listed.length;
  return rest > 0 ? `Receipts ${listed.join(', ')} and ${rest} more` : `Receipts ${joinWords(listed)}`;
}

function hostOf(origin: string): string {
  return new URL(origin).host;
}

/** USDG as the cards draw it: the payment token, a disc with its own logo. */
export const USDG_CARD_TOKEN: CardToken = { key: 'USDG', symbol: 'USDG', shape: 'disc', art: 'disc', logo: 'USDG' };

/** The token a launch ticker is drawn with. Throws for an id the icon manifest does not know, as TokenIcon does. */
export function cardToken(tickerId: TickerId): CardToken {
  const symbol = tickerSymbol(tickerId);
  if (!isTokenKey(symbol)) throw new Error(`No icon entry for ticker ${tickerId}`);
  const visual = tokenVisual(symbol);
  const logo = visual !== null && visual.kind === 'logo' ? visual : null;
  return {
    key: symbol,
    symbol,
    shape: tokenShape(symbol),
    art: logo?.art ?? 'disc',
    logo: logo === null ? null : symbol,
  };
}

function clampBps(bps: number): number {
  return Math.min(Math.max(Math.round(bps), 0), TOTAL_BPS);
}

function proofView(card: CardData, options: CardViewOptions): CardProofView | null {
  if (!options.proof || card.proof === null) return null;
  const ids = card.proof.receiptIds;
  const single = ids.length === 1 ? ids[0] : undefined;
  const path = single === undefined ? '/verify' : `/verify/${single}`;
  return {
    receipts: receiptList(ids),
    receiptIds: ids,
    account: shortAddress(card.proof.account),
    network: `${CHAIN_NAME}, chain id ${CHAIN_ID}`,
    verifyLabel: options.origin === null ? null : `${hostOf(options.origin)}${path}`,
    verifyUrl: options.origin === null ? null : `${options.origin}${path}`,
  };
}

function base(card: CardData, options: CardViewOptions) {
  const proof = proofView(card, options);
  return {
    cardId: card.cardId,
    brand: BRAND_NAME,
    proof,
    link: options.origin === null || card.cardId === '' ? null : `${hostOf(options.origin)}/card/${card.cardId}`,
    sampleLine: options.sample ? SAMPLE_DATA_LINE : null,
    disclaimer: proof === null ? null : DISCLAIMER,
  };
}

function paydayView(card: ReceiptCard, options: CardViewOptions): PaydayCardView {
  const equityBps = clampBps(card.equityBps);
  const spendBps = TOTAL_BPS - equityBps;
  const token = cardToken(card.tickerId);
  const settled = card.status === 'SETTLED';
  const amounts = options.amounts ? card.amounts : null;
  return {
    ...base(card, options),
    kind: 'payday',
    status: card.status,
    token,
    dateLine: formatUtcDate(card.timestamp),
    figure: formatBps(equityBps),
    lead: settled ? 'of this payday waited, then became' : 'of this payday became',
    debtLine: DEBT_SECURITY_LINE,
    stamp: 'Checked against the market reference before buying',
    rail: { spendBps, equityBps, waited: settled },
    legend: [
      { kind: 'spend', share: formatBps(spendBps), label: 'stayed spendable' },
      { kind: 'equity', share: formatBps(equityBps), label: settled ? `waited, then became ${token.symbol}` : `became ${token.symbol}` },
    ],
    amounts:
      amounts === null
        ? null
        : {
            arrived: settled ? null : usdgText(amounts.usdgIn),
            spendable: settled ? null : usdgText(amounts.usdgIn - amounts.usdgSpent),
            spent: usdgText(amounts.usdgSpent),
            bought: tokenText(amounts.tokensOut, token.symbol),
          },
  };
}

function weekView(card: WeekCard, options: CardViewOptions): WeekCardView {
  const equityBps = clampBps(card.equityBps);
  const spendBps = TOTAL_BPS - equityBps;
  const tokens = card.tickerIds.map(cardToken);
  const bought = tokens.length > 0;
  const amounts = options.amounts ? card.amounts : null;
  return {
    ...base(card, options),
    kind: 'week',
    paydays: card.paydays,
    tokens,
    dateLine: `Week of ${formatUtcDate(card.weekStart)}`,
    figure: String(card.paydays),
    lead: card.paydays === 1 ? 'payday split this week' : 'paydays split this week',
    boughtLine: bought ? 'Bought this week' : 'Nothing bought this week',
    debtLine: bought ? DEBT_SECURITY_LINE : null,
    stamp: bought ? 'Every buy was checked against the market reference' : null,
    rail: { spendBps, equityBps, waited: false },
    legendTitle: 'How the rule splits each payday',
    legend: [
      { kind: 'spend', share: formatBps(spendBps), label: 'stays spendable' },
      { kind: 'equity', share: formatBps(equityBps), label: 'goes to Stock Tokens' },
    ],
    amounts: amounts === null ? null : { arrived: usdgText(amounts.usdgIn), bought: usdgText(amounts.usdgBought) },
  };
}

export function cardView(card: CardData, options: CardViewOptions): CardView {
  return card.kind === 'receipt' ? paydayView(card, options) : weekView(card, options);
}

/** Whether the card holds amounts or proof at all, so a control to leave them off is worth showing. */
export function cardHolds(card: CardData): { amounts: boolean; proof: boolean } {
  return { amounts: card.amounts !== null, proof: card.proof !== null };
}

/** One line for a link preview's description: what the card says, never more than the image shows. */
export function cardSummary(view: CardView): string {
  const statement =
    view.kind === 'payday'
      ? `${view.figure} ${view.lead} ${view.token.symbol}, ${DEBT_SECURITY_LINE}.`
      : view.tokens.length === 0
        ? `${view.figure} ${view.lead}. ${view.boughtLine}.`
        : `${view.figure} ${view.lead}. Bought ${joinWords(view.tokens.map((token) => token.symbol))}, ${DEBT_SECURITY_LINE}.`;
  return view.sampleLine === null ? statement : `${statement} ${view.sampleLine}`;
}

/** Everything the image says, in reading order, as one text alternative. */
export function cardAltText(view: CardView): string {
  const sentence = (text: string): string => (/[.!?]$/.test(text) ? text : `${text}.`);
  const kindName = view.kind === 'payday' ? 'payday card' : 'week card';
  const lines: string[] = [`${view.brand} ${kindName}, ${view.dateLine}`];
  if (view.kind === 'payday') {
    lines.push(`${view.figure} ${view.lead} ${view.token.symbol}`);
  } else {
    lines.push(`${view.figure} ${view.lead}`);
    lines.push(view.tokens.length === 0 ? view.boughtLine : `${view.boughtLine}: ${joinWords(view.tokens.map((token) => token.symbol))}`);
  }
  if (view.debtLine !== null) lines.push(view.debtLine);
  const legend = view.legend.map((item) => `${item.share} ${item.label}`).join(', ');
  lines.push(view.kind === 'week' ? `${view.legendTitle}: ${legend}` : legend);
  if (view.stamp !== null) lines.push(view.stamp);
  if (view.kind === 'payday' && view.amounts !== null) {
    const { arrived, spendable, spent, bought } = view.amounts;
    if (arrived !== null) lines.push(`${arrived} arrived`);
    if (spendable !== null) lines.push(`${spendable} stayed spendable`);
    lines.push(`${spent} became ${bought}`);
  }
  if (view.kind === 'week' && view.amounts !== null) {
    lines.push(`${view.amounts.arrived} arrived this week`, `${view.amounts.bought} bought Stock Tokens`);
  }
  if (view.proof !== null) {
    lines.push(view.proof.receipts, `Account ${view.proof.account}`, view.proof.network);
  }
  if (view.sampleLine !== null) lines.push(view.sampleLine);
  return lines.map(sentence).join(' ');
}

/** sleeve-payday-card-r8KQm2xV4nPz-post.png, the name a downloaded image is saved under. */
export function cardFileName(kind: CardKind, cardId: string, format: string): string {
  const id = cardId.replace(/[^A-Za-z0-9_-]/g, '');
  return `sleeve-${kind}-card-${id === '' ? 'sample' : id}-${format}.png`;
}

export interface CardFact {
  id: string;
  term: string;
  value: string;
}

/** The card in words, for the page beside the image: what it says, then what the owner left off. */
export function cardFacts(view: CardView, holds: { amounts: boolean; proof: boolean }): CardFact[] {
  const facts: CardFact[] = [{ id: 'date', term: view.kind === 'payday' ? 'Day' : 'Week', value: view.dateLine }];
  if (view.kind === 'payday') {
    facts.push({ id: 'became', term: 'What it became', value: `${view.figure} ${view.lead} ${view.token.symbol}, ${DEBT_SECURITY_LINE}` });
  } else {
    facts.push({ id: 'paydays', term: 'Paydays', value: `${view.figure} ${view.lead}` });
    facts.push({
      id: 'bought',
      term: 'Stock Tokens',
      value:
        view.tokens.length === 0
          ? view.boughtLine
          : `${view.boughtLine}: ${joinWords(view.tokens.map((token) => token.symbol))}, ${DEBT_SECURITY_LINE}`,
    });
  }
  facts.push({
    id: 'split',
    term: view.kind === 'payday' ? 'The split' : 'The rule',
    value: view.legend.map((item) => `${item.share} ${item.label}`).join(', '),
  });
  if (view.stamp !== null) facts.push({ id: 'guard', term: 'The price', value: view.stamp });
  if (view.kind === 'payday' && view.amounts !== null) {
    const { arrived, spendable, spent, bought } = view.amounts;
    const parts = [
      arrived === null ? null : `${arrived} arrived`,
      spendable === null ? null : `${spendable} stayed spendable`,
      `${spent} became ${bought}`,
    ];
    facts.push({ id: 'amounts', term: 'Amounts', value: parts.filter((part) => part !== null).join('. ') });
  } else if (view.kind === 'week' && view.amounts !== null) {
    facts.push({
      id: 'amounts',
      term: 'Amounts',
      value: `${view.amounts.arrived} arrived this week. ${view.amounts.bought} bought Stock Tokens`,
    });
  } else {
    facts.push({ id: 'amounts', term: 'Amounts', value: holds.amounts ? 'Left off this image' : 'Hidden by the owner' });
  }
  if (view.proof !== null) {
    facts.push({ id: 'proof', term: 'Proof', value: `${view.proof.receipts}, account ${view.proof.account}, ${view.proof.network}` });
  } else {
    facts.push({
      id: 'proof',
      term: 'Proof',
      value: holds.proof ? 'Left off this image' : 'Hidden by the owner. Nothing on this card leads to the account onchain',
    });
  }
  return facts;
}

/** Sorted keys and bigints written out, so two copies of one card always print the same text. */
function canonical(value: unknown): unknown {
  if (typeof value === 'bigint') return `${value}n`;
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

/** FNV-1a over the text, 32 bits: a cheap equality check, not a security measure. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * What a card says, as a short fingerprint that leaves out the opaque id. Two cards with the same fingerprint draw
 * the same picture, which is how the sample image route proves it is drawing the card a browser tab holds.
 */
export function cardFingerprint(card: CardData): string {
  const content: Record<string, unknown> = { ...card };
  delete content.cardId;
  return fnv1a(JSON.stringify(canonical(content)));
}
