import { DATA_SOURCE } from '@/data/source';

import { CardArt } from '../card-art';
import type { CardTheme } from '../card-themes';
import { cardAltText, cardView, type CardView } from '../card-view';
import { OG_SIZE, SiteOgArt, VerifyOgArt, siteOgAlt } from '../og-art';
import { readSharedCard } from './card-source';
import { renderImage, serverEnv } from './render';
import { requestOrigin } from './request-origin';

/**
 * Server only. The OpenGraph and Twitter images the route folders declare (docs/design/inspiration.md section 8).
 * They are 1200 by 630 PNGs. A card's image shows only what its owner chose to show, read through the data layer.
 */

/** The colorway link previews use: the white ticket on the green stage reads on any feed's background. */
export const CARD_OG_THEME: CardTheme = 'stage';

export function siteImage(): Response {
  return renderImage(<SiteOgArt env={serverEnv()} />, OG_SIZE);
}

export function verifyImage(): Response {
  return renderImage(<VerifyOgArt env={serverEnv()} />, OG_SIZE);
}

/** The card as its link preview shows it, or null when no card is at the id. */
async function sharedCardView(cardId: string): Promise<CardView | null> {
  const read = await readSharedCard(cardId);
  if (read.status !== 'found') return null;
  return cardView(read.card, { amounts: true, proof: true, origin: await requestOrigin(), sample: DATA_SOURCE === 'mock' });
}

export async function cardImageAlt(cardId: string): Promise<string> {
  const view = await sharedCardView(cardId);
  return view === null ? siteOgAlt() : cardAltText(view);
}

/** A shared card's link preview. An id with no card shows the site's image, so a broken link still says what Sleeve is. */
export async function cardImage(cardId: string): Promise<Response> {
  const view = await sharedCardView(cardId);
  if (view === null) return siteImage();
  return renderImage(<CardArt view={view} format="wide" theme={CARD_OG_THEME} env={serverEnv()} />, OG_SIZE);
}
