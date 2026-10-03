/**
 * The wallet-owned account's encodings, shared with the chain data layer (lib/chain/kernel): the Sleeve salt, the
 * module install call and its 224-byte data, and the recovery signer install. The account itself is built, deployed
 * and read back by the data layer (data/chain/accounts.ts), so screens never touch the ZeroDev SDK.
 */
export {
  ECDSA_VALIDATOR,
  SLEEVE_ACCOUNT_INDEX,
  installRecoverySignerCall,
  installSleeveModuleCall,
  sleeveInstallData,
} from '@/lib/chain/kernel';

// The light checks live in ./wallet-checks so onboarding can run them without loading the ZeroDev SDK.
export {
  assertNotContractWallet,
  assertWalletIsOwner,
  proveEcdsaKey,
  WalletSignerError,
  type ConnectedWallet,
} from './wallet-checks';
