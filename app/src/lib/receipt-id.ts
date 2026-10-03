const UINT256_MAX = 2n ** 256n - 1n;

/**
 * A receipt id from a URL segment: a decimal uint256 from 1, no sign, no leading zeros. Ids are global and
 * start at 1 (D-009 Q25). Null for anything else, so the page can answer not found.
 */
export function parseReceiptId(segment: string): bigint | null {
  if (!/^[1-9]\d{0,77}$/.test(segment)) return null;
  const id = BigInt(segment);
  return id <= UINT256_MAX ? id : null;
}
