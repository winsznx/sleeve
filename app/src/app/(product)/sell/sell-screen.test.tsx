import { parseStockToken } from '@sleeve/core';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';

import { installDialogPolyfill } from '@/components/__tests__/dialog-polyfill';
import { DataLayerError } from '@/data/errors';
import { createEmptyWorld, createMockDataLayer, NEXT_OPEN, SAMPLE_ACCOUNT, type MockDataLayer } from '@/data/mock';
import { DataLayerProvider } from '@/data/provider';
import type { SleeveDataLayer } from '@/data/types';
import { DEBT_SECURITY_LINE, EXIT_LINE } from '@/lib/copy';

import SellPage from './page';
import { SellScreen } from './sell-screen';
import { amountFieldText } from './sell-text';

beforeAll(() => {
  installDialogPolyfill();
});

function renderSell(layer: SleeveDataLayer = createMockDataLayer()): SleeveDataLayer {
  render(
    <DataLayerProvider dataLayer={layer}>
      <SellScreen />
    </DataLayerProvider>,
  );
  return layer;
}

function openMarket(): MockDataLayer {
  const layer = createMockDataLayer();
  layer.simulate.openMarket();
  return layer;
}

async function amountField(name = 'Amount to sell'): Promise<HTMLElement> {
  return screen.findByRole('textbox', { name });
}

async function quoteFor(amount: string): Promise<void> {
  fireEvent.change(await amountField(), { target: { value: amount } });
  fireEvent.click(screen.getByRole('button', { name: 'Get a quote' }));
}

function quoteRegion(): HTMLElement {
  return screen.getByRole('region', { name: 'Quote' });
}

describe('sell screen', () => {
  it('lists each holding with the debt security line, with the exit line and the gated borrow note', async () => {
    renderSell();
    const spy = await screen.findByRole('radio', { name: '0.361668 SPY' });
    expect(spy).toBeChecked();
    expect(spy).toHaveAccessibleDescription(expect.stringContaining(DEBT_SECURITY_LINE));
    expect(spy).toHaveAccessibleDescription(expect.stringContaining('279.32 USDG'));
    expect(screen.getByRole('radio', { name: '0.033504 QQQ' })).not.toBeChecked();
    expect(screen.getByText(EXIT_LINE)).toBeInTheDocument();
    expect(screen.getByText('Borrowing USDG against your Stock Tokens is not available yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /borrow/i })).toBeNull();
  });

  it('says the market is closed before anything is quoted', async () => {
    renderSell();
    expect(await screen.findByText('The market is closed')).toBeInTheDocument();
    expect(screen.getByText('Sells wait until it reopens, Sun 27 Sep, 20:00 New York time.')).toBeInTheDocument();
  });

  it('asks for an amount, and refuses more than the lots hold', async () => {
    renderSell();
    await screen.findByRole('radio', { name: '0.361668 SPY' });
    fireEvent.click(screen.getByRole('button', { name: 'Get a quote' }));
    const field = await amountField();
    expect(await screen.findByText('Enter how much SPY to sell.')).toBeInTheDocument();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(field).toHaveFocus());

    fireEvent.change(field, { target: { value: '1' } });
    expect(screen.getByText('You can sell up to 0.361668 SPY here.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'No quote yet' })).toBeInTheDocument();
  });

  it('fills the whole sellable amount on request, every digit of it', async () => {
    const layer = createMockDataLayer();
    const spy = (await layer.getHoldings(SAMPLE_ACCOUNT)).find((holding) => holding.tickerId === 0);
    renderSell(layer);
    fireEvent.click(await screen.findByRole('button', { name: 'Use all 0.361668 SPY' }));
    const expected = amountFieldText(spy?.inLots ?? 0n);
    expect(parseStockToken(expected)).toEqual({ ok: true, value: spy?.inLots });
    expect(await amountField()).toHaveValue(expected);
  });

  it('shows a weekend sell as waiting, with the reopen time, and offers no sell button', async () => {
    renderSell();
    await quoteFor('0.1');
    const heading = await screen.findByRole('heading', { name: 'This sell waits for the market' });
    await waitFor(() => expect(heading).toHaveFocus());
    const region = quoteRegion();
    expect(region).toHaveTextContent('Market closed');
    expect(region).toHaveTextContent(
      'Sleeve does not sell until the market reopens, Sun 27 Sep, 20:00 New York time.',
    );
    expect(within(region).queryByRole('button', { name: /^Sell 0/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Get a new quote' })).toBeInTheDocument();
  });

  it('keeps waiting when the owner closes the risk dialog', async () => {
    renderSell();
    await quoteFor('0.1');
    fireEvent.click(await screen.findByRole('button', { name: 'Sell without waiting' }));
    const dialog = screen.getByRole('dialog', { name: 'Sell without waiting?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep waiting' }));
    expect(document.querySelector('dialog')?.open).toBe(false);
    expect(screen.getByRole('heading', { name: 'This sell waits for the market' })).toBeInTheDocument();
    expect(screen.queryByText('Not waiting for the market')).toBeNull();
  });

  it('overrides once, after the gap risk, then sells against the wider cap with the USDG going to spend unsplit', async () => {
    const layer = createMockDataLayer();
    const before = await layer.getLedger(SAMPLE_ACCOUNT);
    renderSell(layer);
    await quoteFor('0.1');

    fireEvent.click(await screen.findByRole('button', { name: 'Sell without waiting' }));
    const dialog = screen.getByRole('dialog', { name: 'Sell without waiting?' });
    expect(dialog).toHaveTextContent(
      'The Chainlink reference for SPY still shows its last price, from 25 Sep 2026, 16:03 UTC. When the market reopens, Sun 27 Sep, 20:00 New York time, the price can move, sometimes by more than your cap.',
    );
    fireEvent.click(within(dialog).getByRole('radio', { name: '2.00%' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue without waiting' }));

    const heading = await screen.findByRole('heading', { name: 'Your quote' });
    await waitFor(() => expect(heading).toHaveFocus());
    const region = quoteRegion();
    expect(region).toHaveTextContent('Not waiting for the market');
    expect(region).toHaveTextContent('This sell is 0.16 percent below the market reference, inside your cap of 2.00 percent.');
    expect(region).toHaveTextContent('77.11 USDG');
    expect(region).toHaveTextContent('771.16 USDG per SPY');
    expect(region).toHaveTextContent('772.32 USD per SPY');
    expect(region).toHaveTextContent('Chainlink price from 25 Sep 2026, 16:03 UTC');
    expect(region).toHaveTextContent('2.00 percent below the reference, widened for this sell only');
    expect(region).toHaveTextContent('Lot 401: 0.08446 SPY');
    expect(region).toHaveTextContent('Spend. Sleeve never splits it.');

    fireEvent.click(within(region).getByRole('button', { name: 'Sell 0.10 SPY' }));
    const done = await screen.findByRole('heading', { name: 'Sold 0.10 SPY' });
    await waitFor(() => expect(done).toHaveFocus());
    expect(screen.getByText(/77\.116953 USDG/)).toBeInTheDocument();
    expect(screen.getByText('One receipt for each of the 2 lots it drew from, oldest first.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open receipt 700' })).toHaveAttribute('href', '/receipts/700');

    const after = await layer.getLedger(SAMPLE_ACCOUNT);
    expect(after.spend - before.spend).toBe(77_116_953n);
    expect([after.unsorted, after.pendingTotal]).toEqual([before.unsorted, before.pendingTotal]);
    const receipt = await layer.getReceipt(700n);
    expect([receipt?.receipt.status, receipt?.receipt.overrideClosed, receipt?.receipt.overrideCapBps]).toEqual(['SOLD', true, 200]);

    // The override belonged to that sell. The next one waits again.
    fireEvent.click(screen.getByRole('button', { name: 'Sell more' }));
    await quoteFor('0.05');
    expect(await screen.findByRole('heading', { name: 'This sell waits for the market' })).toBeInTheDocument();
  });

  it('sells one lot in session, against the rule cap', async () => {
    renderSell(openMarket());
    await screen.findByRole('radio', { name: '0.361668 SPY' });
    expect(screen.queryByText('The market is closed')).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: 'One lot' }));
    fireEvent.click(screen.getByRole('button', { name: 'Get a quote' }));
    expect(await screen.findByText('Choose a lot to sell from.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: '0.155872 SPY' }));
    expect(await amountField('Amount to sell from lot 455')).toHaveValue('0.155872693654184832');
    fireEvent.click(screen.getByRole('button', { name: 'Get a quote' }));

    await screen.findByRole('heading', { name: 'Your quote' });
    const region = quoteRegion();
    expect(region).toHaveTextContent('Lot 455: 0.155872 SPY');
    expect(region).not.toHaveTextContent('Lot 401');
    expect(region).toHaveTextContent("1.00 percent below the reference, your rule's cap");
    expect(region).not.toHaveTextContent('Not waiting for the market');

    fireEvent.click(within(region).getByRole('button', { name: 'Sell 0.155872 SPY' }));
    expect(await screen.findByRole('heading', { name: 'Sold 0.155872 SPY' })).toBeInTheDocument();
    expect(screen.getByText('Its receipt is below.')).toBeInTheDocument();
    expect(screen.getByText('SOLD')).toBeInTheDocument();
  });

  it('starts a fresh draft when the owner picks another holding', async () => {
    renderSell();
    await quoteFor('0.1');
    await screen.findByRole('heading', { name: 'This sell waits for the market' });
    fireEvent.click(screen.getByRole('radio', { name: '0.033504 QQQ' }));
    expect(await amountField()).toHaveValue('');
    expect(screen.getByRole('heading', { name: 'No quote yet' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use all 0.033504 QQQ' })).toBeInTheDocument();
  });

  it('says what failed and that nothing moved when the quote does not load', async () => {
    const base = createMockDataLayer();
    renderSell({ ...base, getSellQuote: () => Promise.reject(new DataLayerError({ code: 'NotFound' }, 'no quote')) });
    await quoteFor('0.1');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The quote did not load');
    expect(alert).toHaveTextContent('Nothing moved. Your SPY and your USDG are still in your account.');
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('keeps the quote and the sell button when a sell fails, and says why', async () => {
    const base = openMarket();
    const failing = new DataLayerError({ code: 'SellWaits', reason: 'SESSION', reopensAt: NEXT_OPEN }, 'waits');
    renderSell({ ...base, sell: () => Promise.reject(failing) });
    await quoteFor('0.1');
    await screen.findByRole('heading', { name: 'Your quote' });
    const sellButton = within(quoteRegion()).getByRole('button', { name: 'Sell 0.10 SPY' });
    fireEvent.click(sellButton);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The sell did not go through');
    expect(alert).toHaveTextContent('The market closed before the sell ran. It reopens Sun 27 Sep, 20:00 New York time.');
    expect(alert).toHaveTextContent('Nothing moved. Your SPY and your USDG are still in your account.');
    expect(sellButton).toBeInTheDocument();

    fireEvent.change(await amountField(), { target: { value: '0.2' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('asks a signed-out visitor to sign in', async () => {
    const layer = createMockDataLayer();
    await layer.signOut();
    renderSell(layer);
    expect(await screen.findByRole('heading', { name: 'Sign in to sell' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/onboard');
  });

  it('says there is nothing to sell before the first buy', async () => {
    const layer = createMockDataLayer({ world: createEmptyWorld() });
    await layer.createAccount({ rule: null, recoverySigner: null });
    renderSell(layer);
    expect(await screen.findByRole('heading', { name: 'Nothing to sell yet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/home');
  });
});

describe('sell page', () => {
  it('renders the title, the flow and the issuer disclosure with its hash', async () => {
    render(<DataLayerProvider dataLayer={createMockDataLayer()}>{await SellPage()}</DataLayerProvider>);
    expect(screen.getByRole('heading', { level: 1, name: 'Sell' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Issuer disclosure' })).toHaveTextContent(
      '0x8408c7a59df30d1b5dbec102c388048f2bf8bba21a2e91ac0806df7d68068e89',
    );
    expect(await screen.findByRole('radio', { name: '0.361668 SPY' })).toBeInTheDocument();
  });
});
