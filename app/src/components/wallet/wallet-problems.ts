import { shortAddress, type Address } from '@sleeve/core';

import { isDataLayerError } from '@/data/errors';
import { CONTRACT_WALLET_LINE } from '@/lib/signer';

import { WalletSignerError } from './wallet-checks';

/**
 * The wallet failures onboarding names (docs/research/wallet-connect.md section 12): a declined signature, a contract
 * wallet, the wrong account selected, a signature that does not recover, sponsorship that is not there, the address
 * deployed by someone else first (AA10), and a wallet on another network.
 */
export type WalletProblem =
  | { kind: 'REJECTED' }
  | { kind: 'CONTRACT_WALLET'; address: Address }
  | { kind: 'WRONG_OWNER'; selected: Address }
  | { kind: 'SIGNATURE_MISMATCH'; address: Address }
  | { kind: 'SPONSORSHIP' }
  | { kind: 'ALREADY_DEPLOYED' }
  | { kind: 'CHAIN' }
  | { kind: 'UNKNOWN' };

const REJECTED_NAMES = new Set(['UserRejectedRequestError', 'UserRejectedError']);

/** Every error in a viem or wagmi cause chain, outermost first. */
function chainOf(error: unknown): unknown[] {
  const seen: unknown[] = [];
  let current: unknown = error;
  while (current !== undefined && current !== null && !seen.includes(current) && seen.length < 8) {
    seen.push(current);
    current = typeof current === 'object' && 'cause' in current ? (current as { cause?: unknown }).cause : undefined;
  }
  return seen;
}

function field(error: unknown, key: string): unknown {
  return typeof error === 'object' && error !== null && key in error ? (error as Record<string, unknown>)[key] : undefined;
}

export function walletProblem(error: unknown): WalletProblem {
  for (const link of chainOf(error)) {
    if (link instanceof WalletSignerError) {
      if (link.code === 'CONTRACT_WALLET') return { kind: 'CONTRACT_WALLET', address: link.address };
      if (link.code === 'WRONG_OWNER') return { kind: 'WRONG_OWNER', selected: link.address };
      return { kind: 'SIGNATURE_MISMATCH', address: link.address };
    }
    if (isDataLayerError(link) && link.detail.code === 'WrongWallet') return { kind: 'WRONG_OWNER', selected: link.detail.connected };
    if (isDataLayerError(link) && link.code === 'WalletRejected') return { kind: 'REJECTED' };
    if (isDataLayerError(link) && link.code === 'SponsorshipUnavailable') return { kind: 'SPONSORSHIP' };
    const name = field(link, 'name');
    if (typeof name === 'string' && REJECTED_NAMES.has(name)) return { kind: 'REJECTED' };
    if (field(link, 'code') === 4001) return { kind: 'REJECTED' };
    if (name === 'ConnectorChainMismatchError' || name === 'ChainMismatchError') return { kind: 'CHAIN' };
    const message = field(link, 'message');
    if (typeof message === 'string' && /\bAA10\b/.test(message)) return { kind: 'ALREADY_DEPLOYED' };
  }
  return { kind: 'UNKNOWN' };
}

/** The plain line for a wallet failure. `owner` is the wallet that owns the account, for a wrong selection. */
export function walletProblemText(problem: WalletProblem, owner?: Address): string {
  switch (problem.kind) {
    case 'REJECTED':
      return 'You declined the request in your wallet. Nothing was signed and nothing moved.';
    case 'CONTRACT_WALLET':
      return CONTRACT_WALLET_LINE;
    case 'WRONG_OWNER':
      return owner === undefined
        ? `Your wallet has ${shortAddress(problem.selected)} selected, which is not the wallet you chose. Switch back in your wallet to continue.`
        : `Your wallet has ${shortAddress(problem.selected)} selected. Switch to ${shortAddress(owner)} in your wallet to continue.`;
    case 'SIGNATURE_MISMATCH':
      return `The signature did not come from ${shortAddress(problem.address)}. Use a wallet that signs with its own key.`;
    case 'SPONSORSHIP':
      return 'Sleeve could not cover the network fee for this step right now. Nothing moved. Try again in a few minutes.';
    case 'ALREADY_DEPLOYED':
      return 'Someone set up this address a moment ago. Nothing is lost: send the step again and it goes through without the setup part.';
    case 'CHAIN':
      return 'Your wallet is on another network. Switch it to Robinhood Chain to continue.';
    case 'UNKNOWN':
      return 'The wallet did not finish the request. Nothing moved. Try again.';
  }
}

/**
 * A wallet connection on a product page that did not finish, as one line (D-041): another account selected, named by
 * the owner's short address, a declined request, wallet code that did not load, or anything else.
 */
export function walletConnectFailureText(error: unknown): string {
  for (const link of chainOf(error)) {
    if (isDataLayerError(link) && link.detail.code === 'WrongWallet') {
      return walletProblemText({ kind: 'WRONG_OWNER', selected: link.detail.connected }, link.detail.owner);
    }
    if (field(link, 'name') === 'ChunkLoadError') {
      return 'Sleeve could not load what it needs to connect a wallet. Check your connection, then try again.';
    }
  }
  const problem = walletProblem(error);
  return problem.kind === 'UNKNOWN' ? 'Your wallet did not connect. Try again in a moment.' : walletProblemText(problem);
}

/**
 * A wallet's own failure while it signs an owner op, as one line: declined, another account selected, or another
 * network. Null for any other failure, which the screen words itself (D-041).
 */
export function walletSigningFailureText(error: unknown): string | null {
  const problem = walletProblem(error);
  switch (problem.kind) {
    case 'REJECTED':
      return 'You declined the request in your wallet, so nothing was signed.';
    case 'WRONG_OWNER':
      return `Your wallet has ${shortAddress(problem.selected)} selected, which does not own this account. Switch back in your wallet, then try again.`;
    case 'CHAIN':
      return 'Your wallet is on another network. Switch it to Robinhood Chain, then try again.';
    default:
      return null;
  }
}
