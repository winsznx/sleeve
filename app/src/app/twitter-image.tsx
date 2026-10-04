import { siteOgAlt } from '@/components/cards/og-art';
import { siteImage } from '@/components/cards/server/og-images';

/** X shows the same picture as the OpenGraph image, brand kit lockup included (D-037), as a large summary card. */

export const alt = siteOgAlt();
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function Image(): Response {
  return siteImage();
}
