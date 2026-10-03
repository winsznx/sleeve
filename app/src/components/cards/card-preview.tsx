import type { CSSProperties, JSX } from 'react';

import { cx } from '@/components/ui/cx';

import { CardArt } from './card-art';
import { CARD_UNIT_VAR, DOM_ENV } from './card-env';
import { CARD_FORMATS, type CardFormat } from './card-options';
import type { CardTheme } from './card-themes';
import { cardAltText, type CardView } from './card-view';

export interface CardPreviewProps {
  view: CardView;
  format: CardFormat;
  theme: CardTheme;
  className?: string;
}

/**
 * The card drawn in the page by the same component next/og draws the PNG with. The frame is a size container:
 * one design pixel is its width divided by the image width, so the art scales as text and shapes, crisp at any
 * size, with no script measuring anything. Assistive technology reads the card's words once, as an image.
 */
export function CardPreview({ view, format, theme, className }: CardPreviewProps): JSX.Element {
  const { width, height } = CARD_FORMATS[format];
  const frame: CSSProperties & Record<typeof CARD_UNIT_VAR, string> = {
    [CARD_UNIT_VAR]: `calc(100cqw / ${width})`,
    aspectRatio: `${width} / ${height}`,
  };
  return (
    <div className={cx('w-full [container-type:inline-size]', className)}>
      <div role="img" aria-label={cardAltText(view)} style={frame} className="relative w-full overflow-hidden rounded-module shadow-card">
        <CardArt view={view} format={format} theme={theme} env={DOM_ENV} />
      </div>
    </div>
  );
}
