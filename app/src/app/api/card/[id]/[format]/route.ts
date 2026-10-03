import { sharedCardImage } from '@/components/cards/server/card-image-route';

/**
 * A shared card as a PNG: /api/card/{cardId}/post (1080 by 1350) or /wide (1200 by 630). The query carries the look
 * (theme), toggles that can only leave off what the owner showed (amounts=0, proof=0) and download=1 for a file name.
 * The card itself is read through the data layer by its opaque id, never taken from the address.
 */

export const runtime = 'nodejs';

interface RouteContext {
  params: Promise<{ id: string; format: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { id, format } = await context.params;
  return sharedCardImage(request, id, format, 'GET');
}

export async function HEAD(request: Request, context: RouteContext): Promise<Response> {
  const { id, format } = await context.params;
  return sharedCardImage(request, id, format, 'HEAD');
}
