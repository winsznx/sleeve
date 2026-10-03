import { verifyOgAlt } from '@/components/cards/og-art';
import { verifyImage } from '@/components/cards/server/og-images';

/** The verifier's link preview (docs/design/inspiration.md 8.3). Its pages inherit it. */

export const alt = verifyOgAlt();
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function Image(): Response {
  return verifyImage();
}
