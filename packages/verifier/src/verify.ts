import { PUBLIC_RPC_URL, type Hex } from '@sleeve/core';
import { createPublicClient, keccak256, stringToBytes } from 'viem';
import { robinhood } from 'viem/chains';

import { checkEvidence, notFoundResult } from './check';
import { parseReceiptId } from './errors';
import { gatherEvidence, type GatherOptions } from './gather';
import { viemReader, type ChainReader } from './reader';
import { throttledHttp, type ThrottleOptions } from './transport';
import type { VerifyResult } from './types';

export interface VerifyOptions extends GatherOptions {
  /**
   * The RPC to read through. Defaults to the public Robinhood Chain RPC, a different provider from the keeper's
   * (D-008, D-009 Q36).
   */
  rpcUrl?: string;
  /** Spacing and backoff for the RPC (D-012). */
  throttle?: ThrottleOptions;
  /** Reads through this instead of building a reader from rpcUrl and throttle, for tests and custom clients. */
  reader?: ChainReader;
  /**
   * The disclosure text the caller serves, as its exact bytes or as a UTF-8 string. Its keccak256 is compared with
   * the receipt's disclosure hash; without it the hash pinned in packages/core stands in (PRD 10).
   */
  disclosureText?: Uint8Array | string;
}

/** A reader over the given RPC with the verifier's throttle. One reader shares one request queue. */
export function createReader(rpcUrl: string = PUBLIC_RPC_URL, throttle: ThrottleOptions = {}): ChainReader {
  const client = createPublicClient({ chain: robinhood, transport: throttledHttp(rpcUrl, throttle) });
  return viemReader(client, rpcUrl);
}

export function disclosureHashOf(text: Uint8Array | string): Hex {
  return keccak256(typeof text === 'string' ? stringToBytes(text) : text);
}

/**
 * Recomputes one receipt from public chain data (PRD 10): the ReceiptWritten log and the stored hash, the round
 * again through getRoundData, the transaction's Transfer and Swap logs, the token's multiplier and pause logs, the
 * calendar, the rule, and the shared price arithmetic. Resolves to a result whose verdict is MATCH, MISMATCH or
 * NOT_FOUND; rejects only when the chain could not be read, with a VerifierError subclass.
 */
export async function verifyReceipt(id: bigint | string | number, options: VerifyOptions = {}): Promise<VerifyResult> {
  const receiptId = parseReceiptId(id);
  const reader = options.reader ?? createReader(options.rpcUrl ?? PUBLIC_RPC_URL, options.throttle ?? {});
  const gathered = await gatherEvidence(receiptId, reader, options);
  if (!gathered.found) return notFoundResult({ ...gathered, rpcUrl: reader.url });
  const disclosure = options.disclosureText === undefined ? {} : { disclosureTextHash: disclosureHashOf(options.disclosureText) };
  return checkEvidence(gathered.evidence, disclosure);
}
