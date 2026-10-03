import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { installDialogPolyfill } from '@/components/__tests__/dialog-polyfill';
import { FUNDS_STILL_HERE } from '@/components/ui/card';
import { createMockDataLayer, SAMPLE_WEEK_START, type MockDataLayer } from '@/data/mock';
import { DataLayerProvider } from '@/data/provider';
import type { ReceiptQuery, SleeveDataLayer } from '@/data/types';

import { CSV_HEADERS } from './receipts-csv';
import { ReceiptsScreen } from './receipts-screen';

/**
 * next/navigation stand-in. Next keeps useSearchParams in step with history.replaceState; the test does the same by
 * telling the hook whenever the URL is replaced.
 */
const navigation = vi.hoisted(() => ({ push: vi.fn(), listeners: new Set<() => void>() }));

vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useRouter: () => ({ push: navigation.push }),
    usePathname: () => window.location.pathname,
    useSearchParams: () =>
      new URLSearchParams(
        useSyncExternalStore(
          (listener: () => void) => {
            navigation.listeners.add(listener);
            return () => navigation.listeners.delete(listener);
          },
          () => window.location.search,
        ),
      ),
  };
});

const originalReplaceState = window.history.replaceState.bind(window.history);

beforeAll(() => {
  installDialogPolyfill();
  window.history.replaceState = (data: unknown, unused: string, url?: string | URL | null) => {
    originalReplaceState(data, unused, url);
    navigation.listeners.forEach((listener) => listener());
  };
});

beforeEach(() => {
  originalReplaceState(null, '', '/receipts');
  navigation.push.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderScreen(layer: SleeveDataLayer = createMockDataLayer()) {
  render(
    <DataLayerProvider dataLayer={layer}>
      <ReceiptsScreen />
    </DataLayerProvider>,
  );
}

async function receiptRows(): Promise<HTMLElement[]> {
  const list = await screen.findByRole('list', { name: 'Receipts' });
  return within(list).getAllByRole('listitem');
}

function rowLinks(rows: HTMLElement[]): (string | null)[] {
  return rows.map((row) => within(row).getByRole('link').getAttribute('href'));
}

describe('receipts list', () => {
  it("lists the owner's receipts newest first, each opening its own receipt", async () => {
    renderScreen();
    const rows = await receiptRows();
    expect(rows).toHaveLength(13);
    expect(rowLinks(rows).slice(0, 3)).toEqual(['/receipts/642', '/receipts/611', '/receipts/560']);
    expect(within(rows[0] ?? document.body).getByText('QUEUED')).toBeInTheDocument();
    expect(screen.getByText('13 receipts, newest first')).toBeInTheDocument();
  });

  it('filters by ticker and keeps the filter in the URL', async () => {
    renderScreen();
    await receiptRows();
    fireEvent.click(screen.getByRole('button', { name: 'QQQ' }));
    expect(window.location.search).toBe('?ticker=QQQ');
    await waitFor(async () => expect(rowLinks(await receiptRows())).toEqual(['/receipts/416', '/receipts/415', '/receipts/305', '/receipts/212', '/receipts/203', '/receipts/198']));
    expect(screen.getByRole('button', { name: 'QQQ' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'All tickers' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('filters by status, says when nothing matches, and clears back to everything', async () => {
    renderScreen();
    await receiptRows();
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'SOLD' } });
    await waitFor(async () => expect(rowLinks(await receiptRows())).toEqual(['/receipts/415']));

    fireEvent.click(screen.getByRole('button', { name: 'NVDA' }));
    expect(await screen.findByRole('heading', { name: 'No receipts match' })).toBeInTheDocument();
    expect(screen.getByText('There are no NVDA receipts with the status sold on your account yet.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(window.location.search).toBe('');
    await waitFor(async () => expect(await receiptRows()).toHaveLength(13));
  });

  it('opens on the filters a shared link carries', async () => {
    originalReplaceState(null, '', '/receipts?ticker=spy&status=filled');
    renderScreen();
    await waitFor(async () => expect(rowLinks(await receiptRows())).toEqual(['/receipts/611', '/receipts/455']));
    expect(screen.getByLabelText('Status')).toHaveValue('FILLED');
  });

  it('shows older receipts a page at a time', async () => {
    const layer: MockDataLayer = createMockDataLayer();
    for (const amount of [100n, 120n, 140n, 160n, 180n, 200n, 220n, 240n]) {
      layer.simulate.receivePayment(amount * 1_000_000n);
      layer.simulate.runKeeper();
    }
    renderScreen(layer);
    expect(await receiptRows()).toHaveLength(20);
    expect(screen.getByText('20 receipts so far, newest first')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show older receipts' }));
    await waitFor(async () => expect(await receiptRows()).toHaveLength(21));
    expect(screen.getByText('21 receipts, newest first')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show older receipts' })).toBeNull();
  });
});

describe('CSV export', () => {
  /** jsdom's Blob has no text(); its FileReader reads one. */
  function readBlob(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error('the blob could not be read'));
      reader.readAsText(blob);
    });
  }

  function captureDownload(): { saved: Promise<{ blob: Blob; fileName: string }> } {
    let resolveSaved: (value: { blob: Blob; fileName: string }) => void = () => undefined;
    const saved = new Promise<{ blob: Blob; fileName: string }>((resolve) => {
      resolveSaved = resolve;
    });
    let lastBlob: Blob | null = null;
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: (blob: Blob) => {
        lastBlob = blob;
        return 'blob:receipts';
      },
    });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => undefined });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
      if (lastBlob !== null) resolveSaved({ blob: lastBlob, fileName: this.download });
    });
    return { saved };
  }

  it('downloads every receipt the filters match, every field included', async () => {
    const { saved } = captureDownload();
    originalReplaceState(null, '', '/receipts?ticker=SPY');
    renderScreen();
    await receiptRows();
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));

    const { blob, fileName } = await saved;
    const lines = (await readBlob(blob)).trimEnd().split('\r\n');
    expect(fileName).toBe('sleeve-receipts-spy.csv');
    expect(lines[0]).toBe(CSV_HEADERS.join(','));
    expect(lines.slice(1).map((line) => line.split(',')[2])).toEqual(['642', '611', '560', '503', '455', '401', '388']);
  });

  it('says the CSV failed and that nothing changed, and leaves the list in place', async () => {
    captureDownload();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const layer = createMockDataLayer();
    const failingExport: SleeveDataLayer = {
      ...layer,
      listReceipts: (query: ReceiptQuery) =>
        query.limit === 100 ? Promise.reject(new Error('rate limited')) : layer.listReceipts(query),
    };
    renderScreen(failingExport);
    await receiptRows();
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The CSV did not download. Nothing changed on your account.');
    expect(await receiptRows()).toHaveLength(13);
  });
});

describe('states around the list', () => {
  it('asks a signed-out visitor to sign in, then shows their receipts', async () => {
    const layer = createMockDataLayer();
    await layer.signOut();
    renderScreen(layer);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in with your passkey' }));
    expect(await receiptRows()).toHaveLength(13);
  });

  it('says what failed and that the USDG is still in the account when receipts cannot load', async () => {
    const layer = createMockDataLayer();
    let failing = true;
    renderScreen({
      ...layer,
      listReceipts: (query: ReceiptQuery) => (failing ? Promise.reject(new Error('offline')) : layer.listReceipts(query)),
    });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Your receipts did not load');
    expect(alert).toHaveTextContent(FUNDS_STILL_HERE);
    failing = false;
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await receiptRows()).toHaveLength(13);
  });
});

describe('week card', () => {
  async function openComposer(): Promise<HTMLElement> {
    renderScreen();
    await receiptRows();
    fireEvent.click(screen.getByRole('button', { name: 'Make a week card' }));
    return screen.findByRole('dialog', { name: 'Make a week card' });
  }

  it('makes a card of the chosen week with amounts and proof off', async () => {
    const dialog = await openComposer();
    const week = await within(dialog).findByLabelText('Week');
    await waitFor(() => expect(week).toBeEnabled());
    expect(within(week).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Week of 21 Sep 2026',
      'Week of 14 Sep 2026',
    ]);
    expect(week).toHaveValue(SAMPLE_WEEK_START.toString());

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Make card' }));
    });
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith(expect.stringMatching(/^\/card\/[A-Za-z0-9]+$/)));
  });

  it('adds receipt numbers only after the owner reads that they reveal the account', async () => {
    const dialog = await openComposer();
    await waitFor(() => expect(within(dialog).getByLabelText('Week')).toBeEnabled());
    const proof = within(dialog).getByRole('checkbox', { name: 'Show proof' });

    fireEvent.click(proof);
    expect(within(dialog).getByText('Receipt numbers reveal your account')).toBeInTheDocument();
    expect(proof).not.toBeChecked();
    expect(within(dialog).getByRole('button', { name: 'Make card' })).toBeDisabled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep it off' }));
    expect(within(dialog).queryByText('Receipt numbers reveal your account')).toBeNull();
    expect(proof).not.toBeChecked();

    fireEvent.click(proof);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add the receipt numbers' }));
    expect(proof).toBeChecked();
    expect(within(dialog).getByRole('button', { name: 'Make card' })).toBeEnabled();
  });
});
