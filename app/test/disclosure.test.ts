import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { DISCLOSURE } from '@sleeve/core';
import { describe, expect, it } from 'vitest';

import { DISCLOSURE_PUBLIC_PATH, disclosureParagraphs, readDisclosureText } from '@/lib/disclosure';

// Tests run from app/, the same working directory the server helper resolves public/ from.
const served = readFileSync(path.join(process.cwd(), 'public', DISCLOSURE_PUBLIC_PATH));
const pinned = readFileSync(path.join(process.cwd(), '..', 'docs', 'disclosure', 'rhj-disclosure.txt'));

describe('issuer disclosure served by the app', () => {
  it('is byte for byte the file docs/disclosure pins', () => {
    expect(served.equals(pinned)).toBe(true);
  });

  it('hashes to the pinned sha256 at the pinned size', () => {
    const sha256 = createHash('sha256').update(served).digest('hex');
    expect([sha256, served.length]).toEqual([DISCLOSURE.sha256, DISCLOSURE.byteLength]);
  });

  it('reads back through the server helper as four paragraphs', async () => {
    expect(disclosureParagraphs(await readDisclosureText())).toHaveLength(4);
  });
});
