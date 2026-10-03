import type { Address, Hex } from '@sleeve/core';

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = (1n << 64n) - 1n;

/**
 * Deterministic 32 bytes from a label, for sample transaction hashes, receipt hashes and addresses. Four FNV-1a
 * lanes, not a cryptographic hash: it only has to look like one and repeat across reloads and tests.
 */
export function pseudoHash(label: string): Hex {
  let out = '';
  for (let lane = 1; lane <= 4; lane += 1) {
    let hash = FNV_OFFSET ^ BigInt(lane);
    for (const char of `${lane}:${label}`) {
      hash ^= BigInt(char.codePointAt(0) ?? 0);
      hash = (hash * FNV_PRIME) & MASK_64;
    }
    out += hash.toString(16).padStart(16, '0');
  }
  return `0x${out}`;
}

export function pseudoAddress(label: string): Address {
  return `0x${pseudoHash(label).slice(2, 42)}`;
}
