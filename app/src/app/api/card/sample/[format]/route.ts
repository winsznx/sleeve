import { sampleCardImage } from '@/components/cards/server/card-image-route';

/**
 * Sample data only: the PNG of a card a browser tab made on the sample data layer, whose world the server never sees.
 * The address names what the card was made from (receipt=455 or week=1790...), the owner's two choices and the card's
 * fingerprint; the server makes the same card in its own copy of the sample history and draws it only when the
 * fingerprints agree (components/cards/sample-card.ts). On Robinhood Chain this answers not found, and every card is
 * drawn by its id at /api/card/{cardId}/{format}.
 */

export const runtime = 'nodejs';

interface RouteContext {
  params: Promise<{ format: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { format } = await context.params;
  return sampleCardImage(request, format, 'GET');
}

export async function HEAD(request: Request, context: RouteContext): Promise<Response> {
  const { format } = await context.params;
  return sampleCardImage(request, format, 'HEAD');
}
