import type { CardData, CreateCardInput, SleeveDataLayer } from '@/data/types';
import { parseReceiptId } from '@/lib/receipt-id';

import { withLook, type CardFormat, type CardLook } from './card-options';
import { cardFingerprint } from './card-view';

/**
 * Sample data only. The mock data layer keeps one sample world per browser tab, so a card made in a tab is a card
 * the server has never seen. The server can still draw it from data it reads itself: it makes the same card again,
 * as the sample owner, in its own copy of the sample history. The address carries what the card was made from (a
 * receipt id or a week, and the owner's two choices) and the card's fingerprint, never an amount or a word, and the
 * server refuses to draw a card whose fingerprint differs, which happens once the tab's history has moved on.
 * On Robinhood Chain every card lives in the card store and is drawn by its id; this path answers not found.
 */

export interface SampleCardRecipe {
  input: CreateCardInput;
  /** cardFingerprint of the card the tab holds. */
  fingerprint: string;
}

export interface SampleCardRequest {
  input: CreateCardInput;
  /** The fingerprint the drawing must match, or null to draw whatever the sample history holds. */
  fingerprint: string | null;
}

const WEEK_START = /^[1-9]\d{0,11}$/;
const FINGERPRINT = /^[0-9a-f]{8}$/;

/** Receipts read per page, and pages read at most, while looking for the buy a payday card shows. */
const RECEIPT_PAGE = 100;
const RECEIPT_PAGES = 5;

/** The recipe in an address, or null when it names nothing a card can be made from. */
export function readSampleRequest(params: URLSearchParams): SampleCardRequest | null {
  const receipt = params.get('receipt');
  const week = params.get('week');
  const expect = params.get('expect');
  if (expect !== null && !FINGERPRINT.test(expect)) return null;
  const choices = { showAmounts: params.get('showAmounts') === '1', showProof: params.get('showProof') === '1' };
  if (receipt !== null && week === null) {
    const receiptId = parseReceiptId(receipt);
    return receiptId === null ? null : { input: { subject: { kind: 'receipt', receiptId }, ...choices }, fingerprint: expect };
  }
  if (week !== null && receipt === null && WEEK_START.test(week)) {
    return { input: { subject: { kind: 'week', weekStart: BigInt(week) }, ...choices }, fingerprint: expect };
  }
  return null;
}

export function sampleRecipeQuery(recipe: SampleCardRecipe): URLSearchParams {
  const query = new URLSearchParams();
  const { subject, showAmounts, showProof } = recipe.input;
  if (subject.kind === 'receipt') query.set('receipt', subject.receiptId.toString());
  else query.set('week', subject.weekStart.toString());
  if (showAmounts) query.set('showAmounts', '1');
  if (showProof) query.set('showProof', '1');
  query.set('expect', recipe.fingerprint);
  return query;
}

/** /api/card/sample/post?receipt=455&expect=1a2b3c4d&theme=mint&v=2 */
export function sampleImagePath(recipe: SampleCardRecipe, format: CardFormat, look: CardLook, download = false): string {
  return `/api/card/sample/${format}?${withLook(sampleRecipeQuery(recipe), look, download).toString()}`;
}

function recipe(card: CardData, subject: CreateCardInput['subject']): SampleCardRecipe {
  return {
    input: { subject, showAmounts: card.amounts !== null, showProof: card.proof !== null },
    fingerprint: cardFingerprint(card),
  };
}

/**
 * What a card in this tab was made from, read through the data layer. A week card names its week and a card with
 * proof names its receipt; a payday card without proof is matched to the signed-in owner's buy of that ticker at that
 * second. Null when nothing matches, such as a card for a buy the tab made itself.
 */
export async function findSampleRecipe(layer: SleeveDataLayer, card: CardData): Promise<SampleCardRecipe | null> {
  if (card.kind === 'week') return recipe(card, { kind: 'week', weekStart: card.weekStart });
  const proven = card.proof?.receiptIds[0];
  if (proven !== undefined) return recipe(card, { kind: 'receipt', receiptId: proven });

  const session = await layer.getSession();
  if (session === null) return null;
  let cursor: string | undefined;
  for (let page = 0; page < RECEIPT_PAGES; page += 1) {
    const found = await layer.listReceipts({
      account: session.account,
      tickerId: card.tickerId,
      status: card.status,
      cursor,
      limit: RECEIPT_PAGE,
    });
    const match = found.items.find(({ receipt }) => receipt.timestamp === card.timestamp);
    if (match !== undefined) return recipe(card, { kind: 'receipt', receiptId: match.receipt.id });
    if (found.nextCursor === null) return null;
    cursor = found.nextCursor;
  }
  return null;
}
