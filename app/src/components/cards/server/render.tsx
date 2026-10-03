import { ImageResponse } from 'next/og';
import type { ReactElement } from 'react';

import { CardArt } from '../card-art';
import { CARD_FONT_FAMILY, type CardEnv } from '../card-env';
import { CARD_FORMATS, type CardFormat } from '../card-options';
import type { CardTheme } from '../card-themes';
import type { CardView } from '../card-view';
import { serverPalette } from './design-tokens';
import { imageFonts, logoDataUri } from './image-assets';

/**
 * Server only. Draws card art and OpenGraph art with next/og (Satori and Resvg on the Node runtime), with the
 * design fonts and the committed token logos, so the PNG a person downloads is the picture the page previewed.
 */

let env: CardEnv | null = null;

/** The server's drawing environment: resolved token values, the registered font names and inlined logos. */
export function serverEnv(): CardEnv {
  env ??= {
    palette: serverPalette(),
    fonts: { sans: CARD_FONT_FAMILY.sans, mono: CARD_FONT_FAMILY.mono },
    px: (value) => value,
    logo: logoDataUri,
    stripes: 'svg',
  };
  return env;
}

export interface ImageSize {
  width: number;
  height: number;
}

/** Any art element as a PNG of the given size. */
export function renderImage(element: ReactElement, size: ImageSize, headers?: HeadersInit): ImageResponse {
  return new ImageResponse(element, { ...size, fonts: imageFonts(), headers });
}

export function renderCardImage(view: CardView, format: CardFormat, theme: CardTheme, headers?: HeadersInit): ImageResponse {
  const { width, height } = CARD_FORMATS[format];
  return renderImage(<CardArt view={view} format={format} theme={theme} env={serverEnv()} />, { width, height }, headers);
}
