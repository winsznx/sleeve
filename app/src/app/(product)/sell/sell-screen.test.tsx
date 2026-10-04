import { parseStockToken } from '@sleeve/core';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { installDialogPolyfill } from '@/components/__tests__/dialog-polyfill';
import { DataLayerError } from '@/data/errors';
import { createEmptyWorld, createMockDataLayer, NEXT_OPEN, SAMPLE_ACCOUNT, type MockDataLayer } from '@/data/mock';
import { DataLayerProvider } from '@/data/provider';
import type { SellRequest, SleeveDataLayer } from '@/data/types';
import { DEBT_SECURITY_LINE, EXIT_LINE } from '@/lib/copy';

import SellPage from './page';
import { SellScreen, type SellScreenProps } from './sell-screen';
import { amountFieldText } from './sell-text';

beforeAll(() => {
  installDialogPolyfill();
});

function renderSell(layer: SleeveDataLayer = createMockDataLayer(), start: SellScreenProps = {}): SleeveDataLayer {
  render(
    <DataLayerProvider dataLayer={layer}>
      <SellScreen {...start} />
    </DataLayerProvider>,
  );
  return layer;
}

function openMarket(): MockDataLayer {
  const layer = createMockDataLayer();
  layer.simulate.openMarket();
  return layer;
}

async function amountField(symbol = 'SPY'): Promise<HTMLElement> {
  return screen.findByRole('textbox', { name: `You sell ${symbol}` });
}

async function typeAmount(amount: string, symbol = 'SPY'): Promise<void> {
  fireEvent.change(await amountField(symbol), { target: { value: amount } });
}

function card(): HTMLElement {
  return screen.getByRole('region', { name: 'Sell back to USDG' });
}

/** Approves the sell in its preview dialog once the preview has read. */
async function approveSell(name: string): Promise<HTMLElement> {
  const dialog = screen.getByRole('dialog', { name });
  const preview = await within(dialog).findByRole('region', { name: 'Preview' });
  const approve = within(dialog).getByRole('button', { name: 'Approve and sell' });
  await waitFor(() => expect(approve).toBeEnabled());
  fireEvent.click(approve);
  return preview;
}

function cta(): HTMLElement {
  const buttons = within(card()).getAllByRole('button');
  const last = buttons.filter((button) => button.className.includes('w-full')).pop();
  if (last === undefined) throw new Error('the swap card has a main button');
  return last;
}

describe('the swap card', () => {
  it('sells a Stock Token for USDG: the token chip, the USDG side, and a switch that stays off with its reason', async () => {
    renderSell();
    const field = await amountField();
    expect(field).toHaveValue('');
    const chip = within(card()).getByRole('button', { name: 'SPY, choose another Stock Token' });
    expect(chip.querySelector('[data-token="SPY"]')).not.toBeNull();
    expect(card().querySelector('[data-token="USDG"]')).not.toBeNull();
    const swap = within(card()).getByRole('button', { name: 'Switch direction' });
    expect(swap).toBeDisabled();
    expect(swap).toHaveAccessibleDescription('Sells go to USDG only. Your rule does the buying.');
    expect(within(card()).getByText('To spend. Sleeve never splits it.')).toBeInTheDocument();
    expect(cta()).toHaveTextContent('Enter an amount');
    expect(cta()).toBeDisabled();
    expect(screen.getByRole('heading', { name: 'Your quote shows here' })).toBeInTheDocument();
  });

  it('shows the live market, the holding with the debt security line, its lots, the exit line and the gated borrow note', async () => {
    renderSell();
    await amountField();
    expect(await within(card()).findByText('Market closed')).toBeInTheDocument();
    const holding = screen.getByRole('region', { name: 'Your SPY' });
    expect(holding).toHaveTextContent('0.361668 SPY');
    expect(within(holding).getByText(DEBT_SECURITY_LINE)).toBeInTheDocument();
    expect(holding).toHaveTextContent('Reopens Sun 27 Sep, 20:00 New York time.');
    expect(within(holding).getByRole('link', { name: 'Lot 401' })).toHaveAttribute('href', '/receipts/401');
    expect(screen.getByText(EXIT_LINE)).toBeInTheDocument();
    // PRD 7.8: with no lending market vetted (gate G1), the borrow control is absent, not shown as unavailable.
    expect(screen.queryByText(/borrow/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /borrow/i })).toBeNull();
  });

  it('refuses more than the lots hold once typing pauses, and values the amount at the reference as it is typed', async () => {
    renderSell();
    await typeAmount('1');
    expect(card()).toHaveTextContent('772.32 USDG at the Chainlink reference');
    const field = await amountField();
    expect(await screen.findByText('You can sell up to 0.361668 SPY here.')).toBeInTheDocument();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(cta()).toHaveTextContent('Check the amount');
    expect(cta()).toBeDisabled();
  });

  it('fills the whole sellable amount on request, every digit of it', async () => {
    const layer = createMockDataLayer();
    const spy = (await layer.getHoldings(SAMPLE_ACCOUNT)).find((holding) => holding.tickerId === 0);
    renderSell(layer);
    fireEvent.click(await screen.findByRole('button', { name: 'Max, use all 0.361668 SPY' }));
    const expected = amountFieldText(spy?.inLots ?? 0n);
    expect(parseStockToken(expected)).toEqual({ ok: true, value: spy?.inLots });
    expect(await amountField()).toHaveValue(expected);
  });

  it('opens the token list and starts a fresh draft for the token chosen', async () => {
    renderSell();
    await typeAmount('0.1');
    fireEvent.click(within(card()).getByRole('button', { name: 'SPY, choose another Stock Token' }));
    const dialog = screen.getByRole('dialog', { name: 'Choose a Stock Token' });
    expect(within(dialog).getAllByText(DEBT_SECURITY_LINE)).toHaveLength(2);
    expect(within(dialog).getByRole('button', { name: /^SPY/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(dialog).getByRole('button', { name: /^QQQ/ }));

    expect(await amountField('QQQ')).toHaveValue('');
    expect(within(card()).getByRole('button', { name: 'QQQ, choose another Stock Token' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Max, use all 0.033504 QQQ' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Your QQQ' })).toBeInTheDocument();
  });
});

describe('quotes and the wait', () => {
  it('shows a weekend sell as waiting, with the reopen time, and no way to sell yet', async () => {
    renderSell();
    await typeAmount('0.1');
    expect(await screen.findByRole('heading', { name: 'This sell waits for the market' })).toBeInTheDocument();
    expect(card()).toHaveTextContent('Market closed');
    expect(card()).toHaveTextContent('Sleeve does not sell until the market reopens, Sun 27 Sep, 20:00 New York time.');
    expect(within(card()).queryByRole('button', { name: /^Sell 0/ })).toBeNull();
    expect(cta()).toHaveTextContent('Waiting for the market');
    expect(cta()).toBeDisabled();
    expect(screen.getByRole('region', { name: 'Quote at the last price' })).toHaveTextContent('771.16 USDG per SPY');
  });

  it('keeps waiting when the owner closes the risk dialog', async () => {
    renderSell();
    await typeAmount('0.1');
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
    await typeAmount('0.1');

    fireEvent.click(await screen.findByRole('button', { name: 'Sell without waiting' }));
    const dialog = screen.getByRole('dialog', { name: 'Sell without waiting?' });
    expect(dialog).toHaveTextContent(
      'The Chainlink reference for SPY still shows its last price, from 25 Sep 2026, 16:03 UTC. When the market reopens, Sun 27 Sep, 20:00 New York time, the price can move, sometimes by more than your cap.',
    );
    expect(dialog).toHaveTextContent('Last reference772.32 USD per SPY');
    expect(dialog).toHaveTextContent('Market reopensSun 27 Sep, 20:00 New York time');
    fireEvent.click(within(dialog).getByRole('radio', { name: '2.00%' }));
    expect(dialog).toHaveTextContent('At 2.00% the sell takes no less than 756.88 USDG per SPY.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue without waiting' }));

    const heading = await screen.findByRole('heading', { name: 'Your quote' });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(card()).toHaveTextContent('Not waiting for the market');
    expect(card()).toHaveTextContent('77.11');
    const quote = screen.getByRole('region', { name: 'Your quote' });
    expect(quote).toHaveTextContent('771.16 USDG per SPY');
    expect(quote).toHaveTextContent('772.32 USD per SPY');
    expect(quote).toHaveTextContent('Chainlink price from 25 Sep 2026, 16:03 UTC');
    expect(quote).toHaveTextContent('0.16 percent below the market reference');
    expect(quote).toHaveTextContent('Inside the cap for this sell, 2.00 percent');
    expect(quote).toHaveTextContent('Lot 401: 0.08446 SPY');
    expect(quote).toHaveTextContent("One hop through the SPY pool on Sleeve's allowlist, 0.05 percent fee tier.");
    expect(quote).toHaveTextContent('Spend. Sleeve never splits it.');

    fireEvent.click(within(card()).getByRole('button', { name: 'Sell 0.10 SPY' }));
    const preview = await approveSell('Sell 0.10 SPY?');
    expect(preview).toHaveTextContent('0.10 SPY for about 77.116953 USDG');
    expect(preview).toHaveTextContent('from SPY you hold to Spendable');
    expect(preview).toHaveTextContent('The market is closed until Sun 27 Sep, 20:00 New York time. This sale fills now at the pool price instead of waiting.');
    expect(preview).toHaveTextContent("It accepts up to 2.00 percent below the market reference for this sale only. Your rule's cap is 1.00 percent.");
    expect(preview).toHaveTextContent(DEBT_SECURITY_LINE);
    const done = await screen.findByRole('heading', { name: 'Sold 0.10 SPY' });
    await waitFor(() => expect(done).toHaveFocus());
    expect(screen.getByText(/77\.116953 USDG/)).toBeInTheDocument();
    expect(screen.getByText(/It drew from 2 lots, oldest first\./)).toBeInTheDocument();
    const lots = screen.getByRole('region', { name: 'From your lots' });
    expect(within(lots).getByRole('link', { name: 'Lot 401, sale number 700' })).toHaveAttribute('href', '/receipts/700');
    expect(within(lots).getByText('Sold')).toHaveAttribute('data-status', 'SOLD');
    expect(screen.getByRole('link', { name: 'Back to holdings' })).toHaveAttribute('href', '/holdings');
    expect(screen.getByRole('link', { name: 'See history' })).toHaveAttribute('href', '/history');

    const after = await layer.getLedger(SAMPLE_ACCOUNT);
    expect(after.spend - before.spend).toBe(77_116_953n);
    expect([after.unsorted, after.pendingTotal]).toEqual([before.unsorted, before.pendingTotal]);
    const receipt = await layer.getReceipt(700n);
    expect([receipt?.receipt.status, receipt?.receipt.overrideClosed, receipt?.receipt.overrideCapBps]).toEqual(['SOLD', true, 200]);

    // The override belonged to that sell. The next one waits again.
    fireEvent.click(screen.getByRole('button', { name: 'Sell more' }));
    await typeAmount('0.05');
    expect(await screen.findByRole('heading', { name: 'This sell waits for the market' })).toBeInTheDocument();
  });

  it('sells one lot in session, against the rule cap, with the lot chosen in the card', async () => {
    renderSell(openMarket());
    await amountField();
    expect(await within(card()).findByText('Market open')).toBeInTheDocument();

    fireEvent.change(within(card()).getByLabelText('From'), { target: { value: '455' } });
    expect(await amountField()).toHaveValue('0.155872693654184832');

    const quote = await screen.findByRole('region', { name: 'Your quote' });
    expect(quote).toHaveTextContent('Lot 455: 0.155872 SPY');
    expect(quote).not.toHaveTextContent('Lot 401');
    expect(quote).toHaveTextContent("Inside your rule's cap, 1.00 percent");
    expect(card()).not.toHaveTextContent('Not waiting for the market');

    fireEvent.click(within(card()).getByRole('button', { name: 'Sell 0.155872 SPY' }));
    const preview = await approveSell('Sell 0.155872 SPY?');
    expect(preview).toHaveTextContent(/Within your cap of 1\.00 percent below it\./);
    expect(await screen.findByRole('heading', { name: 'Sold 0.155872 SPY' })).toBeInTheDocument();
    expect(screen.getByText(/It drew from one lot\./)).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'From your lots' })).getByText('Sold')).toHaveAttribute('data-status', 'SOLD');
  });

  it('starts on the holding and the lot the owner came from, with what is left in it filled in', async () => {
    const layer = openMarket();
    const qqq = (await layer.getHoldings(SAMPLE_ACCOUNT)).find((holding) => holding.tickerId === 1);
    const lot = qqq?.lots.find((candidate) => candidate.id === 305n);
    renderSell(layer, { initialTicker: 1, initialLot: 305n });
    expect(await amountField('QQQ')).toHaveValue(amountFieldText(lot?.tokensRemaining ?? 0n));
    expect(within(card()).getByLabelText('From')).toHaveValue('305');
    const quote = await screen.findByRole('region', { name: 'Your quote' });
    expect(quote).toHaveTextContent('Lot 305:');
    expect(quote).not.toHaveTextContent('Lot 212');
  });

  it('ignores a lot that belongs to another ticker', async () => {
    renderSell(openMarket(), { initialTicker: 0, initialLot: 305n });
    expect(await amountField('SPY')).toHaveValue('');
    expect(within(card()).getByLabelText('From')).toHaveValue('');
  });

  it('quotes again on refresh', async () => {
    const base = openMarket();
    const getSellQuote = vi.fn((request: SellRequest) => base.getSellQuote(request));
    renderSell({ ...base, getSellQuote });
    await typeAmount('0.1');
    await screen.findByRole('region', { name: 'Your quote' });
    const calls = getSellQuote.mock.calls.length;
    fireEvent.click(within(card()).getByRole('button', { name: 'Refresh the quote' }));
    await waitFor(() => expect(getSellQuote.mock.calls.length).toBe(calls + 1));
  });

  it('says what failed and that nothing moved when the quote does not load', async () => {
    const base = createMockDataLayer();
    renderSell({ ...base, getSellQuote: () => Promise.reject(new DataLayerError({ code: 'NotFound' }, 'no quote')) });
    await typeAmount('0.1');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The quote did not load');
    expect(alert).toHaveTextContent('Nothing moved. Your SPY and your USDG are still in your account.');
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(cta()).toHaveTextContent('Try the quote again');
  });

  it('keeps the quote and the sell button when a sell fails, and says why', async () => {
    const base = openMarket();
    const failing = new DataLayerError({ code: 'SellWaits', reason: 'SESSION', reopensAt: NEXT_OPEN }, 'waits');
    renderSell({ ...base, sell: () => Promise.reject(failing) });
    await typeAmount('0.1');
    await screen.findByRole('region', { name: 'Your quote' });
    const sellButton = within(card()).getByRole('button', { name: 'Sell 0.10 SPY' });
    fireEvent.click(sellButton);
    await approveSell('Sell 0.10 SPY?');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The sell did not go through');
    expect(alert).toHaveTextContent('The market closed before the sell ran. It reopens Sun 27 Sep, 20:00 New York time.');
    expect(alert).toHaveTextContent('Nothing moved. Your SPY and your USDG are still in your account.');
    expect(sellButton).toBeInTheDocument();

    await typeAmount('0.2');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('states around the card', () => {
  it('asks a signed-out visitor to sign in with a passkey or a wallet', async () => {
    const layer = createMockDataLayer();
    await layer.signOut();
    renderSell(layer);
    expect(await screen.findByRole('heading', { name: 'Sign in to sell' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in with your passkey' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in with a wallet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New to Sleeve? Set up your account' })).toHaveAttribute('href', '/onboard');
  });

  it('says there is nothing to sell before the first buy', async () => {
    const layer = createMockDataLayer({ world: createEmptyWorld() });
    await layer.createAccount({ rule: null, recoverySigner: null });
    renderSell(layer);
    expect(await screen.findByRole('heading', { name: 'Nothing to sell yet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See your holdings' })).toHaveAttribute('href', '/holdings');
  });
});

describe('sell page', () => {
  it('renders the title, the way back to holdings, the card and the issuer disclosure with its hash', async () => {
    render(<DataLayerProvider dataLayer={createMockDataLayer()}>{await SellPage({ searchParams: Promise.resolve({}) })}</DataLayerProvider>);
    expect(screen.getByRole('heading', { level: 1, name: 'Sell back' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Holdings' })).toHaveAttribute('href', '/holdings');
    expect(screen.getByRole('region', { name: 'Issuer disclosure' })).toHaveTextContent(
      '0x8408c7a59df30d1b5dbec102c388048f2bf8bba21a2e91ac0806df7d68068e89',
    );
    expect(await amountField()).toBeInTheDocument();
  });

  it('opens on the ticker a holding links to', async () => {
    render(
      <DataLayerProvider dataLayer={createMockDataLayer()}>{await SellPage({ searchParams: Promise.resolve({ ticker: 'qqq' }) })}</DataLayerProvider>,
    );
    expect(await amountField('QQQ')).toBeInTheDocument();
  });
});
