import { siteOgAlt } from '@/components/cards/og-art';
import { siteImage } from '@/components/cards/server/og-images';

/** The site's link preview: the sentence and a payday splitting (docs/design/inspiration.md 8.1). */

export const alt = siteOgAlt();
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function Image(): Response {
  return siteImage();
}
