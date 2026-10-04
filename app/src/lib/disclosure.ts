import { createHash } from 'node:crypto';

import { DISCLOSURE } from '@sleeve/core';

import { DISCLOSURE_TEXT } from '@/generated/disclosure-text';

/** Where the app serves the issuer text. The verifier hashes these bytes, so nothing may rewrite them. */
export const DISCLOSURE_PUBLIC_PATH = '/disclosure/rhj-disclosure.txt';

/**
 * Server only. Returns the served file's text unchanged, embedded from public/ by scripts/embed-server-assets.mjs
 * (D-033), after checking it against the pinned sha256, so a page can never show a disclosure that differs from the
 * hash on its receipts.
 */
export async function readDisclosureText(): Promise<string> {
  const sha256 = createHash('sha256').update(DISCLOSURE_TEXT, 'utf8').digest('hex');
  if (sha256 !== DISCLOSURE.sha256) {
    throw new Error(`Disclosure file sha256 ${sha256} does not match the pinned ${DISCLOSURE.sha256}`);
  }
  return DISCLOSURE_TEXT;
}

/** The file joins paragraphs with single LF bytes (docs/disclosure/README.md). */
export function disclosureParagraphs(text: string): string[] {
  return text.split('\n');
}
