import { signerToEcdsaValidator } from '@zerodev/ecdsa-validator';
import { createKernelAccount, createKernelAccountClient, createZeroDevPaymasterClient } from '@zerodev/sdk';
import { getEntryPoint, KERNEL_V3_1 } from '@zerodev/sdk/constants';
import {
  type Address,
  type Hex,
  type PublicClient,
  concatHex,
  encodeAbiParameters,
  encodeFunctionData,
  http,
  isAddressEqual,
  keccak256,
  parseAbiParameters,
  stringToBytes,
  zeroAddress,
} from 'viem';

import { robinhoodChain } from './chain';
import { assertNotContractWallet, type ConnectedWallet } from './wallet-checks';

// The light checks live in ./wallet-checks so onboarding can run them without loading the ZeroDev SDK.
export {
  assertNotContractWallet,
  assertWalletIsOwner,
  proveEcdsaKey,
  WalletSignerError,
  type ConnectedWallet,
} from './wallet-checks';

const ENTRY_POINT = getEntryPoint('0.7');
const KERNEL_VERSION = KERNEL_V3_1;
/** ZeroDev's ECDSA validator for Kernel 0.3.1 and later, deployed on 4663 (zerodev-passkey.md 2 and 3.1). */
export const ECDSA_VALIDATOR: Address = '0x845ADb2C711129d4f3966735eD98a9F09fC4cE57';
const MODULE_TYPE_VALIDATOR = 1n;
const MODULE_TYPE_EXECUTOR = 2n;
const KERNEL_EXECUTE_SELECTOR: Hex = '0xe9ae5c53';

/**
 * The CREATE2 salt of every wallet-owned Sleeve account. Without initConfig (D-019) the address commits only to the
 * owner and this salt, so the SDK default of 0 is the address every other ZeroDev Kernel v3.1 app gives the same
 * wallet. A Sleeve salt keeps a fresh account. It is part of every address: final before the first real user.
 */
export const SLEEVE_ACCOUNT_INDEX = BigInt(keccak256(stringToBytes('sleeve.wallet-account.v1')));

// JSON ABIs: human-readable ones need the word "returns", which copy-lint reads as a performance claim.
const moduleArgs = [
  { name: 'moduleType', type: 'uint256' },
  { name: 'module', type: 'address' },
] as const;
const kernelAbi = [
  {
    type: 'function',
    name: 'installModule',
    stateMutability: 'payable',
    inputs: [...moduleArgs, { name: 'initData', type: 'bytes' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'isModuleInstalled',
    stateMutability: 'view',
    inputs: [...moduleArgs, { name: 'additionalContext', type: 'bytes' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;
const sleeveModuleAbi = [
  {
    type: 'function',
    name: 'isInitialized',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;
const ecdsaValidatorAbi = [
  {
    type: 'function',
    name: 'ecdsaValidatorStorage',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: 'owner', type: 'address' }],
  },
] as const;

type Call = { to: Address; value: bigint; data: Hex };

/**
 * A Kernel v3.1 account whose root signer is the connected wallet. No initConfig: per D-019 the address commits to
 * the owner and the salt only, and the module goes in with the first UserOp's callData.
 */
export async function buildWalletOwnedAccount(publicClient: PublicClient, wallet: ConnectedWallet) {
  await assertNotContractWallet(publicClient, wallet.account.address);
  const sudo = await signerToEcdsaValidator(publicClient, {
    signer: wallet,
    entryPoint: ENTRY_POINT,
    kernelVersion: KERNEL_VERSION,
  });
  if (!isAddressEqual(sudo.address, ECDSA_VALIDATOR)) throw new Error(`unexpected ECDSA validator ${sudo.address}`);
  return createKernelAccount(publicClient, {
    plugins: { sudo },
    entryPoint: ENTRY_POINT,
    kernelVersion: KERNEL_VERSION,
    index: SLEEVE_ACCOUNT_INDEX,
  });
}

export type WalletOwnedAccount = Awaited<ReturnType<typeof buildWalletOwnedAccount>>;

/** Sponsored client for one account. zeroDevRpc is https://rpc.zerodev.app/api/v3/<projectId>/chain/4663. */
export function walletAccountClient(account: WalletOwnedAccount, publicClient: PublicClient, zeroDevRpc: string) {
  const paymaster = createZeroDevPaymasterClient({ chain: robinhoodChain, transport: http(zeroDevRpc) });
  return createKernelAccountClient({
    account,
    chain: robinhoodChain,
    client: publicClient,
    bundlerTransport: http(zeroDevRpc),
    paymaster: { getPaymasterData: (userOperation) => paymaster.sponsorUserOperation({ userOperation }) },
  });
}

export type RuleInput = {
  spendBps: number;
  equityBps: number;
  tickerId: number;
  premiumCapBps: number;
  slippageBps: number;
  minClip: bigint;
};

/** SleeveModule.onInstall data, abi.encode(keeper, RuleInput) (SPEC 6). A zero keeper selects the default keeper. */
export const sleeveInstallData = (keeper: Address, rule: RuleInput): Hex =>
  encodeAbiParameters(
    parseAbiParameters(
      'address keeper, (uint16 spendBps, uint16 equityBps, uint8 tickerId, uint16 premiumCapBps, uint16 slippageBps, uint128 minClip) rule',
    ),
    [keeper, rule],
  );

/** Kernel v3.1 executor initData: no hook, then abi.encode(executorData, hookData), as KernelHelpers._executorInitData. */
const executorInitData = (moduleData: Hex): Hex =>
  concatHex([zeroAddress, encodeAbiParameters(parseAbiParameters('bytes executorData, bytes hookData'), [moduleData, '0x'])]);

/**
 * The account's call to itself that installs the module. As a single self-call the SDK sends this calldata as the
 * UserOp callData unwrapped, the shape of KernelHelpers._deployThenInstall (path (b), D-019). It is the one owner op
 * without brackets: beginOwnerOp needs the module installed, and the install snapshot books the balance (I5).
 */
export const installSleeveModuleCall = (account: Address, sleeveModule: Address, installData: Hex): Call => ({
  to: account,
  value: 0n,
  data: encodeFunctionData({
    abi: kernelAbi,
    functionName: 'installModule',
    args: [MODULE_TYPE_EXECUTOR, sleeveModule, executorInitData(installData)],
  }),
});

/** D-019: the address is shown only when both views say the module is in. */
export async function isSleeveInstalled(publicClient: PublicClient, account: Address, sleeveModule: Address) {
  const code = await publicClient.getCode({ address: account });
  if (code === undefined || code === '0x') return false;
  const [initialized, listed] = await Promise.all([
    publicClient.readContract({ address: sleeveModule, abi: sleeveModuleAbi, functionName: 'isInitialized', args: [account] }),
    publicClient.readContract({
      address: account,
      abi: kernelAbi,
      functionName: 'isModuleInstalled',
      args: [MODULE_TYPE_EXECUTOR, sleeveModule, '0x'],
    }),
  ]);
  return initialized && listed;
}

/** Any Kernel account client: the wallet-owned one above or the passkey one (zerodev-passkey.md 8). */
type SleeveOpClient = {
  account: { address: Address };
  sendUserOperation(args: { calls: readonly Call[] }): Promise<Hex>;
  waitForUserOperationReceipt(args: { hash: Hex }): Promise<unknown>;
};

/**
 * First UserOp: deploys the account (viem adds factory data while it has no code) and installs the module in the
 * execution phase. If someone deployed the address first, the same call goes without initCode. A reverted install
 * leaves the account deployed without the module (fork test), so success is the read-back, never the receipt.
 */
export async function deployAndInstall(
  client: SleeveOpClient,
  publicClient: PublicClient,
  sleeveModule: Address,
  installData: Hex,
): Promise<Address> {
  const account = client.account.address;
  if (await isSleeveInstalled(publicClient, account, sleeveModule)) return account;
  const hash = await client.sendUserOperation({ calls: [installSleeveModuleCall(account, sleeveModule, installData)] });
  await client.waitForUserOperationReceipt({ hash });
  if (!(await isSleeveInstalled(publicClient, account, sleeveModule))) {
    throw new Error(`Sleeve module is not installed on ${account} after UserOp ${hash}`);
  }
  return account;
}

/**
 * The connected wallet as recovery signer of a passkey account: ZeroDev's ECDSA validator as a secondary validator
 * allowed to call execute (zerodev-passkey.md 9.3). Send it inside a bracketed owner op signed by the passkey, after
 * proveEcdsaKey. The deployed validator reverts AlreadyInitialized on an account that already has an ECDSA owner,
 * so it cannot be added to a wallet-owned account, and changing it means uninstall then install.
 */
export const installRecoverySignerCall = (account: Address, recoveryOwner: Address): Call => ({
  to: account,
  value: 0n,
  data: encodeFunctionData({
    abi: kernelAbi,
    functionName: 'installModule',
    args: [
      MODULE_TYPE_VALIDATOR,
      ECDSA_VALIDATOR,
      concatHex([
        zeroAddress,
        encodeAbiParameters(parseAbiParameters('bytes validatorData, bytes hookData, bytes selectorData'), [
          recoveryOwner,
          '0x',
          KERNEL_EXECUTE_SELECTOR,
        ]),
      ]),
    ],
  }),
});

/** The ECDSA owner the validator holds for this account: the root wallet, or a passkey account's recovery wallet. */
export async function readEcdsaOwner(publicClient: PublicClient, account: Address): Promise<Address | null> {
  const owner = await publicClient.readContract({
    address: ECDSA_VALIDATOR,
    abi: ecdsaValidatorAbi,
    functionName: 'ecdsaValidatorStorage',
    args: [account],
  });
  return owner === zeroAddress ? null : owner;
}
