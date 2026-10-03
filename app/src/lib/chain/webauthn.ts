import { bytesToBigInt, bytesToHex, encodeAbiParameters, hexToBytes, type Hex } from 'viem';

/**
 * Sleeve's own WebAuthn ceremonies for the Kernel passkey validator (docs/research/zerodev-passkey.md 6.4 and 8): the
 * relying party id is pinned in Sleeve's code, no passkey server runs, and the public key is kept by Sleeve because an
 * assertion never carries it. Signatures are encoded the way ZeroDev's validator 0.0.3 decodes them, with
 * usePrecompiled true: the RIP-7212 precompile is live on 4663, where the SDK's chain list still says otherwise and
 * would send every op through the 350,000 gas Solidity verifier (zerodev-passkey.md 4).
 */

/** ES256: ECDSA over P-256 with SHA-256. */
export const ES256 = -7;
const TIMEOUT_MS = 120_000;

/** The order of P-256. The validator refuses s above half of it. */
export const P256_N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

/** DER SubjectPublicKeyInfo header of an uncompressed P-256 key: id-ecPublicKey, prime256v1, then the bit string. */
const P256_SPKI_PREFIX = hexToBytes('0x3059301306072a8648ce3d020106082a8648ce3d030107034200');

export interface P256PublicKey {
  x: bigint;
  y: bigint;
}

export interface RegisteredPasskey {
  /** base64url rawId. */
  credentialId: string;
  rpId: string;
  publicKey: P256PublicKey;
}

/** Why a ceremony could not finish, before the data layer names it. */
export class WebAuthnFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebAuthnFormatError';
  }
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=');
  const binary = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index);
  return out;
}

/** x and y of a P-256 key from its DER SubjectPublicKeyInfo, as getPublicKey() gives it. */
export function p256KeyFromSpki(spki: Uint8Array): P256PublicKey {
  const prefixMatches = spki.length === P256_SPKI_PREFIX.length + 65 && P256_SPKI_PREFIX.every((byte, i) => spki[i] === byte);
  if (!prefixMatches || spki[P256_SPKI_PREFIX.length] !== 0x04) {
    throw new WebAuthnFormatError('The passkey did not give an uncompressed P-256 public key');
  }
  const point = spki.slice(P256_SPKI_PREFIX.length + 1);
  return { x: bytesToBigInt(point.slice(0, 32)), y: bytesToBigInt(point.slice(32, 64)) };
}

/** SEC1 uncompressed form, 0x04 then x and y as 32 bytes each, as passkey records store it. */
export function encodePublicKey(key: P256PublicKey): Hex {
  return `0x04${key.x.toString(16).padStart(64, '0')}${key.y.toString(16).padStart(64, '0')}`;
}

export function decodePublicKey(hex: string): P256PublicKey {
  if (!/^0x04[0-9a-fA-F]{128}$/.test(hex)) throw new WebAuthnFormatError('A stored passkey key is not 0x04 followed by x and y');
  return { x: BigInt(`0x${hex.slice(4, 68)}`), y: BigInt(`0x${hex.slice(68)}`) };
}

function readLength(der: Uint8Array, at: number): { length: number; next: number } {
  const first = der[at];
  if (first === undefined) throw new WebAuthnFormatError('The signature ended early');
  if (first < 0x80) return { length: first, next: at + 1 };
  const count = first & 0x7f;
  let length = 0;
  for (let index = 1; index <= count; index += 1) length = (length << 8) | (der[at + index] ?? 0);
  return { length, next: at + 1 + count };
}

function readInteger(der: Uint8Array, at: number): { value: bigint; next: number } {
  if (der[at] !== 0x02) throw new WebAuthnFormatError('The signature is not two DER integers');
  const { length, next } = readLength(der, at + 1);
  if (length === 0 || next + length > der.length) throw new WebAuthnFormatError('A DER integer has a bad length');
  return { value: bytesToBigInt(der.slice(next, next + length)), next: next + length };
}

/**
 * r and s of a DER ECDSA signature, with s brought to the lower half of the curve order: the validator refuses a
 * high s, and n - s verifies the same message. Integers of any DER length are read, leading zeros and all.
 */
export function parseDerSignature(der: Uint8Array): { r: bigint; s: bigint } {
  if (der[0] !== 0x30) throw new WebAuthnFormatError('The signature is not a DER sequence');
  const { next } = readLength(der, 1);
  const r = readInteger(der, next);
  const s = readInteger(der, r.next);
  if (r.value === 0n || s.value === 0n || r.value >= P256_N || s.value >= P256_N) {
    throw new WebAuthnFormatError('The signature values are out of range');
  }
  return { r: r.value, s: s.value > P256_N / 2n ? P256_N - s.value : s.value };
}

/** Where the validator looks for "type":"webauthn.get" in clientDataJSON, as ZeroDev's findQuoteIndices finds it. */
export function responseTypeLocation(clientDataJSON: string): bigint {
  const index = clientDataJSON.lastIndexOf('"type":"webauthn.get"');
  if (index < 0) throw new WebAuthnFormatError('clientDataJSON has no webauthn.get type');
  return BigInt(index);
}

export interface WebAuthnAssertion {
  authenticatorData: Hex;
  clientDataJSON: string;
  r: bigint;
  s: bigint;
}

/** abi.encode of what WebAuthnValidator.validateUserOp and isValidSignatureWithSender decode. */
export function encodeWebAuthnSignature(assertion: WebAuthnAssertion, usePrecompiled = true): Hex {
  return encodeAbiParameters(
    [
      { name: 'authenticatorData', type: 'bytes' },
      { name: 'clientDataJSON', type: 'string' },
      { name: 'responseTypeLocation', type: 'uint256' },
      { name: 'r', type: 'uint256' },
      { name: 's', type: 'uint256' },
      { name: 'usePrecompiled', type: 'bool' },
    ],
    [
      assertion.authenticatorData,
      assertion.clientDataJSON,
      responseTypeLocation(assertion.clientDataJSON),
      assertion.r,
      assertion.s,
      usePrecompiled,
    ],
  );
}

/**
 * A signature of the right shape for gas estimation, from ZeroDev's validator package, with usePrecompiled true so the
 * estimate follows the path real signatures take. Its clientDataJSON carries the extra key some browsers add, so the
 * calldata estimate covers the longest assertion.
 */
export const STUB_WEBAUTHN_SIGNATURE: Hex = encodeWebAuthnSignature({
  authenticatorData: '0x49960de5880e8c687434170f6476605b8fe4aeb9a28632c7995cf3ba831d97631d00000000',
  clientDataJSON:
    '{"type":"webauthn.get","challenge":"tbxXNFS9X_4Byr1cMwqKrIGB-_30a0QhZ6y7ucM0BOE","origin":"http://localhost:3000","crossOrigin":false, "other_keys_can_be_added_here":"do not compare clientDataJSON against a template. See https://goo.gl/yabPex"}',
  r: 44941127272049826721201904734628716258498742255959991581049806490182030242267n,
  s: 9910254599581058084911561569808925251374718953855182016200087235935345969636n,
});

function assertWebAuthn(): void {
  const usable =
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    typeof window.PublicKeyCredential === 'function' &&
    typeof navigator.credentials?.create === 'function';
  if (!usable) throw new DOMException('This browser cannot use a passkey on this page', 'NotSupportedError');
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(length));
  crypto.getRandomValues(out);
  return out;
}

/** navigator.credentials.create for Sleeve's relying party, keeping the P-256 public key the validator installs. */
export async function registerPasskey(rpId: string): Promise<RegisteredPasskey> {
  assertWebAuthn();
  const credential = await navigator.credentials.create({
    publicKey: {
      rp: { id: rpId, name: 'Sleeve' },
      user: { id: randomBytes(16), name: 'Sleeve account', displayName: 'Sleeve account' },
      challenge: randomBytes(32),
      pubKeyCredParams: [{ type: 'public-key', alg: ES256 }],
      authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
      attestation: 'none',
      timeout: TIMEOUT_MS,
    },
  });
  if (!(credential instanceof PublicKeyCredential)) throw new DOMException('No passkey came back', 'NotAllowedError');
  const response = credential.response as AuthenticatorAttestationResponse;
  if (typeof response.getPublicKeyAlgorithm === 'function' && response.getPublicKeyAlgorithm() !== ES256) {
    throw new WebAuthnFormatError('The passkey is not a P-256 key');
  }
  const spki = typeof response.getPublicKey === 'function' ? response.getPublicKey() : null;
  if (spki === null) throw new WebAuthnFormatError('This browser does not give the passkey public key');
  return {
    credentialId: toBase64Url(new Uint8Array(credential.rawId)),
    rpId,
    publicKey: p256KeyFromSpki(new Uint8Array(spki)),
  };
}

/** A sign-in on any device where the passkey has synced: the credential id, chosen by the person. */
export async function discoverPasskey(rpId: string): Promise<string> {
  assertWebAuthn();
  const credential = await navigator.credentials.get({
    publicKey: { rpId, challenge: randomBytes(32), userVerification: 'required', timeout: TIMEOUT_MS },
  });
  if (!(credential instanceof PublicKeyCredential)) throw new DOMException('No passkey came back', 'NotAllowedError');
  return toBase64Url(new Uint8Array(credential.rawId));
}

/** One assertion over a 32-byte challenge, encoded for the validator. */
export async function signWithPasskey(rpId: string, credentialId: string, challenge: Hex): Promise<Hex> {
  assertWebAuthn();
  const credential = await navigator.credentials.get({
    publicKey: {
      rpId,
      challenge: new Uint8Array(hexToBytes(challenge)),
      allowCredentials: [{ type: 'public-key', id: fromBase64Url(credentialId) }],
      userVerification: 'required',
      timeout: TIMEOUT_MS,
    },
  });
  if (!(credential instanceof PublicKeyCredential)) throw new DOMException('No passkey came back', 'NotAllowedError');
  const response = credential.response as AuthenticatorAssertionResponse;
  const { r, s } = parseDerSignature(new Uint8Array(response.signature));
  return encodeWebAuthnSignature({
    authenticatorData: bytesToHex(new Uint8Array(response.authenticatorData)),
    clientDataJSON: new TextDecoder().decode(response.clientDataJSON),
    r,
    s,
  });
}
