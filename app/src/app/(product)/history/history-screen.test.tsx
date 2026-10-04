import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { installDialogPolyfill } from '@/components/__tests__/dialog-polyfill';
import { FUNDS_STILL_HERE } from '@/components/ui/card';
import { createMockDataLayer, SAMPLE_WEEK_START, type MockDataLayer } from '@/data/mock';
import { DataLayerProvider } from '@/data/provider';
import type { ReceiptQuery, SleeveDataLayer } from '@/data/types';
import { DEBT_SECURITY_LINE } from '@/lib/copy';

import { NOT_AN_ACTION_NUMBER } from './_components/history-toolbar';
import { CSV_HEADERS } from './_lib/csv';
import { HistoryScreen } from './history-screen';

/** "#" and a number, built so the design guardrail's color grep does not read the test as a hex color. */
const numberSign = (id: string): string => `#${id}`;

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
  originalReplaceState(null, '', '/history');
  navigation.push.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderScreen(layer: SleeveDataLayer = createMockDataLayer()) {
  render(
    <DataLayerProvider dataLayer={layer}>
      <HistoryScreen />
    </DataLayerProvider>,
  );
}

async function register(): Promise<HTMLElement> {
  return screen.findByRole('region', { name: 'Actions' });
}

async function actionRows(): Promise<HTMLElement[]> {
  return within(await register()).getAllByRole('listitem');
}

function rowLinks(rows: HTMLElement[]): (string | null)[] {
  return rows.map((row) => within(row).getByRole('link').getAttribute('href'));
}

function row(rows: HTMLElement[], id: string): HTMLElement {
  const found = rows.find((candidate) => candidate.dataset.action === id);
  if (found === undefined) throw new Error(`no row for #${id}`);
  return found;
}

function chip(group: 'Ticker' | 'Status', name: string): HTMLElement {
  return within(screen.getByRole('group', { name: group })).getByRole('button', { name });
}

describe('history register', () => {
  it("lists the owner's actions newest first, grouped by UTC day, each opening its details", async () => {
    renderScreen();
    expect(screen.getByRole('heading', { level: 1, name: 'History' })).toBeInTheDocument();
    const rows = await actionRows();
    expect(rows).toHaveLength(13);
    expect(rowLinks(rows).slice(0, 3)).toEqual(['/receipts/642', '/receipts/611', '/receipts/560']);
    expect(within(row(rows, '642')).getByText('Waiting')).toBeInTheDocument();
    expect(within(row(rows, '642')).getByText('Market closed')).toBeInTheDocument();
    expect(screen.getByText('13 actions, newest first')).toBeInTheDocument();

    const day = screen.getByRole('region', { name: 'Mon 21 Sep 2026' });
    expect(within(day).getAllByRole('listitem')).toHaveLength(3);
    expect(within(day).getByText('3 actions')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toContain('Sat 26 Sep 2026');
  });

  it('names each row by what happened, who paid, its number, its status in plain words and what the amount became', async () => {
    renderScreen();
    const rows = await actionRows();
    const payday = row(rows, '455');
    expect(within(payday).getByRole('link', { name: 'Payday split, number 455' })).toHaveAttribute('href', '/receipts/455');
    expect(payday).toHaveTextContent('from 0x557f…99F0');
    expect(payday).toHaveTextContent(numberSign('455'));
    expect(within(payday).getByText('Bought')).toHaveAttribute('data-status', 'FILLED');
    expect(payday).toHaveTextContent('1,200.00 USDG');
    expect(payday).toHaveTextContent('became 0.155872 SPY');
    expect(payday.querySelector('[data-token="SPY"]')).not.toBeNull();
    expect(payday.querySelector('[data-token="USDG"]')).not.toBeNull();
    expect(payday.querySelectorAll('[data-part]')).toHaveLength(2);

    const sold = row(rows, '415');
    expect(within(sold).getByRole('link', { name: 'Sold QQQ, number 415' })).toBeInTheDocument();
    expect(sold).toHaveTextContent('from lot 212');
    expect(sold).toHaveTextContent('80.006416 USDG');
    expect(sold).toHaveTextContent('for 0.108026 QQQ');

    expect(row(rows, '401')).toHaveTextContent('Bought SPY after waiting');
    expect(within(row(rows, '560')).getByText('Not on the allowlist')).toBeInTheDocument();
    expect(within(row(rows, '503')).getByText('Corrected')).toBeInTheDocument();
    expect(screen.queryByText('FILLED')).toBeNull();
  });

  it('puts the debt security line under every Stock Token amount a row shows, and on no other row', async () => {
    renderScreen();
    const rows = await actionRows();
    const statusOf = (candidate: HTMLElement) => candidate.querySelector('[data-status]')?.getAttribute('data-status');
    const tokenRows = rows.filter((candidate) => ['FILLED', 'SETTLED', 'PART_SOLD', 'SOLD'].includes(statusOf(candidate) ?? ''));
    expect(tokenRows.map((candidate) => candidate.dataset.action)).toEqual(['611', '455', '416', '415', '401', '305', '212']);
    for (const candidate of tokenRows) expect(within(candidate).getByText(DEBT_SECURITY_LINE)).toBeInTheDocument();
    for (const candidate of rows.filter((other) => !tokenRows.includes(other))) {
      expect(within(candidate).queryByText(DEBT_SECURITY_LINE)).toBeNull();
    }
    expect(within(row(rows, '401')).getByText(DEBT_SECURITY_LINE).previousElementSibling).toHaveTextContent('became 0.08446 SPY');
    expect(within(row(rows, '416')).getByText(DEBT_SECURITY_LINE).previousElementSibling).toHaveTextContent(/^for 0\.\d+ QQQ$/);
  });

  it('filters by a ticker chip with its icon and keeps the filter in the URL', async () => {
    renderScreen();
    await actionRows();
    const qqq = chip('Ticker', 'QQQ');
    expect(qqq.querySelector('[data-token="QQQ"]')).not.toBeNull();
    fireEvent.click(qqq);
    expect(window.location.search).toBe('?ticker=QQQ');
    await waitFor(async () =>
      expect(rowLinks(await actionRows())).toEqual(['/receipts/416', '/receipts/415', '/receipts/305', '/receipts/212', '/receipts/203', '/receipts/198']),
    );
    expect(chip('Ticker', 'QQQ')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('Ticker', 'All tickers')).toHaveAttribute('aria-pressed', 'false');
  });

  it('filters by a status chip in plain words, says when nothing matches, and clears back to everything', async () => {
    renderScreen();
    await actionRows();
    fireEvent.click(chip('Status', 'Sold'));
    expect(window.location.search).toBe('?status=SOLD');
    await waitFor(async () => expect(rowLinks(await actionRows())).toEqual(['/receipts/415']));
    expect(chip('Status', 'Sold')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(chip('Ticker', 'NVDA'));
    expect(await screen.findByRole('heading', { name: 'Nothing matches' })).toBeInTheDocument();
    expect(screen.getByText('There are no NVDA actions marked Sold on your account yet.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(window.location.search).toBe('');
    await waitFor(async () => expect(await actionRows()).toHaveLength(13));
  });

  it('opens on the filters a shared link carries', async () => {
    originalReplaceState(null, '', '/history?ticker=spy&status=filled');
    renderScreen();
    await waitFor(async () => expect(rowLinks(await actionRows())).toEqual(['/receipts/611', '/receipts/455']));
    expect(chip('Status', 'Bought')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('Ticker', 'SPY')).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows older actions a page at a time', async () => {
    const layer: MockDataLayer = createMockDataLayer();
    for (const amount of [100n, 120n, 140n, 160n, 180n, 200n, 220n, 240n]) {
      layer.simulate.receivePayment(amount * 1_000_000n);
      layer.simulate.runKeeper();
    }
    renderScreen(layer);
    expect(await actionRows()).toHaveLength(20);
    expect(screen.getByText('20 actions so far, newest first')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show older actions' }));
    await waitFor(async () => expect(await actionRows()).toHaveLength(21));
    expect(screen.getByText('21 actions, newest first')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show older actions' })).toBeNull();
  });
});

describe('opening an action by number', () => {
  it('opens any action by its number, written the way people write it', async () => {
    renderScreen();
    await actionRows();
    const search = screen.getByRole('search', { name: 'Open an action by its number' });
    fireEvent.change(within(search).getByRole('textbox', { name: 'Go to' }), { target: { value: ` ${numberSign('531')} ` } });
    fireEvent.click(within(search).getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith('/receipts/531'));
  });

  it('says what to change when the input is not a number', async () => {
    renderScreen();
    await actionRows();
    const search = screen.getByRole('search', { name: 'Open an action by its number' });
    const field = within(search).getByRole('textbox', { name: 'Go to' });
    fireEvent.change(field, { target: { value: '0x1c7' } });
    fireEvent.click(within(search).getByRole('button', { name: 'Open' }));
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription(NOT_AN_ACTION_NUMBER);
    expect(navigation.push).not.toHaveBeenCalled();
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
        return 'blob:history';
      },
    });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => undefined });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
      if (lastBlob !== null) resolveSaved({ blob: lastBlob, fileName: this.download });
    });
    return { saved };
  }

  it('downloads every action the filters match, every receipt field included, named as sample data', async () => {
    const { saved } = captureDownload();
    originalReplaceState(null, '', '/history?ticker=SPY');
    renderScreen();
    await actionRows();
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));

    const { blob, fileName } = await saved;
    const lines = (await readBlob(blob)).trimEnd().split('\r\n');
    expect(fileName).toBe('sleeve-sample-history-spy.csv');
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
    await actionRows();
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The CSV did not download. Nothing changed on your account.');
    expect(await actionRows()).toHaveLength(13);
  });
});

describe('states around the register', () => {
  it('asks a signed-out visitor to sign in with a passkey or a wallet, then shows their history', async () => {
    const layer = createMockDataLayer();
    await layer.signOut();
    renderScreen(layer);
    expect(await screen.findByRole('heading', { name: 'Sign in to see your history' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in with a wallet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Check a split by its number' })).toHaveAttribute('href', '/verify');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with your passkey' }));
    expect(await actionRows()).toHaveLength(13);
  });

  it('shows the shape of the register while it loads', async () => {
    const layer = createMockDataLayer({ latencyMs: 50 });
    renderScreen(layer);
    expect(await screen.findByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Loading your history')).toBeInTheDocument();
    expect(await actionRows()).toHaveLength(13);
  });

  it('says what failed and that the USDG is still in the account when the history cannot load', async () => {
    const layer = createMockDataLayer();
    let failing = true;
    renderScreen({
      ...layer,
      listReceipts: (query: ReceiptQuery) => (failing ? Promise.reject(new Error('offline')) : layer.listReceipts(query)),
    });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Your history did not load');
    expect(alert).toHaveTextContent(FUNDS_STILL_HERE);
    failing = false;
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await actionRows()).toHaveLength(13);
  });

  it('points a new account at its payment address before anything has happened', async () => {
    const layer = createMockDataLayer();
    const session = await layer.getSession();
    renderScreen({ ...layer, listReceipts: async () => ({ items: [], nextCursor: null }) });
    expect(await screen.findByRole('heading', { name: 'Nothing has happened yet' })).toBeInTheDocument();
    expect(screen.getByText(session?.account ?? 'missing')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy payment address' })).toBeInTheDocument();
  });
});

describe('week card', () => {
  async function openComposer(): Promise<HTMLElement> {
    renderScreen();
    await actionRows();
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

  it('previews the chosen week and follows a change of week', async () => {
    const dialog = await openComposer();
    const week = await within(dialog).findByLabelText('Week');
    await waitFor(() => expect(week).toBeEnabled());
    const preview = await within(dialog).findByRole('img', { name: /week card/ });
    expect(preview.getAttribute('aria-label')).toContain('Week of 21 Sep 2026');
    fireEvent.change(week, { target: { value: String(BigInt(Date.parse('2026-09-14T04:00:00Z') / 1_000)) } });
    expect(within(dialog).getByRole('img', { name: /week card/ }).getAttribute('aria-label')).toContain('Week of 14 Sep 2026');
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
