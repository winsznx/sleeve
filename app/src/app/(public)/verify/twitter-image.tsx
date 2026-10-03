import { verifyOgAlt } from '@/components/cards/og-art';
import { verifyImage } from '@/components/cards/server/og-images';

/** X shows the same picture as the verifier's OpenGraph image. */

export const alt = verifyOgAlt();
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function Image(): Response {
  return verifyImage();
}
