import { sleeveModuleAbi } from '@sleeve/core';
import { signerToEcdsaValidator } from '@zerodev/ecdsa-validator';
import { createKernelAccount } from '@zerodev/sdk';
import { getEntryPoint, KERNEL_V3_1 } from '@zerodev/sdk/constants';
import {
  hashTypedData,
  isAddressEqual,
  zeroAddress,
  type Address,
  type Hex,
  type LocalAccount,
  type PublicClient,
  type TypedDataDefinition,
} from 'viem';
import { toAccount } from 'viem/accounts';

import {
  ECDSA_VALIDATOR,
  MODULE_TYPE_EXECUTOR,
  MODULE_TYPE_VALIDATOR,
  SLEEVE_ACCOUNT_INDEX,
  ecdsaValidatorAbi,
  kernelAbi,
} from '@/lib/chain/kernel';
import { toSleevePasskeyValidator, type PasskeyOwner } from '@/lib/chain/passkey-validator';

import { DataLayerError } from '../errors';
import { CONTRACTS } from './context';

/**
 * Kernel v3.1 accounts on EntryPoint 0.7 (D-019, D-022): a passkey owner through ZeroDev's passkey validator, or a
 * plain-key wallet as the ECDSA root with the Sleeve salt. Neither carries initConfig, so the address commits to the
 * owner only, and the module goes in with the first UserOp's callData.
 */

export type KernelOwner =
  | ({ kind: 'passkey' } & PasskeyOwner)
  | { kind: 'wallet'; address: Address; signHash: (hash: Hex) => Promise<Hex> }
  /** A local key: tests and scripts against a fork. */
  | { kind: 'local'; account: LocalAccount };

export type SleeveKernelAccount = Awaited<ReturnType<typeof createKernelAccount<'0.7', typeof KERNEL_V3_1>>>;

const ENTRY_POINT = getEntryPoint('0.7');

/** A wallet signer the ECDSA validator can use: personal_sign over the UserOp hash, one prompt per op. */
function walletAccount(owner: Extract<KernelOwner, { kind: 'wallet' }>): LocalAccount {
  return toAccount({
    address: owner.address,
    async signMessage({ message }) {
      if (typeof message === 'string' || typeof message.raw !== 'string') {
        throw new Error('A wallet owner signs only raw 32-byte hashes for Sleeve');
      }
      return owner.signHash(message.raw);
    },
    async signTransaction() {
      throw new Error('A smart account signer never signs transactions');
    },
    // Kernel wraps an ERC-1271 hash in its own EIP-712 domain; the ECDSA validator accepts a personal signature over
    // that typed-data hash as well as a raw one, so the wallet is only ever asked to sign 32 bytes.
    async signTypedData(typedData) {
      return owner.signHash(hashTypedData(typedData as TypedDataDefinition));
    },
  });
}

/** The account the owner controls, counterfactual until its first UserOp deploys it. */
export async function kernelAccountFor(
  client: PublicClient,
  owner: KernelOwner,
  knownAddress?: Address,
): Promise<SleeveKernelAccount> {
  if (owner.kind === 'passkey') {
    return createKernelAccount(client, {
      plugins: { sudo: toSleevePasskeyValidator(owner) },
      entryPoint: ENTRY_POINT,
      kernelVersion: KERNEL_V3_1,
      address: knownAddress,
    });
  }
  const signer = owner.kind === 'wallet' ? walletAccount(owner) : owner.account;
  const sudo = await signerToEcdsaValidator(client, { signer, entryPoint: ENTRY_POINT, kernelVersion: KERNEL_V3_1 });
  if (!isAddressEqual(sudo.address, ECDSA_VALIDATOR)) {
    throw new DataLayerError({ code: 'SourceUnavailable' }, `The SDK chose ECDSA validator ${sudo.address}, not ${ECDSA_VALIDATOR}`);
  }
  return createKernelAccount(client, {
    plugins: { sudo },
    entryPoint: ENTRY_POINT,
    kernelVersion: KERNEL_V3_1,
    index: SLEEVE_ACCOUNT_INDEX,
    address: knownAddress,
  });
}

export interface InstallState {
  deployed: boolean;
  /** SleeveModule.isInitialized(account). */
  initialized: boolean;
  /** Kernel.isModuleInstalled(2, module, 0x). */
  listed: boolean;
}

/** D-019: the payment address is shown only when both views say the module is in. */
export async function readInstallState(client: PublicClient, account: Address): Promise<InstallState> {
  const code = await client.getCode({ address: account });
  const deployed = code !== undefined && code !== '0x';
  if (!deployed) return { deployed, initialized: false, listed: false };
  const [initialized, listed] = await client.multicall({
    allowFailure: false,
    contracts: [
      { address: CONTRACTS.module, abi: sleeveModuleAbi, functionName: 'isInitialized', args: [account] },
      { address: account, abi: kernelAbi, functionName: 'isModuleInstalled', args: [MODULE_TYPE_EXECUTOR, CONTRACTS.module, '0x'] },
    ],
  });
  return { deployed, initialized, listed };
}

/** A recovery wallet is in when the ECDSA validator holds it for the account and Kernel lists the validator. */
export async function readRecoverySigner(client: PublicClient, account: Address): Promise<Address | null> {
  const [owner, listed] = await client.multicall({
    allowFailure: false,
    contracts: [
      { address: ECDSA_VALIDATOR, abi: ecdsaValidatorAbi, functionName: 'ecdsaValidatorStorage', args: [account] },
      { address: account, abi: kernelAbi, functionName: 'isModuleInstalled', args: [MODULE_TYPE_VALIDATOR, ECDSA_VALIDATOR, '0x'] },
    ],
  });
  return listed && !isAddressEqual(owner, zeroAddress) ? owner : null;
}
