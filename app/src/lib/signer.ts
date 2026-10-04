import type { Address } from '@sleeve/core';

import type { Session, SignerKind } from '@/data/types';

/**
 * How the owner signs, and the words each signer gets (D-003, D-022). A wallet session carries no passkey credential,
 * which is how the shell tells the two apart too.
 */

export function signerKindOf(session: Pick<Session, 'credentialId'> | null | undefined): SignerKind {
  return session !== null && session !== undefined && session.credentialId === '' ? 'wallet' : 'passkey';
}

/**
 * The wallet a session must connect in this tab before it can sign, or null when nothing needs connecting: no
 * session, a passkey session, or a wallet already attached (D-041).
 */
export function walletToConnect(session: Pick<Session, 'wallet'> | null | undefined): Address | null {
  const wallet = session?.wallet ?? null;
  return wallet === null || wallet.attached ? null : wallet.owner;
}

/** Before an owner op: what the signer will ask, and why it is safe to approve. */
export function signerApprovalLine(signer: SignerKind): string {
  return signer === 'passkey'
    ? "Your passkey will ask you to approve this. It signs only on Sleeve's site."
    : 'Your wallet will ask you to sign a long code. That code stands for this action and works only on Robinhood Chain.';
}

/** The passkey line onboarding shows next to the choice (D-003). */
export const PASSKEY_SITE_LINE =
  "A passkey works only on Sleeve's site, so no other page can sign with it. Your face, fingerprint or screen lock unlocks it.";

/** D-022 and PRD 7.2, word for word from docs/research/wallet-connect.md section 12. */
export const WALLET_OWNER_LINE =
  'Your wallet will own this Sleeve account. It can also act on the account directly, outside Sleeve. Sleeve keeps exact records only for actions you take in Sleeve. Money that an outside action brings into the account can look like a payment, and Sleeve would split it.';

/**
 * The accounting limit at passkey setup (docs/CLAIM_LEDGER.md 3.3). A passkey signs only on Sleeve's site, so the
 * one signer that can act outside Sleeve is a recovery wallet.
 */
export const PASSKEY_RECORDS_LINE =
  'Sleeve keeps exact records for every action you take in Sleeve. An action signed outside Sleeve, such as one from a recovery wallet, can make your own USDG look like a payment, and Sleeve would split it.';

/** What a recovery wallet can do, and that Sleeve does not record its actions as the owner's (CLAIM_LEDGER.md 4.6). */
export const RECOVERY_WALLET_LINE =
  'A recovery wallet can use this account without Sleeve and without your passkey, including moving everything in it. Its actions happen outside Sleeve, so USDG it moves into the account can look like a payment, and Sleeve would split it. Add only a wallet you control and keep safe.';

export const NO_RECOVERY_LINE =
  'Without a recovery wallet, this passkey is the only way into the account. If you lose it, nobody can move what is in the account, Sleeve included.';

export const CONTRACT_WALLET_LINE =
  'This is a smart contract wallet. Sleeve needs a wallet that signs with its own key, such as MetaMask, Rabby, Rainbow, Trust or Coinbase Wallet.';
