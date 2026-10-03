import { webcrypto } from 'node:crypto';

import { bytesToBigInt, bytesToHex, decodeAbiParameters, hexToBytes, keccak256 } from 'viem';
import { describe, expect, it } from 'vitest';

import { authenticatorIdHash, webAuthnEnableData } from './passkey-validator';
import {
  P256_N,
  STUB_WEBAUTHN_SIGNATURE,
  decodePublicKey,
  encodePublicKey,
  encodeWebAuthnSignature,
  fromBase64Url,
  p256KeyFromSpki,
  parseDerSignature,
  responseTypeLocation,
  toBase64Url,
} from './webauthn';

const P256 = { name: 'ECDSA', namedCurve: 'P-256' } as const;

async function keyPair() {
  return webcrypto.subtle.generateKey(P256, true, ['sign', 'verify']);
}

/** WebCrypto signs in IEEE P1363 form, r then s, and never lowers s: what an authenticator may also do. */
async function signRaw(privateKey: webcrypto.CryptoKey, message: Uint8Array): Promise<{ r: bigint; s: bigint }> {
  const raw = new Uint8Array(await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, message));
  return { r: bytesToBigInt(raw.slice(0, 32)), s: bytesToBigInt(raw.slice(32)) };
}

function der(r: bigint, s: bigint): Uint8Array {
  const integer = (value: bigint) => {
    let hex = value.toString(16);
    if (hex.length % 2 === 1) hex = `0${hex}`;
    if (Number.parseInt(hex.slice(0, 2), 16) >= 0x80) hex = `00${hex}`;
    return `02${(hex.length / 2).toString(16).padStart(2, '0')}${hex}`;
  };
  const body = integer(r) + integer(s);
  return hexToBytes(`0x30${(body.length / 2).toString(16).padStart(2, '0')}${body}`);
}

const SIGNATURE_PARAMETERS = [
  { name: 'authenticatorData', type: 'bytes' },
  { name: 'clientDataJSON', type: 'string' },
  { name: 'responseTypeLocation', type: 'uint256' },
  { name: 'r', type: 'uint256' },
  { name: 's', type: 'uint256' },
  { name: 'usePrecompiled', type: 'bool' },
] as const;

describe('passkey keys', () => {
  it('reads x and y from the SubjectPublicKeyInfo getPublicKey() gives', async () => {
    // #given a P-256 key exported the two ways a browser can give it
    const { publicKey } = await keyPair();
    const spki = new Uint8Array(await webcrypto.subtle.exportKey('spki', publicKey));
    const point = new Uint8Array(await webcrypto.subtle.exportKey('raw', publicKey));
    // #when x and y are read from the SPKI form
    const key = p256KeyFromSpki(spki);
    // #then they are the uncompressed point
    expect(encodePublicKey(key)).toBe(bytesToHex(point));
    expect(decodePublicKey(encodePublicKey(key))).toEqual(key);
  });

  it('refuses a key that is not uncompressed P-256', () => {
    expect(() => p256KeyFromSpki(new Uint8Array(91))).toThrow(/P-256/);
  });

  it('hashes the credential id as ZeroDev does, and puts it in the validator install data', () => {
    const credentialId = toBase64Url(new Uint8Array([1, 2, 3, 250, 251, 252]));
    expect(fromBase64Url(credentialId)).toEqual(new Uint8Array([1, 2, 3, 250, 251, 252]));
    expect(authenticatorIdHash(credentialId)).toBe(keccak256(new Uint8Array([1, 2, 3, 250, 251, 252])));
    const data = webAuthnEnableData({ credentialId, publicKey: { x: 5n, y: 6n } });
    const [point, hash] = decodeAbiParameters(
      [{ type: 'tuple', components: [{ name: 'x', type: 'uint256' }, { name: 'y', type: 'uint256' }] }, { type: 'bytes32' }],
      data,
    );
    expect([point, hash]).toEqual([{ x: 5n, y: 6n }, authenticatorIdHash(credentialId)]);
  });
});

describe('assertion signatures', () => {
  it('reads r and s of any DER length and keeps s in the lower half', async () => {
    const { privateKey } = await keyPair();
    let highS = 0;
    for (let index = 0; index < 48; index += 1) {
      const signature = await signRaw(privateKey, hexToBytes(keccak256(`0x${index.toString(16).padStart(4, '0')}`)));
      if (signature.s > P256_N / 2n) highS += 1;
      const parsed = parseDerSignature(der(signature.r, signature.s));
      expect(parsed.r).toBe(signature.r);
      expect(parsed.s).toBe(signature.s > P256_N / 2n ? P256_N - signature.s : signature.s);
      expect(parsed.s <= P256_N / 2n).toBe(true);
    }
    // About half of P-256 signatures carry a high s, so the lowering path ran.
    expect(highS).toBeGreaterThan(0);
  });

  it('reads short integers, as when r starts with zero bytes', () => {
    expect(parseDerSignature(der(0x7fn, 0x1234n))).toEqual({ r: 0x7fn, s: 0x1234n });
  });

  it('refuses a body that is not two DER integers', () => {
    expect(() => parseDerSignature(new Uint8Array([0x31, 0x00]))).toThrow();
    expect(() => parseDerSignature(new Uint8Array([0x30, 0x03, 0x04, 0x01, 0x01]))).toThrow();
  });

  it('encodes what the validator decodes, with usePrecompiled on and the type location ZeroDev finds', () => {
    const clientDataJSON = '{"type":"webauthn.get","challenge":"q2v","origin":"https://sleeve.example","crossOrigin":false}';
    const encoded = encodeWebAuthnSignature({ authenticatorData: '0x1d', clientDataJSON, r: 1n, s: 2n });
    expect(decodeAbiParameters(SIGNATURE_PARAMETERS, encoded)).toEqual(['0x1d', clientDataJSON, 1n, 1n, 2n, true]);
    expect(responseTypeLocation(clientDataJSON)).toBe(1n);
  });

  it('estimates gas on the precompile path with a stub of the longest clientDataJSON', () => {
    const [, clientDataJSON, , , s, usePrecompiled] = decodeAbiParameters(SIGNATURE_PARAMETERS, STUB_WEBAUTHN_SIGNATURE);
    expect(usePrecompiled).toBe(true);
    expect(s <= P256_N / 2n).toBe(true);
    expect(clientDataJSON).toContain('other_keys_can_be_added_here');
  });
});
