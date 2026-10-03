import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { checkTokens, parseColor, readRootTokens, resolveVars, stripComments, toHex } from '@/styles/contrast.mjs';

export type PaletteReport = ReturnType<typeof checkTokens>;

export interface SemanticSwatch {
  token: string;
  hex: string;
  /** The raw value in tokens.css when it points at another token, so a reader sees the chain. */
  alias: string | null;
}

export interface PaletteData {
  report: PaletteReport;
  swatches: Map<string, SemanticSwatch>;
}

const TOKENS_PATH = path.join(process.cwd(), 'src', 'styles', 'tokens.css');

/**
 * Reads tokens.css and runs the same checks as scripts/contrast-check.mjs, so the page and the gate cannot
 * disagree. The page is prerendered, so in a build this runs once with the file on disk.
 */
export async function loadPaletteData(): Promise<PaletteData> {
  const css = await readFile(TOKENS_PATH, 'utf8');
  const report = checkTokens(css);
  const tokens = readRootTokens(stripComments(css));
  const swatches = new Map<string, SemanticSwatch>();
  for (const [token, raw] of tokens) {
    if (!token.startsWith('--color-')) continue;
    const color = parseColor(resolveVars(raw, tokens));
    if (!color) continue;
    const hex = color.a < 1 ? `${toHex(color)} at ${Math.round(color.a * 100)} percent` : toHex(color);
    swatches.set(token, { token, hex, alias: raw.trim().startsWith('var(') ? raw.trim().slice(4, -1) : null });
  }
  return { report, swatches };
}
