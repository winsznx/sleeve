import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { DISCLOSURE } from '@sleeve/core';

/** Where the app serves the issuer text. The verifier hashes these bytes, so nothing may rewrite them. */
export const DISCLOSURE_PUBLIC_PATH = '/disclosure/rhj-disclosure.txt';

/**
 * Server only. Returns the served bytes unchanged, after checking them against the pinned sha256, so a page
 * can never show a disclosure that differs from the hash on its receipts.
 */
export async function readDisclosureText(): Promise<string> {
  const bytes = await readFile(path.join(process.cwd(), 'public', DISCLOSURE_PUBLIC_PATH));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== DISCLOSURE.sha256) {
    throw new Error(`Disclosure file sha256 ${sha256} does not match the pinned ${DISCLOSURE.sha256}`);
  }
  return bytes.toString('utf8');
}

/** The file joins paragraphs with single LF bytes (docs/disclosure/README.md). */
export function disclosureParagraphs(text: string): string[] {
  return text.split('\n');
}
