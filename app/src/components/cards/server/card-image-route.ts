import { DATA_SOURCE } from '@/data/source';
import type { CardData } from '@/data/types';

import { isCardFormat, isCardId, readCardLook, type CardFormat } from '../card-options';
import { cardFileName, cardFingerprint, cardView } from '../card-view';
import { readSampleRequest } from '../sample-card';
import { readSampleCard, readSharedCard, type CardRead } from './card-source';
import { renderCardImage } from './render';

/**
 * Server only. The two card image routes: /api/card/{cardId}/{format} for a card the data layer holds, and
 * /api/card/sample/{format} for a sample card a browser tab made. Both read the look from the address, answer HEAD
 * without drawing, and name the file a download is saved under.
 */

const YEAR_SECONDS = 31_536_000;

function textResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export function noCardImage(): Response {
  return textResponse(404, 'There is no card at this address.');
}

/** The answer for a read that did not find a card to draw. */
function failedRead(read: Exclude<CardRead, { status: 'found' }>): Response {
  return read.status === 'missing' ? noCardImage() : textResponse(503, read.message);
}

/**
 * A card never changes once made, except a week card for a week still running. Sample cards are rebuilt from the
 * sample history on every deploy, so they keep a short life.
 */
export function cardCacheControl(card: CardData, nowSeconds: bigint): string {
  if (DATA_SOURCE === 'mock') return 'public, max-age=300';
  const running = card.kind === 'week' && card.weekEnd > nowSeconds;
  return running ? 'public, max-age=300' : `public, max-age=${YEAR_SECONDS}, immutable`;
}

/** Draws a card as the address asks: the look from the query, toggles that only hide, and a download name. */
function cardImageResponse(card: CardData, format: CardFormat, request: Request): Response {
  const url = new URL(request.url);
  const look = readCardLook(url.searchParams);
  const view = cardView(card, { amounts: look.amounts, proof: look.proof, origin: url.origin, sample: DATA_SOURCE === 'mock' });
  const headers: Record<string, string> = {
    'cache-control': cardCacheControl(card, BigInt(Math.floor(Date.now() / 1_000))),
    'x-content-type-options': 'nosniff',
  };
  if (url.searchParams.get('download') === '1') {
    headers['content-disposition'] = `attachment; filename="${cardFileName(view.kind, card.cardId, format)}"`;
  }
  return renderCardImage(view, format, look.theme, headers);
}

/** HEAD says whether the image exists without drawing it, so a page offers the download only when it will work. */
function headResponse(status: number): Response {
  return new Response(null, {
    status,
    headers: status === 200 ? { 'content-type': 'image/png', 'cache-control': 'no-store' } : { 'cache-control': 'no-store' },
  });
}

type Resolved = { card: CardData; format: CardFormat } | { status: number; response: () => Response };

async function sharedCard(id: string, format: string): Promise<Resolved> {
  if (!isCardId(id) || !isCardFormat(format)) return { status: 404, response: noCardImage };
  const read = await readSharedCard(id);
  if (read.status !== 'found') return { status: read.status === 'missing' ? 404 : 503, response: () => failedRead(read) };
  return { card: read.card, format };
}

async function sampleCard(format: string, request: Request): Promise<Resolved> {
  const sample = readSampleRequest(new URL(request.url).searchParams);
  if (!isCardFormat(format) || sample === null) return { status: 404, response: noCardImage };
  const read = await readSampleCard(sample.input);
  if (read.status !== 'found') return { status: read.status === 'missing' ? 404 : 503, response: () => failedRead(read) };
  if (sample.fingerprint !== null && cardFingerprint(read.card) !== sample.fingerprint) {
    return {
      status: 409,
      response: () =>
        textResponse(
          409,
          'This sample card shows activity from one browser tab, which differs from the sample history the image service draws from.',
        ),
    };
  }
  // The server made this card in its own copy of the sample history, so its id leads nowhere: the image prints no
  // card address, as the tab's preview does not either.
  return { card: { ...read.card, cardId: '' }, format };
}

async function answer(resolved: Promise<Resolved>, request: Request, method: 'GET' | 'HEAD'): Promise<Response> {
  const found = await resolved;
  if ('status' in found) return method === 'HEAD' ? headResponse(found.status) : found.response();
  return method === 'HEAD' ? headResponse(200) : cardImageResponse(found.card, found.format, request);
}

/** /api/card/{cardId}/{format}: a card the data layer holds, by its opaque id. */
export function sharedCardImage(request: Request, id: string, format: string, method: 'GET' | 'HEAD'): Promise<Response> {
  return answer(sharedCard(id, format), request, method);
}

/** /api/card/sample/{format}: sample data only, a card a browser tab made, drawn from the sample history. */
export function sampleCardImage(request: Request, format: string, method: 'GET' | 'HEAD'): Promise<Response> {
  return answer(sampleCard(format, request), request, method);
}
