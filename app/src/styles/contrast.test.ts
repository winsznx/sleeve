import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { checkTokens, readDarkTokens, readRootTokens, stripComments } from './contrast.mjs';

const css = readFileSync(path.join(process.cwd(), 'src', 'styles', 'tokens.css'), 'utf8');

describe('tokens.css', () => {
  it('passes every color claim in both themes', () => {
    const report = checkTokens(css);
    expect(report.failures).toEqual([]);
    expect(report.dark).not.toBeNull();
    expect(report.dark?.pairs.length).toBeGreaterThan(100);
  });

  it('reads light values for the card images and the palette page, never the dark block', () => {
    const light = readRootTokens(stripComments(css));
    const dark = readDarkTokens(stripComments(css));
    expect(light.get('--color-canvas')).toBe('#ffffff');
    expect(dark.get('--color-canvas')).not.toBe('#ffffff');
    expect(dark.get('--color-equity')).toBe(light.get('--color-equity'));
  });

  it('fails a semantic token with no dark value', () => {
    const missing = css.replace(/(:root\[data-theme='dark'\] \{[\s\S]*?)--color-ink-muted: [^;]+;/, '$1');
    expect(checkTokens(missing).failures).toContain('dark: --color-ink-muted has no dark value; give it one or list it in DARK_SHARED');
  });
});
