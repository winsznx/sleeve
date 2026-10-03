import { cache } from 'react';

import { createDataLayer } from '@/data/create';
import { isDataLayerError } from '@/data/errors';
import { createMockDataLayer } from '@/data/mock';
import { DATA_SOURCE } from '@/data/source';
import type { CardData, CreateCardInput, SleeveDataLayer } from '@/data/types';

/**
 * Server only. Where the card page, the image routes and the OpenGraph images read a card: through the data layer,
 * like every screen, and never from text in the address. A card id is opaque, so it can only ever draw what its
 * owner made.
 */

export type CardRead = { status: 'found'; card: CardData } | { status: 'missing' } | { status: 'unavailable'; message: string };

let shared: SleeveDataLayer | null = null;

/** The mock's simulated network delay only helps screens show their loading states, so the server skips it. */
function sharedLayer(): SleeveDataLayer {
  shared ??= DATA_SOURCE === 'mock' ? createMockDataLayer() : createDataLayer();
  return shared;
}

async function read(work: () => Promise<CardData | null>): Promise<CardRead> {
  try {
    const card = await work();
    return card === null ? { status: 'missing' } : { status: 'found', card };
  } catch (error) {
    if (isDataLayerError(error) && error.code === 'NotFound') return { status: 'missing' };
    if (isDataLayerError(error)) return { status: 'unavailable', message: error.message };
    throw error;
  }
}

/** A card someone shared, by its opaque id. Read once per request, however many parts of the page ask. */
export const readSharedCard = cache((cardId: string): Promise<CardRead> => read(() => sharedLayer().getCard(cardId)));

/**
 * Sample data only (components/cards/sample-card.ts). Makes the card again in a fresh copy of the sample history, as
 * the sample owner, from what it was made of. On Robinhood Chain this path answers missing.
 */
export function readSampleCard(input: CreateCardInput): Promise<CardRead> {
  if (DATA_SOURCE !== 'mock') return Promise.resolve({ status: 'missing' });
  return read(() => createMockDataLayer().createCard(input));
}
