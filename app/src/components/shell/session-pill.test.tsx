import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { installDialogPolyfill } from '@/components/__tests__/dialog-polyfill';
import { createMockDataLayer } from '@/data/mock';
import { DataLayerProvider } from '@/data/provider';

import { SessionPill } from './session-pill';

beforeAll(() => {
  installDialogPolyfill();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SessionPill', () => {
  it('counts down live: the time left drops as the clock runs, then the market opens', async () => {
    // #given the sample clock, Saturday 26 September 2026 at 18:00 UTC, 30 hours before Sunday's 20:00 New York open
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(
      <DataLayerProvider dataLayer={createMockDataLayer()}>
        <SessionPill />
      </DataLayerProvider>,
    );
    const pill = await screen.findByRole('button', { name: /^Market closed, opens Sunday 27 September at 20:00 New York time, in 1 day 6 hours\./ });
    expect(pill).toHaveTextContent('opens in 1d 6h');

    // #when 31 minutes pass (the clock jumps, then the pill's one-second tick reads it)
    await act(async () => {
      vi.setSystemTime(Date.now() + 31 * 60_000);
      await vi.advanceTimersByTimeAsync(1_000);
    });

    // #then the pill says what is left without a reload
    expect(pill).toHaveTextContent('opens in 1d 5h');
    expect(pill).toHaveAccessibleName(/, in 1 day 5 hours\. Market details\.$/);

    // #when the open comes
    await act(async () => {
      vi.setSystemTime(Date.now() + 30 * 3_600_000);
      await vi.advanceTimersByTimeAsync(1_000);
    });

    // #then it reads open and counts down to Friday's close
    expect(await screen.findByRole('button', { name: /^Market open, closes Friday 2 October at 20:00 New York time/ })).toHaveTextContent(
      'closes in',
    );
  });
});
