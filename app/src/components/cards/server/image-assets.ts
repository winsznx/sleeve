import { readFileSync } from 'node:fs';
import path from 'node:path';

import { tokenLogo, type LogoKey } from '@/components/token/registry';

import { CARD_FONT_FAMILY } from '../card-env';

/**
 * Server only. The two families docs/DESIGN.md section 4 sets, as the static TrueType instances Google Fonts serves
 * (Satori reads ttf, otf and woff, not woff2), and the token logos from public/assets/tokens as data URIs. The
 * licenses sit beside the fonts in ../fonts. Every path is written out in full so the build's file tracing copies
 * the files into the function that draws the images.
 */

type FontWeight = 400 | 500 | 600;

export interface ImageFont {
  name: string;
  data: Buffer;
  weight: FontWeight;
  style: 'normal';
}

function font(name: string, weight: FontWeight, data: Buffer): ImageFont {
  return { name, data, weight, style: 'normal' };
}

let fonts: ImageFont[] | null = null;

export function imageFonts(): ImageFont[] {
  fonts ??= [
    font(CARD_FONT_FAMILY.sans, 400, readFileSync(path.join(process.cwd(), 'src/components/cards/fonts/InstrumentSans-Regular.ttf'))),
    font(CARD_FONT_FAMILY.sans, 500, readFileSync(path.join(process.cwd(), 'src/components/cards/fonts/InstrumentSans-Medium.ttf'))),
    font(CARD_FONT_FAMILY.sans, 600, readFileSync(path.join(process.cwd(), 'src/components/cards/fonts/InstrumentSans-SemiBold.ttf'))),
    font(CARD_FONT_FAMILY.mono, 400, readFileSync(path.join(process.cwd(), 'src/components/cards/fonts/IBMPlexMono-Regular.ttf'))),
    font(CARD_FONT_FAMILY.mono, 500, readFileSync(path.join(process.cwd(), 'src/components/cards/fonts/IBMPlexMono-Medium.ttf'))),
  ];
  return fonts;
}

const logos = new Map<LogoKey, string>();

const IMAGE_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };

/** The token's committed logo file, the one TokenIcon shows, inlined so the renderer never fetches anything. */
export function logoDataUri(key: LogoKey): string {
  const known = logos.get(key);
  if (known !== undefined) return known;
  const logo = tokenLogo(key);
  const type = IMAGE_TYPES[path.extname(logo.src).toLowerCase()];
  if (type === undefined) throw new Error(`The image renderer cannot draw ${logo.src}`);
  const bytes = readFileSync(path.join(process.cwd(), 'public', logo.src));
  const uri = `data:${type};base64,${bytes.toString('base64')}`;
  logos.set(key, uri);
  return uri;
}
