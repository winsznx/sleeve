import { RULE_DEFAULTS, tokenValueUsdg } from '@sleeve/core';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createEmptyWorld, createMockDataLayer, SAMPLE_ACCOUNT } from '@/data/mock';
import { DataLayerProvider } from '@/data/provider';
import type { Holding, SleeveDataLayer } from '@/data/types';
import { DEBT_SECURITY_LINE, EXIT_LINE } from '@/lib/copy';

import { HoldingsScreen } from './holdings-screen';

const SPY = 0;
const NVDA = 2;
/** 0.05 of a Stock Token in base units. */
const FIVE_HUNDREDTHS = 50_000_000_000_000_000n;

function renderHoldings(layer: SleeveDataLayer = createMockDataLayer()): SleeveDataLayer {
  render(
    <DataLayerProvider dataLayer={layer}>
      <HoldingsScreen />
    </DataLayerProvider>,
  );
  return layer;
}

/** The sample layer with getHoldings rewritten, for balances the sample history does not produce. */
function withHoldings(rewrite: (holdings: Holding[], layer: SleeveDataLayer) => Holding[] | Promise<Holding[]>): SleeveDataLayer {
  const layer = createMockDataLayer();
  return { ...layer, getHoldings: async (account) => rewrite(await layer.getHoldings(account), layer) };
}

async function holding(symbol: string): Promise<HTMLElement> {
  return screen.findByRole('article', { name: symbol });
}

function allocation(): HTMLElement {
  return screen.getByRole('region', { name: 'Stock Tokens, at the Chainlink reference' });
}

describe('holdings', () => {
  it('lists each Stock Token held, largest value first, with its icon, balance and the debt security line', async () => {
    renderHoldings();
    expect(screen.getByRole('heading', { level: 1, name: 'Holdings' })).toBeInTheDocument();
    const spy = await holding('SPY');
    const qqq = await holding('QQQ');
    expect(spy.compareDocumentPosition(qqq) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(spy.querySelector('[data-token="SPY"]')).not.toBeNull();
    expect(spy).toHaveTextContent('SPDR S&P 500 ETF Trust');
    expect(spy).toHaveTextContent('You hold0.361668 SPY');
    expect(within(spy).getByText(DEBT_SECURITY_LINE)).toBeInTheDocument();
    expect(qqq.querySelector('[data-token="QQQ"]')).not.toBeNull();
    expect(qqq).toHaveTextContent('0.033504 QQQ');
    expect(within(qqq).getByText(DEBT_SECURITY_LINE)).toBeInTheDocument();
  });

  it('values each holding at the Chainlink reference with its time, and quotes the pool apart with its own time', async () => {
    renderHoldings();
    const spy = await holding('SPY');
    expect(spy).toHaveTextContent('Value at the Chainlink reference279.32 USDG');
    expect(spy).toHaveTextContent('772.32 USD per SPY, published 25 Sep 2026, 16:03 UTC');
    expect(await within(spy).findByText('Pool price now')).toBeInTheDocument();
    expect(spy).toHaveTextContent('771.97 USDG per SPY');
    expect(spy).toHaveTextContent('Quoted 26 Sep 2026, 18:00 UTC. The pool is 0.04 percent below the reference.');
  });

  it("lists a holding's lots oldest first, each opening the buy that opened it, with what was sold", async () => {
    renderHoldings();
    const spy = await holding('SPY');
    const lots = within(spy).getAllByRole('link', { name: /^Lot \d+$/ });
    expect(lots.map((lot) => lot.getAttribute('href'))).toEqual(['/receipts/401', '/receipts/455', '/receipts/611']);
    expect(spy).toHaveTextContent('Bought 22 Sep 2026 at 769.85 USDG per SPY, 0.04 percent above the reference. Nothing sold yet.');

    const qqq = await holding('QQQ');
    expect(within(qqq).getByRole('link', { name: 'Lot 305' })).toHaveAttribute('href', '/receipts/305');
    expect(qqq).toHaveTextContent('0.021973 QQQ sold.');
  });

  it('opens sell-back on the holding it came from', async () => {
    renderHoldings();
    expect(within(await holding('SPY')).getByRole('link', { name: 'Sell SPY' })).toHaveAttribute('href', '/sell?ticker=SPY');
    expect(within(await holding('QQQ')).getByRole('link', { name: 'Sell QQQ' })).toHaveAttribute('href', '/sell?ticker=QQQ');
  });

  it('shows the total at the reference, the parts by value adding up to 100 percent, the session and the rule', async () => {
    renderHoldings();
    await holding('SPY');
    const top = allocation();
    expect(top).toHaveTextContent('304.29 USDG');
    expect(top).toHaveTextContent('2 Stock Tokens in 4 lots');
    const parts = within(within(top).getByRole('list', { name: 'By value' })).getAllByRole('listitem');
    expect(parts.map((part) => part.textContent)).toEqual(['SPY91.8 percent279.32 USDG', 'QQQ8.2 percent24.97 USDG']);
    expect(within(parts[0] ?? top).getByRole('link', { name: 'SPY' })).toHaveAttribute('href', '#holding-SPY');
    expect(await within(top).findByText('Market closed')).toBeInTheDocument();
    expect(top).toHaveTextContent('Opens Sun 27 Sep, 20:00 New York time');
    expect(await within(top).findByText('Your rule adds 10 percent of every payday to SPY.')).toBeInTheDocument();
  });

  it('says how selling works with the exit line', async () => {
    renderHoldings();
    await holding('SPY');
    const selling = screen.getByRole('region', { name: 'How selling works' });
    expect(within(selling).getByText(EXIT_LINE)).toBeInTheDocument();
    expect(selling).toHaveTextContent('The USDG goes to spend and is never split.');
  });
});

describe('tokens that arrived outside Sleeve', () => {
  it('counts them in the balance and says they cannot be sold here', async () => {
    renderHoldings(
      withHoldings((holdings) =>
        holdings.map((entry) => (entry.tickerId === SPY ? { ...entry, balance: entry.balance + FIVE_HUNDREDTHS } : entry)),
      ),
    );
    const spy = await holding('SPY');
    expect(spy).toHaveTextContent('You hold0.411668 SPY');
    expect(spy).toHaveTextContent('0.05 SPY arrived outside Sleeve and cannot be sold here.');
    expect(within(spy).getByRole('link', { name: 'Sell SPY' })).toBeInTheDocument();
  });

  it('offers no sell for a holding with no lots', async () => {
    renderHoldings(
      withHoldings(async (holdings, layer) => {
        const market = await layer.getMarket();
        const feed = market.tickers.find((ticker) => ticker.tickerId === NVDA)?.feed;
        if (feed === undefined) throw new Error('the sample market has NVDA');
        const nvda: Holding = {
          tickerId: NVDA,
          balance: 10n ** 18n,
          inLots: 0n,
          value: tokenValueUsdg(10n ** 18n, feed.answer),
          feed,
          lots: [],
        };
        return [...holdings, nvda];
      }),
    );
    const nvda = await holding('NVDA');
    expect(nvda).toHaveTextContent('1.00 NVDA arrived outside Sleeve and cannot be sold here.');
    expect(within(nvda).queryByRole('link', { name: 'Sell NVDA' })).toBeNull();
    expect(within(nvda).queryByText('Lots, oldest first')).toBeNull();
    expect(within(nvda).getByText(DEBT_SECURITY_LINE)).toBeInTheDocument();
  });
});

describe('USDG waiting to buy', () => {
  it('sits under the holding it will add to, with why it waits, until when, and a way to its release', async () => {
    renderHoldings();
    const spy = await holding('SPY');
    const strip = await waitFor(() => {
      const found = spy.querySelector<HTMLElement>('[data-waiting="SPY"]');
      if (found === null) throw new Error('the waiting strip has not drawn yet');
      return found;
    });
    expect(strip).toHaveTextContent('75.00 USDG waits to buy more SPY');
    expect(strip).toHaveTextContent('The market is closed. Sleeve buys SPY after it reopens, Sun 27 Sep, 20:00 New York time.');
    expect(within(strip).getByRole('link', { name: 'See it on Home' })).toHaveAttribute('href', '/home');
    expect((await holding('QQQ')).querySelector('[data-waiting]')).toBeNull();
  });

  it('lists a wait for a Stock Token the account does not hold yet on its own', async () => {
    const layer = createMockDataLayer();
    renderHoldings({
      ...layer,
      getBuckets: async (account) => [
        ...(await layer.getBuckets(account)),
        { tickerId: NVDA, amount: 30_000_000n, since: 1_790_400_000n, reason: 'SESSION' },
      ],
    });
    const section = await screen.findByRole('region', { name: 'Waiting to buy' });
    expect(section).toHaveTextContent('30.00 USDG waits to buy NVDA');
    expect(section.querySelector('[data-waiting="SPY"]')).toBeNull();
  });

  it('says nothing is bought yet when the first buy is still waiting', async () => {
    const layer = createMockDataLayer({ world: createEmptyWorld() });
    await layer.createAccount({ rule: { ...RULE_DEFAULTS }, recoverySigner: null });
    layer.simulate.receivePayment(500_000_000n);
    layer.simulate.runKeeper();
    renderHoldings(layer);
    expect(await screen.findByRole('heading', { name: 'Nothing bought yet' })).toBeInTheDocument();
    expect(document.querySelector('[data-waiting="SPY"]')).toHaveTextContent('50.00 USDG waits to buy SPY');
    expect(screen.queryByRole('heading', { name: 'No Stock Tokens yet' })).toBeNull();
  });
});

describe('holdings states', () => {
  it('holds the layout with a labelled skeleton while the account loads', () => {
    const layer = createMockDataLayer();
    renderHoldings({ ...layer, getSession: () => new Promise(() => undefined) });
    expect(screen.getByRole('status')).toHaveTextContent('Loading your holdings');
    expect(screen.getByRole('heading', { level: 1, name: 'Holdings' })).toBeInTheDocument();
  });

  it('says nothing has split yet and offers the payment address when nothing is held', async () => {
    const layer = createMockDataLayer({ world: createEmptyWorld() });
    const session = await layer.createAccount({ rule: null, recoverySigner: null });
    renderHoldings(layer);
    expect(await screen.findByRole('heading', { name: 'No Stock Tokens yet' })).toBeInTheDocument();
    expect(screen.getByText(/Nothing splits until USDG arrives from outside\./)).toBeInTheDocument();
    expect(screen.getByText(session.account)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy payment address' })).toBeInTheDocument();
  });

  it('asks a signed-out visitor to sign in with a passkey or a wallet, then shows their holdings', async () => {
    const layer = createMockDataLayer();
    await layer.signOut();
    renderHoldings(layer);
    expect(await screen.findByRole('heading', { name: 'Sign in to see your holdings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in with a wallet' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with your passkey' }));
    expect(await holding('SPY')).toBeInTheDocument();
  });

  it('says the holdings did not load, that nothing moved, and tries again on request', async () => {
    const base = createMockDataLayer();
    const getHoldings = vi.fn().mockRejectedValueOnce(new Error('socket closed')).mockImplementation(base.getHoldings);
    renderHoldings({ ...base, getHoldings });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Your holdings did not load');
    expect(alert).toHaveTextContent('Nothing moved. Your Stock Tokens are still in your account.');
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await holding('SPY')).toBeInTheDocument();
    expect(getHoldings).toHaveBeenCalledWith(SAMPLE_ACCOUNT);
  });

  it('keeps the holdings at their Chainlink values when the live market does not load', async () => {
    const layer = createMockDataLayer();
    renderHoldings({ ...layer, getMarket: () => Promise.reject(new Error('rate limited')) });
    const spy = await holding('SPY');
    expect(spy).toHaveTextContent('279.32 USDG');
    expect(await screen.findByText('Live market data did not load')).toBeInTheDocument();
    await waitFor(() => expect(within(spy).queryByText('Pool price now')).toBeNull());
  });
});
