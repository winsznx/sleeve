import { CHAIN_ID } from '@sleeve/core';
import { getEntryPoint, KERNEL_V3_1 } from '@zerodev/sdk/constants';
import type { KernelValidator } from '@zerodev/sdk/types';
import {
  bytesToHex,
  encodeAbiParameters,
  hashTypedData,
  isHex,
  keccak256,
  type Hex,
  type SignableMessage,
  type TypedDataDefinition,
} from 'viem';
import { getUserOperationHash, type UserOperation } from 'viem/account-abstraction';
import { toAccount } from 'viem/accounts';

import { WEBAUTHN_VALIDATOR } from './kernel';
import { STUB_WEBAUTHN_SIGNATURE, fromBase64Url, type P256PublicKey } from './webauthn';

/**
 * ZeroDev's passkey validator for a Kernel v3.1 account, as @zerodev/passkey-validator 5.6.0 builds it, with the two
 * changes zerodev-passkey.md section 8 makes for 4663: the relying party id is Sleeve's own, and every signature sets
 * usePrecompiled (the RIP-7212 precompile costs about 66,000 gas per op where the Solidity verifier costs 404,000).
 * Built here rather than taken from the package because the package's own signer cannot do either.
 */

export interface PasskeyOwner {
  /** base64url credential id. */
  credentialId: string;
  publicKey: P256PublicKey;
  /** One WebAuthn assertion over a 32-byte challenge, encoded for the validator (./webauthn signWithPasskey). */
  sign(challenge: Hex): Promise<Hex>;
}

const ENTRY_POINT = getEntryPoint('0.7');

/** keccak256 of the credential id's bytes, as ZeroDev's toWebAuthnKey computes it. Part of the account address. */
export function authenticatorIdHash(credentialId: string): Hex {
  return keccak256(fromBase64Url(credentialId));
}

/** What the validator's onInstall decodes: ((x, y), authenticatorIdHash). */
export function webAuthnEnableData(owner: Pick<PasskeyOwner, 'credentialId' | 'publicKey'>): Hex {
  return encodeAbiParameters(
    [
      {
        components: [
          { name: 'x', type: 'uint256' },
          { name: 'y', type: 'uint256' },
        ],
        name: 'webAuthnData',
        type: 'tuple',
      },
      { name: 'authenticatorIdHash', type: 'bytes32' },
    ],
    [{ x: owner.publicKey.x, y: owner.publicKey.y }, authenticatorIdHash(owner.credentialId)],
  );
}

/** The 32 bytes a message stands for. Kernel hands its validator raw hashes, wrapped in its own EIP-712 domain. */
function challengeOf(message: SignableMessage): Hex {
  if (typeof message === 'string') {
    if (isHex(message)) return message;
    throw new Error('A passkey signs only raw hashes');
  }
  return typeof message.raw === 'string' ? message.raw : bytesToHex(message.raw);
}

export function toSleevePasskeyValidator(owner: PasskeyOwner): KernelValidator<'WebAuthnValidator'> {
  const account = toAccount({
    // The SDK replaces this with the Kernel account's own address.
    address: '0x0000000000000000000000000000000000000000',
    async signMessage({ message }) {
      return owner.sign(challengeOf(message));
    },
    async signTransaction() {
      throw new Error('A smart account signer never signs transactions');
    },
    async signTypedData(typedData) {
      return owner.sign(hashTypedData(typedData as TypedDataDefinition));
    },
  });

  return {
    ...account,
    source: 'WebAuthnValidator',
    supportedKernelVersions: KERNEL_V3_1,
    validatorType: 'SECONDARY',
    address: WEBAUTHN_VALIDATOR,
    getIdentifier: () => WEBAUTHN_VALIDATOR,
    getEnableData: async () => webAuthnEnableData(owner),
    getNonceKey: async (_accountAddress, customNonceKey) => customNonceKey ?? 0n,
    getStubSignature: async () => STUB_WEBAUTHN_SIGNATURE,
    async signUserOperation(userOperation) {
      const hash = getUserOperationHash({
        userOperation: { ...userOperation, signature: '0x' } as UserOperation<'0.7'>,
        entryPointAddress: ENTRY_POINT.address,
        entryPointVersion: ENTRY_POINT.version,
        chainId: userOperation.chainId ?? CHAIN_ID,
      });
      return owner.sign(hash);
    },
    isEnabled: async () => false,
  };
}
