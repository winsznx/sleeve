import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useLedger, useReceipts, useSession, useSplit } from './hooks';
import { createMockDataLayer } from './mock';
import { SAMPLE_ACCOUNT } from './mock/fixtures';
import { DataLayerProvider } from './provider';

function wrapper() {
  const layer = createMockDataLayer();
  return function Wrapper({ children }: { children: ReactNode }) {
    return <DataLayerProvider dataLayer={layer}>{children}</DataLayerProvider>;
  };
}

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

  it('pages receipts until there are no more', async () => {
    const { result } = renderHook(() => useReceipts({ account: SAMPLE_ACCOUNT, limit: 10 }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    await act(() => result.current.fetchNextPage());
    await waitFor(() => expect(result.current.data?.pages.flatMap((page) => page.items)).toHaveLength(13));
  });
});
