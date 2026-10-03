import { isCardId } from '@/components/cards/card-options';
import { siteOgAlt } from '@/components/cards/og-art';
import { cardImage, cardImageAlt, siteImage } from '@/components/cards/server/og-images';

/**
 * A shared card's link preview: the card itself in its wide format, with only what its owner chose to show
 * (docs/design/inspiration.md 8.2). The alt text is the card's own words.
 */

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** Next 15 passes the segment's params as an object; Next 16 passes a promise. Awaiting covers both. */
type Params = { id: string } | Promise<{ id: string }>;

interface CardImageMetadata {
  id: string;
  alt: string;
  size: typeof size;
  contentType: typeof contentType;
}

export async function generateImageMetadata({ params }: { params: Params }): Promise<CardImageMetadata[]> {
  const { id } = await params;
  const alt = isCardId(id) ? await cardImageAlt(id) : siteOgAlt();
  return [{ id: 'card', alt, size, contentType }];
}

export default async function Image({ params }: { params: Params }): Promise<Response> {
  const { id } = await params;
  return isCardId(id) ? cardImage(id) : siteImage();
}
