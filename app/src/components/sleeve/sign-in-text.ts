import { walletConnectFailureText, walletProblem } from '@/components/wallet/wallet-problems';
import { isDataLayerError } from '@/data/errors';

/**
 * The words for a sign in that did not go through (D-041). A passkey that finds no Sleeve account points to wallet
 * sign in, for owners who set up with a wallet, and a wallet that owns no account points to setting one up.
 */

/** Why a passkey sign in failed. A closed prompt and a device without the passkey look the same to the page. */
export function passkeySignInText(error: Error): string {
  if (isDataLayerError(error)) {
    switch (error.code) {
      case 'PasskeyCancelled':
        return 'Your passkey did not sign you in. Try again, or sign in with a wallet if you set up Sleeve with one.';
      case 'NotFound':
      case 'NotInstalled':
        return 'Sleeve has no account for this passkey. If you set up Sleeve with a wallet, sign in with that wallet.';
      case 'PasskeyUnavailable':
        return 'Your passkey could not be used here. If you set up Sleeve with a wallet, sign in with that wallet.';
      default:
        break;
    }
  }
  return 'Sign in did not go through. Try again in a moment.';
}

/** The wallet owns no Sleeve account, which setting one up answers. */
export function walletHasNoAccount(error: Error): boolean {
  return isDataLayerError(error) && error.code === 'NotFound';
}

/** Why a wallet sign in failed. */
export function walletSignInText(error: Error): string {
  if (walletHasNoAccount(error)) {
    return 'This wallet has no Sleeve account. Set one up with it, or sign in with your passkey if you made one for Sleeve.';
  }
  if (isDataLayerError(error) && error.code === 'SourceUnavailable' && walletProblem(error).kind === 'UNKNOWN') {
    return 'Sleeve could not reach Robinhood Chain to find your account. Try again in a moment.';
  }
  return walletConnectFailureText(error);
}
