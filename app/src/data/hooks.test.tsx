import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useAttachWallet, useLedger, useReceipts, useSession, useSignInWithWallet, useSplit } from './hooks';
import { createEmptyWorld, createMockDataLayer } from './mock';
import { SAMPLE_ACCOUNT } from './mock/fixtures';
import { DataLayerProvider } from './provider';
import type { SleeveDataLayer, WalletSigner } from './types';

function wrapper(layer: SleeveDataLayer = createMockDataLayer()) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <DataLayerProvider dataLayer={layer}>{children}</DataLayerProvider>;
  };
}

const OWNER = '0x05a1C0FfEE00000000000000000000000000b92D';
const wallet: WalletSigner = { address: OWNER, signHash: async () => `0x${'ab'.repeat(65)}` };

describe('data hooks', () => {
  it('reads the session through the provider', async () => {
    const { result } = renderHook(() => useSession(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data?.account).toBe(SAMPLE_ACCOUNT));
  });

  it('waits while the account is not known', () => {
    const { result } = renderHook(() => useLedger(undefined), { wrapper: wrapper() });
    expect([result.current.fetchStatus, result.current.data]).toEqual(['idle', undefined]);
  });

  it('refreshes every read after an owner write', async () => {
    // #given a screen showing the ledger
    const { result } = renderHook(() => ({ ledger: useLedger(SAMPLE_ACCOUNT), split: useSplit() }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.ledger.data?.unsorted).toBe(165_800_000n));
    // #when the owner splits
    await act(() => result.current.split.mutateAsync());
    // #then the ledger reads again and nothing is unsorted
    await waitFor(() => expect(result.current.ledger.data?.unsorted).toBe(0n));
  });

  it('refreshes the session after a wallet signs in, and after a stored wallet session gets its wallet back', async () => {
    // #given an account OWNER's wallet set up, signed out
    const world = createEmptyWorld();
    const setup = createMockDataLayer({ world });
    await setup.createAccount({ rule: null, recoverySigner: null, signer: { kind: 'wallet', wallet } });
    await setup.signOut();
    const signIn = renderHook(() => ({ session: useSession(), signIn: useSignInWithWallet() }), { wrapper: wrapper(createMockDataLayer({ world })) });
    await waitFor(() => expect(signIn.result.current.session.data).toBeNull());
    // #when the wallet signs in / #then the session reads again, attached
    await act(() => signIn.result.current.signIn.mutateAsync(wallet));
    await waitFor(() => expect(signIn.result.current.session.data?.wallet).toEqual({ owner: OWNER, attached: true }));

    // #given the same session in a new tab, without its signer
    const reloaded = renderHook(() => ({ session: useSession(), attach: useAttachWallet() }), { wrapper: wrapper(createMockDataLayer({ world })) });
    await waitFor(() => expect(reloaded.result.current.session.data?.wallet).toEqual({ owner: OWNER, attached: false }));
    // #when the wallet is attached / #then the session reads again, attached
    await act(() => reloaded.result.current.attach.mutateAsync(wallet));
    await waitFor(() => expect(reloaded.result.current.session.data?.wallet).toEqual({ owner: OWNER, attached: true }));
  });

  it('pages receipts until there are no more', async () => {
    const { result } = renderHook(() => useReceipts({ account: SAMPLE_ACCOUNT, limit: 10 }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    await act(() => result.current.fetchNextPage());
    await waitFor(() => expect(result.current.data?.pages.flatMap((page) => page.items)).toHaveLength(13));
  });
});
