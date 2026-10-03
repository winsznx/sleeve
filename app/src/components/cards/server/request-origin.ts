import { headers } from 'next/headers';

/**
 * Server only. Where the request came in, for the card address a card prints and the QR code it carries. Null when
 * the request names no host. The production domain is not settled yet, so nothing here hardcodes one.
 */
export async function requestOrigin(): Promise<string | null> {
  const list = await headers();
  const host = list.get('x-forwarded-host') ?? list.get('host');
  if (host === null || !/^[A-Za-z0-9.-]+(?::\d{1,5})?$/.test(host)) return null;
  const local = host.startsWith('localhost') || host.startsWith('127.');
  const scheme = list.get('x-forwarded-proto')?.split(',')[0]?.trim() || (local ? 'http' : 'https');
  return scheme === 'http' || scheme === 'https' ? `${scheme}://${host}` : null;
}
