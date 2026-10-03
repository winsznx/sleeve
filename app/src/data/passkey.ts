import { DataLayerError } from './errors';
import type { PasskeyCredential } from './types';

/**
 * The WebAuthn ceremonies behind Sleeve's passkey (D-003): one registration that makes the passkey, and one assertion
 * per owner op. The passkey is bound to the site that made it, Sleeve's domain in production and localhost while
 * developing, so it signs only on Sleeve's own pages. The data layer runs these; screens never call WebAuthn.
 */
export interface PasskeyCeremony {
  /** navigator.credentials.create for this site. */
  register(): Promise<PasskeyCredential>;
  /** navigator.credentials.get for one credential, over a challenge that stands for the owner op. */
  approve(credentialId: string, challenge: Uint8Array<ArrayBuffer>): Promise<void>;
}

/** ES256, P-256 with SHA-256: the curve Kernel's passkey validator verifies through the RIP-7212 precompile on 4663. */
const ES256 = -7;
const TIMEOUT_MS = 120_000;

function bytes(length: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(length));
  crypto.getRandomValues(out);
  return out;
}

export function toBase64Url(data: ArrayBuffer | Uint8Array<ArrayBuffer>): string {
  const view = data instanceof Uint8Array ? data : new Uint8Array(data);
  let binary = '';
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=');
  const binary = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index);
  return out;
}

/** Why a ceremony could not run, as the data layer's named errors. */
export function passkeyFailure(error: unknown): DataLayerError {
  const name = error instanceof DOMException || error instanceof Error ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'AbortError':
      return new DataLayerError({ code: 'PasskeyCancelled' }, 'The passkey prompt closed before it finished');
    case 'SecurityError':
      return new DataLayerError(
        { code: 'PasskeyUnavailable' },
        "This page is not on Sleeve's own site, so a passkey for Sleeve cannot be made or used here",
      );
    default:
      return new DataLayerError({ code: 'PasskeyUnavailable' }, 'This browser could not make or use a passkey');
  }
}

function assertAvailable(): void {
  const usable =
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    typeof window.PublicKeyCredential === 'function' &&
    typeof navigator.credentials?.create === 'function';
  if (!usable) {
    throw new DataLayerError({ code: 'PasskeyUnavailable' }, 'This browser cannot make a passkey on this page');
  }
}

export interface BrowserPasskeyOptions {
  /** The relying party id. Defaults to NEXT_PUBLIC_PASSKEY_RP_ID, then to the page's own host. */
  rpId?: string;
}

/** The real ceremonies, through the browser's WebAuthn API. */
export function browserPasskeys(options: BrowserPasskeyOptions = {}): PasskeyCeremony {
  function rpId(): string {
    return options.rpId ?? (process.env.NEXT_PUBLIC_PASSKEY_RP_ID || window.location.hostname);
  }

  return {
    async register() {
      assertAvailable();
      const id = rpId();
      let credential: Credential | null;
      try {
        credential = await navigator.credentials.create({
          publicKey: {
            rp: { id, name: 'Sleeve' },
            user: { id: bytes(16), name: 'Sleeve account', displayName: 'Sleeve account' },
            challenge: bytes(32),
            pubKeyCredParams: [{ type: 'public-key', alg: ES256 }],
            authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
            attestation: 'none',
            timeout: TIMEOUT_MS,
          },
        });
      } catch (error) {
        throw passkeyFailure(error);
      }
      if (!(credential instanceof PublicKeyCredential)) throw passkeyFailure(null);
      return { credentialId: toBase64Url(credential.rawId), rpId: id, ceremony: 'webauthn' };
    },

    async approve(credentialId, challenge) {
      assertAvailable();
      try {
        const assertion = await navigator.credentials.get({
          publicKey: {
            challenge,
            rpId: rpId(),
            allowCredentials: [{ type: 'public-key', id: fromBase64Url(credentialId) }],
            userVerification: 'required',
            timeout: TIMEOUT_MS,
          },
        });
        if (!(assertion instanceof PublicKeyCredential)) throw passkeyFailure(null);
      } catch (error) {
        throw error instanceof DataLayerError ? error : passkeyFailure(error);
      }
    },
  };
}
