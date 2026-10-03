'use client';

import { useQuery } from '@tanstack/react-query';

import { DEFAULT_CARD_FORMAT, DEFAULT_CARD_LOOK, cardImagePath, type CardFormat, type CardLook } from '@/components/cards/card-options';
import { cardFingerprint } from '@/components/cards/card-view';
import { findSampleRecipe, sampleImagePath, type SampleCardRecipe } from '@/components/cards/sample-card';
import { useDataLayer } from '@/data/provider';
import { queryKeys } from '@/data/query-keys';
import { DATA_SOURCE } from '@/data/source';
import type { CardData, SleeveDataLayer } from '@/data/types';

/**
 * Where this page's PNG comes from. A card the server read itself is drawn by its id. A card only this tab knows,
 * which on the sample data layer is every card made in the tab, is drawn from what it was made of, after a HEAD
 * request confirms the server draws the same card; only then does the page offer the download.
 */

export type CardImagePath = (format: CardFormat, look: CardLook, download: boolean) => string;

export type CardImageSource =
  | { status: 'checking' }
  | { status: 'ready'; path: CardImagePath }
  /** sample-tab: a sample card made from this tab's own activity. not-ready: the card store has no image yet. */
  | { status: 'unavailable'; reason: 'sample-tab' | 'not-ready' }
  | { status: 'failed'; retry: () => void };

type Located =
  { kind: 'card' } | { kind: 'sample'; recipe: SampleCardRecipe } | { kind: 'unavailable'; reason: 'sample-tab' | 'not-ready' };

/** Whether the image service would draw this address. 404 and 409 are answers; anything else is a failure. */
async function drawable(path: string): Promise<boolean> {
  const response = await fetch(path, { method: 'HEAD' });
  if (response.ok) return true;
  if (response.status === 404 || response.status === 409) return false;
  throw new Error(`The image service answered ${response.status}`);
}

async function locate(layer: SleeveDataLayer, cardId: string, card: CardData): Promise<Located> {
  if (DATA_SOURCE === 'mock') {
    const recipe = await findSampleRecipe(layer, card);
    if (recipe === null) return { kind: 'unavailable', reason: 'sample-tab' };
    const ok = await drawable(sampleImagePath(recipe, DEFAULT_CARD_FORMAT, DEFAULT_CARD_LOOK));
    return ok ? { kind: 'sample', recipe } : { kind: 'unavailable', reason: 'sample-tab' };
  }
  const ok = await drawable(cardImagePath({ cardId, format: DEFAULT_CARD_FORMAT, look: DEFAULT_CARD_LOOK }));
  return ok ? { kind: 'card' } : { kind: 'unavailable', reason: 'not-ready' };
}

function cardPath(cardId: string): CardImagePath {
  return (format, look, download) => cardImagePath({ cardId, format, look, download });
}

/**
 * @param serverHasCard the server read this card when it drew the page, so it can draw the image too.
 */
export function useCardImage(cardId: string, card: CardData, serverHasCard: boolean): CardImageSource {
  const layer = useDataLayer();
  const query = useQuery({
    // Under the data layer's root key, so an owner write that changes the tab's history checks again.
    queryKey: [...queryKeys.all, 'card-image', cardId, cardFingerprint(card)],
    queryFn: () => locate(layer, cardId, card),
    enabled: !serverHasCard,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  if (serverHasCard) return { status: 'ready', path: cardPath(cardId) };
  if (query.isPending) return { status: 'checking' };
  if (query.isError) return { status: 'failed', retry: () => void query.refetch() };
  const found = query.data;
  if (found.kind === 'unavailable') return { status: 'unavailable', reason: found.reason };
  if (found.kind === 'sample') {
    const { recipe } = found;
    return { status: 'ready', path: (format, look, download) => sampleImagePath(recipe, format, look, download) };
  }
  return { status: 'ready', path: cardPath(cardId) };
}
