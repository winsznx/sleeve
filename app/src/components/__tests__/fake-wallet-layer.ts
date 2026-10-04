import type { Address, Hex } from '@sleeve/core';

import { ConnectClosedError, type ConnectOptions } from '@/components/wallet/connect-flow';
import type { WalletLayer, WalletLink } from '@/components/wallet/wallet-layer';
import { buildFixtureWorld, createMockDataLayer, SAMPLE_ACCOUNT, type MockDataLayer } from '@/data/mock';
import type { WalletSigner } from '@/data/types';

/**
 * The wallet layer as screens see it, without wagmi: a wallet at `address` that connects through a "modal" (calling
 * beforeModal first, as RainbowKit's opens) or is already connected, or a modal the person closes. Every step lands
 * in `events`, so a test can check what happened in which order.
 */

export interface FakeWalletOptions {
  address: Address;
  /** How connect goes: through the modal (the default), at once as an already connected wallet, or a closed modal. */
  connect?: 'modal' | 'connected' | 'closed';
  /** Runs inside connect right after beforeModal, while the modal would be open. */
  whileModalOpen?: () => void;
}

export interface FakeWallet {
  layer: WalletLayer;
  events: string[];
  /** Hashes signed by signers the link handed out. */
  signed: Hex[];
}

export function fakeWalletLayer({ address, connect = 'modal', whileModalOpen }: FakeWalletOptions): FakeWallet {
  const events: string[] = [];
  const signed: Hex[] = [];
  const link: WalletLink = {
    async connect(options: ConnectOptions = {}) {
      events.push('connect');
      if (connect === 'connected') return address;
      options.beforeModal?.();
      events.push('modal');
      whileModalOpen?.();
      if (connect === 'closed') throw new ConnectClosedError();
      return address;
    },
    signerFor(owner: Address): WalletSigner {
      return {
        address: owner,
        async signHash(hash: Hex) {
          signed.push(hash);
          return `0x${'ab'.repeat(65)}`;
        },
      };
    },
  };
  return {
    events,
    signed,
    layer: {
      async load() {
        events.push('load');
        return link;
      },
    },
  };
}

/**
 * The sample account as if `owner`'s wallet owned it, signed in from storage after a reload: the session names the
 * wallet, and this tab holds no signer for it until the wallet is attached.
 */
export function sampleOwnedByWallet(owner: Address): MockDataLayer {
  const world = buildFixtureWorld();
  const account = [...world.accounts.values()].find((entry) => entry.address === SAMPLE_ACCOUNT);
  if (account === undefined || world.session === null) throw new Error('the fixture has no signed-in sample owner');
  account.ownerWallet = owner;
  account.credentialId = '';
  world.session = { ...world.session, credentialId: '', wallet: { owner, attached: false } };
  return createMockDataLayer({ world });
}
