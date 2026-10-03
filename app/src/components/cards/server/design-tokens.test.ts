// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { CARD_COLOR_TOKENS, CARD_LAYER_TOKENS, DOM_PALETTE } from '../card-palette';
import { backgroundLayers, createTokenResolver, serverPalette, singlePositionStops, splitTopLevel } from './design-tokens';

const css = readFileSync(path.join(process.cwd(), 'src', 'styles', 'tokens.css'), 'utf8');

describe('design tokens for the images', () => {
  it('resolves every card token from tokens.css to a value with no var() left', () => {
    const resolve = createTokenResolver(css);
    for (const token of [...Object.values(CARD_COLOR_TOKENS), ...Object.values(CARD_LAYER_TOKENS)]) {
      const value = resolve(token);
      expect(value, token).not.toBe('');
      expect(value, token).not.toContain('var(');
    }
  });

  it('follows aliases to the palette step tokens.css names', () => {
    const resolve = createTokenResolver(css);
    expect(resolve('--color-equity')).toBe(resolve('--color-accent'));
    expect(resolve('--color-spend-text')).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('fails loudly on a token the file does not define', () => {
    const resolve = createTokenResolver(css);
    expect(() => resolve('--color-not-a-token')).toThrow(/does not define/);
  });

  it('splits stacked backgrounds at the top level only, top layer first', () => {
    const layers = backgroundLayers(createTokenResolver(css)('--gradient-stage'));
    expect(layers).toHaveLength(3);
    expect(layers[0]).toMatch(/^radial-gradient\(/);
    expect(layers[2]).toMatch(/^linear-gradient\(/);
    expect(splitTopLevel('a(1, 2), b(3), c')).toEqual(['a(1, 2)', 'b(3)', 'c']);
  });

  it('turns two-position color stops into two single-position stops', () => {
    expect(singlePositionStops('repeating-linear-gradient(135deg, white 0 4px, black 4px 6px)')).toBe(
      'repeating-linear-gradient(135deg, white 0, white 4px, black 4px, black 6px)',
    );
    expect(singlePositionStops('linear-gradient(155deg, white 0%, black 100%)')).toBe('linear-gradient(155deg, white 0%, black 100%)');
  });

  it('gives the page the same token names as var() references', () => {
    expect(DOM_PALETTE.color.ink).toBe('var(--color-ink)');
    expect(DOM_PALETTE.layers.stage).toEqual(['var(--gradient-stage)']);
    const server = serverPalette();
    expect(Object.keys(server.color)).toEqual(Object.keys(DOM_PALETTE.color));
    expect(server.layers.hero[0]).toMatch(/^linear-gradient\(155deg, /);
  });
});
