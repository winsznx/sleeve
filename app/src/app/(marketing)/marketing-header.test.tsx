import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { installDialogPolyfill, pressEscapeOn } from '@/components/__tests__/dialog-polyfill';
import { createMockDataLayer } from '@/data/mock';
import { DataLayerProvider } from '@/data/provider';
import { DISCLAIMER } from '@/lib/copy';

import { MarketingHeader } from './marketing-header';

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}));

beforeAll(() => {
  installDialogPolyfill();
});

function renderHeader() {
  return render(
    <DataLayerProvider dataLayer={createMockDataLayer()}>
      <MarketingHeader />
    </DataLayerProvider>,
  );
}

function mainNav(): HTMLElement {
  return screen.getByRole('navigation', { name: 'Main' });
}

function trigger(name: 'Product' | 'Proof'): HTMLElement {
  return within(mainNav()).getByRole('button', { name });
}

describe('MarketingHeader menus', () => {
  it('opens one menu at a time, swaps between them, and closes with Escape back on its trigger', () => {
    // #given the bar with both menus closed
    renderHeader();
    expect(trigger('Product')).toHaveAttribute('aria-expanded', 'false');

    // #when Product is opened, then Proof
    fireEvent.click(trigger('Product'));
    expect(trigger('Product')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', { name: 'Product' })).toBeInTheDocument();
    fireEvent.click(trigger('Proof'));

    // #then only Proof is open, and Escape closes it and returns focus to its trigger
    expect(trigger('Product')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: 'Product' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Proof' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Proof' })).toBeNull();
    expect(trigger('Proof')).toHaveFocus();
  });

  it('puts each panel right after its trigger, so Tab walks from the trigger into the panel', () => {
    renderHeader();
    fireEvent.click(trigger('Product'));
    const panel = screen.getByRole('region', { name: 'Product' });
    expect(trigger('Product')).toHaveAttribute('aria-controls', panel.id);
    expect(trigger('Product').compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(panel.compareDocumentPosition(trigger('Proof')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('closes when focus leaves the trigger and its panel, and stays open while focus is inside', () => {
    renderHeader();
    fireEvent.click(trigger('Product'));
    const firstLink = within(screen.getByRole('region', { name: 'Product' })).getAllByRole('link')[0] as HTMLElement;
    fireEvent.blur(trigger('Product'), { relatedTarget: firstLink });
    expect(trigger('Product')).toHaveAttribute('aria-expanded', 'true');
    fireEvent.blur(firstLink, { relatedTarget: trigger('Proof') });
    expect(trigger('Product')).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes a pinned menu on a second click, on a press outside the menus and on the session pill', async () => {
    renderHeader();
    fireEvent.click(trigger('Product'));
    fireEvent.click(trigger('Product'));
    expect(trigger('Product')).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger('Product'));
    fireEvent.pointerDown(document.body);
    expect(trigger('Product')).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger('Product'));
    fireEvent.pointerDown(await screen.findByRole('button', { name: /^Market closed/ }));
    expect(trigger('Product')).toHaveAttribute('aria-expanded', 'false');
  });

  it('leads the Product menu with the payday split, live from the market', async () => {
    renderHeader();
    fireEvent.click(trigger('Product'));
    const panel = screen.getByRole('region', { name: 'Product' });
    expect(within(panel).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/#how-it-works',
      '/#two-sleeves',
      '/#your-rule',
      '/#holdings',
      '/#launch-tickers',
    ]);
    // The sample market is closed for the weekend, so the equity share of a payday would wait for Sunday's open.
    expect(await within(panel).findByText(/would stay spendable/)).toBeInTheDocument();
    expect(panel).toHaveTextContent('If 500 USDG arrived now');
    expect(panel).toHaveTextContent('450.00 USDG would stay spendable');
    expect(panel).toHaveTextContent('50.00 USDG would wait as USDG until Sun 27 Sep, 20:00 New York time');
    expect(panel).toHaveTextContent('Market closed. The equity share of a payment that arrives now waits as USDG');
  });

  it('says a payday would buy while the market is open, with the debt security line under it', async () => {
    const layer = createMockDataLayer();
    layer.simulate.openMarket();
    render(
      <DataLayerProvider dataLayer={layer}>
        <MarketingHeader />
      </DataLayerProvider>,
    );
    fireEvent.click(trigger('Product'));
    const panel = screen.getByRole('region', { name: 'Product' });
    expect(await within(panel).findByText('would buy SPY now')).toBeInTheDocument();
    expect(within(panel).getByText('debt security, not a share')).toBeInTheDocument();
    expect(panel).toHaveTextContent('Market open. A payment that arrives now can buy its Stock Token within the price cap');
  });

  it('checks a split from the Proof menu by sending the receipt number to the verify page', () => {
    renderHeader();
    fireEvent.click(trigger('Proof'));
    const panel = screen.getByRole('region', { name: 'Proof' });
    const input = within(panel).getByRole('textbox', { name: 'Receipt number' });
    expect(input).toHaveAttribute('name', 'id');
    expect(input.closest('form')).toHaveAttribute('action', '/verify');
    expect(within(panel).getByRole('link', { name: /Check a split/ })).toHaveAttribute('href', '/verify');
  });
});

describe('MarketingHeader live chips', () => {
  it('counts down to the next open in the session pill, and says it in full to screen readers', async () => {
    renderHeader();
    const pill = await screen.findByRole('button', {
      name: 'Market closed, opens Sunday 27 September at 20:00 New York time, in 1 day 6 hours. Market details.',
    });
    expect(pill).toHaveTextContent('opens in 1d 6h');

    // #when the pill is opened (a sheet without a wide screen)
    fireEvent.click(pill);
    const sheet = screen.getByRole('dialog', { name: 'Market session' });
    // #then every launch ticker shows its pool quote and its Chainlink reference apart
    expect(within(sheet).getByRole('list', { name: 'Launch Stock Tokens' }).children).toHaveLength(4);
    expect(sheet).toHaveTextContent('The pool quote and the Chainlink reference are shown apart, never merged.');
    expect(sheet).toHaveTextContent('keeps its equity share as USDG and buys SPY at the open');
  });

  it('names the network in words and keeps the disclaimer with it', () => {
    renderHeader();
    fireEvent.click(screen.getByRole('button', { name: 'Robinhood Chain' }));
    expect(screen.getByRole('dialog', { name: 'Robinhood Chain' })).toHaveTextContent(DISCLAIMER);
  });

  it('opens the app as the signed-in account, with its avatar in the pill', async () => {
    renderHeader();
    const way = await screen.findByRole('link', { name: 'Open the app as 0x3efE…9b36' });
    expect(way).toHaveAttribute('href', '/home');
    expect(way).toHaveTextContent('Open the app');
  });
});

describe('MarketingHeader phone sheet', () => {
  it('opens the same content in a full-height sheet, with the way in pinned and the disclaimer', async () => {
    renderHeader();
    const menu = screen.getByRole('button', { name: 'Menu' });
    fireEvent.click(menu);
    expect(menu).toHaveAttribute('aria-expanded', 'true');
    const sheet = screen.getByRole('dialog', { name: 'Menu' });

    // Product opens first; Proof opens in place.
    expect(within(sheet).getByRole('button', { name: 'Product' })).toHaveAttribute('aria-expanded', 'true');
    const proof = within(sheet).getByRole('button', { name: 'Proof' });
    expect(proof).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(proof);
    expect(within(sheet).getByRole('region', { name: 'Proof' })).toHaveTextContent('Security and audit');

    expect(within(sheet).getByRole('link', { name: 'Open the app' })).toHaveAttribute('href', '/home');
    expect(sheet).toHaveTextContent('Sign in with a passkey or a wallet.');
    expect(sheet).toHaveTextContent(DISCLAIMER);
    expect(await within(sheet).findByText('SPY')).toBeInTheDocument();

    if (!(sheet instanceof HTMLDialogElement)) throw new Error('the sheet is not a dialog element');
    act(() => pressEscapeOn(sheet));
    expect(menu).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes the sheet when one of its links is followed', () => {
    renderHeader();
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    const sheet = screen.getByRole('dialog', { name: 'Menu' });
    document.addEventListener('click', (event) => event.preventDefault(), { once: true });
    fireEvent.click(within(sheet).getByRole('link', { name: /The two sleeves/ }));
    expect(screen.getByRole('button', { name: 'Menu' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('never names a gated feature', () => {
    renderHeader();
    fireEvent.click(trigger('Product'));
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    expect(document.body.textContent ?? '').not.toMatch(/borrow|pay link|basket|crew/i);
  });
});
