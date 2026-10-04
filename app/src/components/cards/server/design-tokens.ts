import { TOKENS_CSS } from '@/generated/tokens-css';
import { readRootTokens, resolveVars, stripComments } from '@/styles/contrast.mjs';

import { paletteFrom, type CardPalette } from '../card-palette';

/**
 * Server only. Satori, the renderer behind next/og, cannot read CSS custom properties, so the images resolve the
 * card palette's token names from tokens.css itself, embedded by scripts/embed-server-assets.mjs (D-033). The file is
 * the single source for the page and the images alike; nothing here holds a color of its own.
 */

/** Splits a comma-separated list at the top level only, so the commas inside gradient functions stay put. */
export function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    else if (char === ',' && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter((part) => part !== '');
}

/**
 * Satori reads one position per color stop. CSS allows two ("amber 4px 6px"), which tokens.css uses for the waiting
 * stripes; each such stop becomes two single-position stops with the same color, which CSS defines as equal.
 */
export function singlePositionStops(gradient: string): string {
  const open = gradient.indexOf('(');
  if (open === -1 || !gradient.endsWith(')')) return gradient;
  const name = gradient.slice(0, open);
  const args = splitTopLevel(gradient.slice(open + 1, -1)).flatMap((stop) => {
    const words = stop.match(/(?:[^\s()]+|\([^)]*\))+/g) ?? [];
    const positions = words.slice(1);
    const isTwoPositionStop = positions.length === 2 && positions.every((word) => /^-?[\d.]+(?:px|%)?$/.test(word));
    if (!isTwoPositionStop) return [stop];
    const color = words[0] ?? '';
    return [`${color} ${positions[0]}`, `${color} ${positions[1]}`];
  });
  return `${name}(${args.join(', ')})`;
}

/** Resolves card token names against one copy of tokens.css. Throws on a token the file does not define. */
export function createTokenResolver(css: string): (token: string) => string {
  const tokens = readRootTokens(stripComments(css));
  return (token: string) => {
    const raw = tokens.get(token);
    if (raw === undefined) throw new Error(`tokens.css does not define ${token}`);
    return singlePositionStops(resolveVars(raw, tokens).replace(/\s+/g, ' ').trim());
  };
}

/** Each background layer as its own value, top layer first, with Satori-safe color stops. */
export function backgroundLayers(value: string): string[] {
  return splitTopLevel(value).map(singlePositionStops);
}

let cached: CardPalette | null = null;

/** The palette the images paint with, read from tokens.css once per server process. */
export function serverPalette(): CardPalette {
  if (cached === null) {
    const resolve = createTokenResolver(TOKENS_CSS);
    cached = paletteFrom(resolve, backgroundLayers);
  }
  return cached;
}
