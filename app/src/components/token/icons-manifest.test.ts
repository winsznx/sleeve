import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ADDRESSES, LAUNCH_TICKERS } from '@sleeve/core';
import { describe, expect, it } from 'vitest';

import manifest from '../../../public/assets/icons-manifest.json';

const PUBLIC_DIR = join(__dirname, '..', '..', '..', 'public');
const TOKENS_DIR = join(PUBLIC_DIR, 'assets', 'tokens');
const FEATHER_SHA256 = '3acff25ee4e8f842d245c315002965c712c7f42f00fff4377e1ad8ce88d78ab1';
const LADDER = ['ISSUER', 'CONTRACT', 'CHAIN_LIST', 'PINNED'];

const icons = Object.entries(manifest.icons);
interface WithheldEntry {
  kind: string;
  display: string;
  contract?: string;
  checked: { rung: string; verdict: string; sha256?: string; sourceUrl?: string }[];
}
// Empty once every logo is pinned, so it is typed by hand rather than inferred from the JSON.
const withheldRecord: Record<string, WithheldEntry> = manifest.withheld;
const withheld = Object.entries(withheldRecord);

describe('icons-manifest.json', () => {
  it('covers every launch Stock Token, USDG and ETH, each exactly once', () => {
    const keys = [...icons, ...withheld].map(([key]) => key).sort();
    expect(keys).toEqual([...LAUNCH_TICKERS.map((ticker) => ticker.symbol), 'USDG', 'ETH'].sort());
  });

  it('records each Stock Token under the contract packages/core trades', () => {
    const records: Record<string, { contract: string | null }> = { ...manifest.icons, ...manifest.withheld };
    for (const ticker of LAUNCH_TICKERS) expect(records[ticker.symbol]?.contract).toBe(ticker.token);
    expect(manifest.icons.USDG.contract).toBe(ADDRESSES.USDG);
    expect(manifest.icons.ETH.contract).toBeNull();
  });

  it('serves every logo locally with the bytes and checksum the manifest records', () => {
    for (const [key, icon] of icons) {
      expect(icon.localPath, key).toMatch(/^\/assets\/tokens\/[a-z0-9-]+\.(png|svg)$/);
      const bytes = readFileSync(join(PUBLIC_DIR, icon.localPath));
      expect(bytes.length, key).toBe(icon.bytes);
      expect(createHash('sha256').update(bytes).digest('hex'), key).toBe(icon.sha256);
    }
  });

  it('keeps no file in public/assets/tokens that the manifest does not name', () => {
    const named = icons.map(([, icon]) => icon.localPath.split('/').pop()).sort();
    expect(readdirSync(TOKENS_DIR).sort()).toEqual(named);
  });

  it('records provenance for every logo: rung, source, retrieval time and the rungs above it', () => {
    for (const [key, icon] of icons) {
      expect(LADDER, key).toContain(icon.rung);
      expect(icon.sourceUrl, key).toMatch(/^(https|ipfs):\/\//);
      expect(Number.isNaN(Date.parse(icon.retrievedAt)), key).toBe(false);
      const above = LADDER.slice(0, LADDER.indexOf(icon.rung));
      expect(icon.checked.map((check) => check.rung), key).toEqual(above);
    }
  });

  it('never ships the Robinhood feather', () => {
    for (const [key, icon] of icons) expect(icon.sha256, key).not.toBe(FEATHER_SHA256);
  });

  it('withholds a logo only with evidence that every rung returned a banned mark or had nothing', () => {
    for (const [key, entry] of withheld) {
      expect(entry.kind, key).toBe('stock-token');
      expect(entry.display, key).toBe('stock-token-glyph');
      expect(entry.checked.map((check) => check.rung), key).toEqual(LADDER);
      const issuer = entry.checked.find((check) => check.rung === 'ISSUER');
      expect(issuer?.verdict, key).toBe('rejected');
      expect(issuer?.sha256, key).toBe(FEATHER_SHA256);
      expect(issuer?.sourceUrl, key).toBe(`https://cdn.robinhood.com/ncw_assets/logos/${entry.contract?.toLowerCase()}.png`);
      for (const check of entry.checked) {
        expect(['rejected', 'not-applicable', 'no-approved-pin'], `${key} ${check.rung}`).toContain(check.verdict);
      }
    }
  });
});
