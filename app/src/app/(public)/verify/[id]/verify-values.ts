import { EXPECTED_DECIMALS, PUBLIC_RPC_URL, formatUnits } from '@sleeve/core';

import { formatUtc } from '@/components/ui/format-time';
import type { VerifyCheck, VerifyUnit } from '@/data/types';

/**
 * How the verifier page prints a check's values. The raw string the verifier reported is always shown, so two
 * values can be compared character by character; a readable form sits next to it when the unit has one. A value
 * that is not the integer its unit expects is shown exactly as reported, never coerced.
 */

export interface ShownValue {
  /** "93.725 USDG", "26 Sep 2026, 14:00 UTC". Null when the raw value is already the readable one. */
  readable: string | null;
  raw: string;
}

const INTEGER = /^-?\d+$/;

function basisPoints(value: bigint): string {
  const magnitude = value < 0n ? -value : value;
  return `${value} ${magnitude === 1n ? 'basis point' : 'basis points'}`;
}

export function shownValue(unit: VerifyUnit, raw: string): ShownValue {
  if (!INTEGER.test(raw)) return { readable: null, raw };
  const value = BigInt(raw);
  switch (unit) {
    case 'usdg':
      return { readable: `${formatUnits(value, EXPECTED_DECIMALS.USDG, { minFractionDigits: 2 })} USDG`, raw };
    case 'token':
      return { readable: `${formatUnits(value, EXPECTED_DECIMALS.STOCK_TOKEN, { minFractionDigits: 2 })} tokens`, raw };
    case 'feed':
      return { readable: `${formatUnits(value, EXPECTED_DECIMALS.FEED, { minFractionDigits: 2 })} USD`, raw };
    case 'multiplier':
      return { readable: formatUnits(value, 18, { minFractionDigits: 1 }), raw };
    case 'bps':
      return { readable: basisPoints(value), raw };
    case 'timestamp':
      return { readable: formatUtc(value), raw };
    case 'block':
    case 'hash':
    case 'address':
    case 'text':
      return { readable: null, raw };
  }
}

export function failingChecks(checks: readonly VerifyCheck[]): VerifyCheck[] {
  return checks.filter((check) => !check.ok);
}

/** "rpc.mainnet.chain.robinhood.com": the host of an RPC URL, or the URL itself when it does not parse. */
export function rpcHost(rpcUrl: string): string {
  try {
    return new URL(rpcUrl).host;
  } catch {
    return rpcUrl;
  }
}

/** Which provider answered, and that it is not the keeper's (D-008). */
export function providerSentence(rpcUrl: string): string {
  return rpcUrl === PUBLIC_RPC_URL
    ? "This is the public Robinhood Chain RPC, a different provider from the one Sleeve's keeper uses."
    : "This is a different provider from the one Sleeve's keeper uses.";
}
