// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { tokenLogo, type LogoKey } from '@/components/token/registry';

import manifest from '../../public/assets/icons-manifest.json';
import { CARD_FONTS } from './card-fonts';
import { DISCLOSURE_TEXT } from './disclosure-text';
import { TOKEN_LOGOS } from './token-logos';
import { TOKENS_CSS } from './tokens-css';

const APP = fileURLToPath(new URL('../..', import.meta.url));
const STALE = 'stale: run node scripts/embed-server-assets.mjs';

function read(relative: string): Buffer {
  return readFileSync(path.join(APP, relative));
}

describe('embedded server assets', () => {
  it('match tokens.css and the issuer disclosure byte for byte', () => {
    expect(TOKENS_CSS, STALE).toBe(read('src/styles/tokens.css').toString('utf8'));
    expect(Buffer.from(DISCLOSURE_TEXT, 'utf8').equals(read('public/disclosure/rhj-disclosure.txt')), STALE).toBe(true);
  });

  it('carry every card font unchanged', () => {
    const files = readdirSync(path.join(APP, 'src/components/cards/fonts')).filter((file) => file.endsWith('.ttf'));
    expect(Object.keys(CARD_FONTS).sort(), STALE).toEqual(files.sort());
    for (const [file, base64] of Object.entries(CARD_FONTS)) {
      expect(base64, `${file} ${STALE}`).toBe(read(path.join('src/components/cards/fonts', file)).toString('base64'));
    }
  });

  it('carry every logo the registry serves, unchanged', () => {
    for (const key of Object.keys(manifest.icons) as LogoKey[]) {
      const { src } = tokenLogo(key);
      const embedded = Object.entries(TOKEN_LOGOS).find(([servedAt]) => servedAt === src);
      expect(embedded, `${src} ${STALE}`).toBeDefined();
      expect(embedded?.[1], `${src} ${STALE}`).toBe(read(path.join('public', src)).toString('base64'));
    }
  });
});
