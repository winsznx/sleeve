import {
  type Account,
  type Address,
  type Chain,
  type PublicClient,
  type Transport,
  type WalletClient,
  getAddress,
  isAddressEqual,
  recoverMessageAddress,
} from 'viem';

import { robinhoodChain } from './chain';

/**
 * The wallet checks of docs/research/wallet-connect.md section 12, apart from the ZeroDev account code in
 * ./wallet-account so onboarding can run them without loading the SDK. Nothing here writes to chain.
 */

/** What wagmi's useWalletClient returns once the wallet is connected on Robinhood Chain. */
export type ConnectedWallet = WalletClient<Transport, Chain, Account>;

export class WalletSignerError extends Error {
  constructor(
    readonly code: 'CONTRACT_WALLET' | 'SIGNATURE_MISMATCH' | 'WRONG_OWNER',
    readonly address: Address,
  ) {
    super(code);
  }
}

/**
 * The Kernel ECDSA validator recovers a plain ECDSA signature (raw or EIP-191) and nothing else. A contract wallet
 * (Safe, Argent, a deployed smart wallet) signs through ERC-1271 and can never own or recover a Kernel account.
 * Code 0xef0100... is an EIP-7702 delegation, still an EOA key.
 */
export async function assertNotContractWallet(publicClient: PublicClient, address: Address): Promise<void> {
  const code = await publicClient.getCode({ address });
  if (code !== undefined && code !== '0x' && !code.startsWith('0xef0100')) {
    throw new WalletSignerError('CONTRACT_WALLET', address);
  }
}

/**
 * Before every owner op of a wallet-owned account. Wallets let people switch accounts at any time, and a signature
 * from another address fails validation (AA24) after the user has already approved it.
 */
export function assertWalletIsOwner(wallet: ConnectedWallet, owner: Address): void {
  if (!isAddressEqual(wallet.account.address, owner)) throw new WalletSignerError('WRONG_OWNER', wallet.account.address);
}

/**
 * Proof the wallet signs with its own key, required before it becomes a recovery signer: a wrong recovery key fails
 * silently until the day it is needed. One message, recovered locally; nothing is sent to chain.
 */
export async function proveEcdsaKey(wallet: ConnectedWallet, sleeveAccount: Address): Promise<Address> {
  const address = getAddress(wallet.account.address);
  const message = `Sleeve recovery signer\nWallet: ${address}\nSleeve account: ${sleeveAccount}\nChain: ${robinhoodChain.id}`;
  const signature = await wallet.signMessage({ account: wallet.account, message });
  const recovered = await recoverMessageAddress({ message, signature });
  if (!isAddressEqual(recovered, address)) throw new WalletSignerError('SIGNATURE_MISMATCH', address);
  return address;
}


/**
 * The same proof before an account exists, as onboarding asks for it: the recovery wallet signs one plain message that
 * names it and the chain, and the signature is recovered here. Nothing is sent anywhere and nothing moves.
 */
export async function proveWalletKey(wallet: ConnectedWallet): Promise<Address> {
  const address = getAddress(wallet.account.address);
  const message = `Sleeve recovery wallet\nWallet: ${address}\nChain: ${robinhoodChain.id}\nThis proves the wallet signs with its own key. It moves nothing.`;
  const signature = await wallet.signMessage({ account: wallet.account, message });
  const recovered = await recoverMessageAddress({ message, signature });
  if (!isAddressEqual(recovered, address)) throw new WalletSignerError('SIGNATURE_MISMATCH', address);
  return address;
}
