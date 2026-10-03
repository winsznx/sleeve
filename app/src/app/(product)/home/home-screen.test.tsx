import { RULE_DEFAULTS } from '@sleeve/core';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { installDialogPolyfill } from '@/components/__tests__/dialog-polyfill';
import styles from '@/components/ui/motion.module.css';
import { ToastProvider } from '@/components/ui/toast';
import { DataLayerError } from '@/data/errors';
import { buildFixtureWorld, createEmptyWorld, createMockDataLayer, SAMPLE_ACCOUNT, type MockDataLayer } from '@/data/mock';
import { DataLayerProvider } from '@/data/provider';
import type { SleeveDataLayer } from '@/data/types';
import { DEBT_SECURITY_LINE } from '@/lib/copy';

import { HomeScreen } from './home-screen';

const HEADLINE = 'When you get paid, 10% buys SPY. The rest stays spendable.';
const FUNDS_LINE = 'Nothing moved. Your USDG is still in your account.';

beforeAll(() => {
  installDialogPolyfill();
});

afterEach(() => {
  window.localStorage.clear();
});

/** Home as the product shell hosts it: the data layer above it and a toast provider around it. */
function renderHome(layer: SleeveDataLayer = createMockDataLayer()) {
  return render(
    <DataLayerProvider dataLayer={layer}>
      <ToastProvider>
        <HomeScreen />
      </ToastProvider>
    </DataLayerProvider>,
  );
}

async function loaded(): Promise<void> {
  await screen.findByRole('heading', { level: 1, name: HEADLINE });
  await screen.findByRole('region', { name: 'This payday' });
}

function region(name: string): HTMLElement {
  return screen.getByRole('region', { name });
}

function bucketCard(): HTMLElement {
  return screen.getByRole('article', { name: /waiting to buy SPY/ });
}

function dialogElement(): HTMLDialogElement {
  const dialog = document.querySelector('dialog');
  if (dialog === null) throw new Error('no dialog rendered');
  return dialog;
}

/** The element announcing an alert that contains the text. The toast region keeps an empty alert of its own. */
async function alertWith(text: string): Promise<HTMLElement> {
  const alert = (await screen.findByText(text)).closest('[role="alert"]');
  if (!(alert instanceof HTMLElement)) throw new Error(`no alert says ${text}`);
  return alert;
}

describe('HomeScreen', () => {
  it('opens on the sentence: what the rule does with every payment, and what happens while the market is closed', async () => {
    renderHome();
    expect(await screen.findByRole('heading', { level: 1, name: HEADLINE })).toBeInTheDocument();
    expect(
      screen.getByText('SPY Stock Tokens go into your own account. When the market is closed, the 10% waits as USDG and buys at the open.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit rule' })).toHaveAttribute('href', '/rule');
  });

  it('leads with this payday: who paid, how much, and what each part became', async () => {
    // #given the weekend payment that split while the market was closed
    renderHome();
    await loaded();
    const payday = region('This payday');
    // #then the payment, its sender and its arrival time come first
    expect(payday).toHaveTextContent('750.00 USDG');
    expect(payday).toHaveTextContent('From 0x719D…265F');
    expect(payday).toHaveTextContent('arrived 26 Sep 2026, 13:29 UTC');
    expect(payday).toHaveTextContent('Split, equity share waiting');
    // #and the spend part and the waiting equity part each say what they are
    expect(payday).toHaveTextContent('Stayed spendable675.00 USDG90% of this payday, in your account as USDG. Yours to use now.');
    expect(payday).toHaveTextContent('Waiting to buy SPY');
    expect(payday).toHaveTextContent('75.00 USDG');
    expect(payday).toHaveTextContent('Held as USDG in your account because the market is closed.');
    expect(payday).toHaveTextContent('Buys when the market opens, in1d 6hSun 27 Sep, 20:00 New York time');
    // #and how it split, with the record one link away
    expect(payday).toHaveTextContent("Split by Sleeve's keeper under a minute after it arrived, under rule version 2.");
    expect(within(payday).getByRole('link', { name: 'Details and proof of this payday, #642' })).toHaveAttribute('href', '/receipts/642');
    expect(within(payday).getByRole('link', { name: 'All payments' })).toHaveAttribute('href', '/payments');
  });

  it('says newer payments wait to be sorted and leads to them', async () => {
    renderHome();
    await loaded();
    const newer = within(region('This payday')).getByRole('link', {
      name: '2 newer payments, 165.80 USDG, not sorted yet. Spendable now.',
    });
    expect(newer).toHaveAttribute('href', '#waiting');
  });

  it('shows both sleeves, with Stock Tokens at the Chainlink reference and the debt security line', async () => {
    renderHome();
    await loaded();
    const spend = region('Spend');
    const equity = region('Stock Tokens');
    expect(spend).toHaveTextContent('3,356.05 USDG');
    expect(spend).toHaveTextContent('Another 165.80 USDG arrived and is not sorted yet. It is spendable too.');
    expect(within(spend).getByRole('link', { name: 'See payments' })).toHaveAttribute('href', '/payments');
    expect(equity).toHaveTextContent('304.29 USDG');
    expect(equity).toHaveTextContent('SPY and QQQ, at the Chainlink reference');
    expect(within(equity).getByText(DEBT_SECURITY_LINE)).toBeInTheDocument();
    expect(equity).toHaveTextContent('75.00 USDG waiting to buy, held as USDG in your account.');
    expect(within(equity).getByRole('link', { name: 'See holdings' })).toHaveAttribute('href', '/holdings');
  });

  it('explains the waiting SPY buy: how much, why, a countdown to the open, since when, and the release', async () => {
    renderHome();
    await loaded();
    const bucket = bucketCard();
    expect(bucket).toHaveTextContent('Market closed');
    expect(bucket).toHaveTextContent('The market is closed, so it waits as USDG and buys SPY after the open.');
    expect(bucket).toHaveTextContent('1d 6h');
    expect(bucket).toHaveTextContent('Waiting for 4 hours, since 26 Sep 2026, 13:30 UTC.');
    expect(within(bucket).getByRole('button', { name: 'Release to spend' })).toBeEnabled();
  });

  it('releases waiting USDG only after the owner confirms, then links the record of the move', async () => {
    renderHome();
    await loaded();
    fireEvent.click(within(bucketCard()).getByRole('button', { name: 'Release to spend' }));
    const dialog = screen.getByRole('dialog', { name: 'Release 75.00 USDG to spend?' });
    expect(dialog).toHaveAccessibleDescription('It stops waiting to buy SPY and moves to spend. It stays in your account as USDG.');
    // #when the owner confirms
    fireEvent.click(within(dialog).getByRole('button', { name: 'Release to spend' }));
    // #then a toast links the record, the bucket is gone and spend grew by 75 USDG
    const toast = (await screen.findByText('Released 75.00 USDG to spend')).parentElement;
    if (toast === null) throw new Error('no toast');
    expect(within(toast).getByRole('link', { name: 'Open #700' })).toHaveAttribute('href', '/receipts/700');
    expect(dialogElement().open).toBe(false);
    await waitFor(() => expect(screen.queryByRole('article', { name: /waiting to buy SPY/ })).toBeNull());
    await waitFor(() => expect(region('Spend')).toHaveTextContent('3,431.05 USDG'));
  });

  it('keeps the money waiting when the owner backs out of the release', async () => {
    renderHome();
    await loaded();
    fireEvent.click(within(bucketCard()).getByRole('button', { name: 'Release to spend' }));
    fireEvent.click(within(dialogElement()).getByRole('button', { name: 'Keep waiting' }));
    expect(dialogElement().open).toBe(false);
    expect(bucketCard()).toBeInTheDocument();
  });

  it('says what failed and that the USDG is still in the account when a release does not go through', async () => {
    const layer = createMockDataLayer();
    renderHome({
      ...layer,
      release: () => Promise.reject(new DataLayerError({ code: 'SourceUnavailable' }, 'Robinhood Chain did not answer')),
    });
    await loaded();
    fireEvent.click(within(bucketCard()).getByRole('button', { name: 'Release to spend' }));
    fireEvent.click(within(dialogElement()).getByRole('button', { name: 'Release to spend' }));
    const alert = await within(dialogElement()).findByRole('alert');
    expect(alert).toHaveTextContent('The release did not go through');
    expect(alert).toHaveTextContent('Sleeve could not reach Robinhood Chain. Try again in a moment.');
    expect(alert).toHaveTextContent(FUNDS_LINE);
    expect(dialogElement().open).toBe(true);
  });

  it('sorts the unsorted USDG now, and the new split becomes this payday', async () => {
    // #given 165.80 USDG from two payments that the keeper has not sorted
    renderHome();
    await loaded();
    const waiting = region('Waiting');
    const sortCard = within(waiting).getByRole('region', { name: '165.80 USDG not sorted yet' });
    expect(sortCard).toHaveTextContent('Sorting now keeps 149.22 USDG spendable and sets 16.58 USDG aside to buy SPY');
    // #when the owner sorts it now
    fireEvent.click(within(sortCard).getByRole('button', { name: 'Sort now' }));
    // #then a toast links the split and the hero shows it, made from both payments
    const toast = (await screen.findByText('Sorted by your rule')).parentElement;
    if (toast === null) throw new Error('no toast');
    expect(within(toast).getByRole('link', { name: 'Open #700' })).toHaveAttribute('href', '/receipts/700');
    await waitFor(() => expect(region('This payday')).toHaveTextContent('165.80 USDG'));
    expect(region('This payday')).toHaveTextContent('From 2 payments');
    expect(region('This payday')).toHaveTextContent('You split it');
  });

  it('shows a payday that bought: the Stock Token amount, the debt security line and the premium sentence', async () => {
    // #given the market open and a 1,000 USDG payment the keeper split
    const layer: MockDataLayer = createMockDataLayer();
    layer.simulate.openMarket();
    layer.simulate.receivePayment(1_000_000_000n);
    layer.simulate.runKeeper();
    renderHome(layer);
    await screen.findByRole('region', { name: 'This payday' });
    const payday = await screen.findByRole('region', { name: 'This payday' });
    // #then the equity part became SPY, with the line under it
    await waitFor(() => expect(payday).toHaveTextContent('Became SPY'));
    expect(payday).toHaveTextContent('Split and bought');
    expect(within(payday).getByText(DEBT_SECURITY_LINE)).toBeInTheDocument();
    expect(payday).toHaveTextContent(/Bought with 116\.58 USDG\. Bought 0\.\d\d percent (above|below) the market reference\./);
  });

  it('after five days waiting, asks the owner to raise the cap, switch ticker or release, and links the rule', async () => {
    const world = buildFixtureWorld();
    world.clock = { l2Block: world.clock.l2Block + 3_665_088n, timestamp: world.clock.timestamp + 432_000n };
    renderHome(createMockDataLayer({ world }));
    await loaded();
    const bucket = bucketCard();
    expect(bucket).toHaveTextContent('Waiting for 5 days');
    expect(bucket).toHaveTextContent('You can raise your cap, switch ticker, or release it to spend.');
    expect(within(bucket).getByRole('link', { name: 'Edit your rule' })).toHaveAttribute('href', '/rule');
  });

  it('with the rule paused, says new payments stay unsorted and spendable until it resumes', async () => {
    const layer = createMockDataLayer();
    await layer.pauseRule();
    renderHome(layer);
    expect(await screen.findByRole('heading', { level: 1, name: 'Your rule is paused.' })).toBeInTheDocument();
    expect(await screen.findByText('Your rule is paused, so this stays unsorted and spendable until you resume it.')).toBeInTheDocument();
  });

  it('shows the full payment address with copy and a QR code, and the network payers send on', async () => {
    renderHome();
    await loaded();
    const address = screen.getByRole('group', { name: 'Payment address' });
    expect(address).toHaveTextContent(SAMPLE_ACCOUNT);
    expect(within(address).getByRole('button', { name: 'Copy payment address' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'QR code of your payment address' })).toBeInTheDocument();
  });

  it('shows the holdings by value, each with the debt security line and the time of the price behind it', async () => {
    renderHome();
    await loaded();
    const holdings = region('Holdings');
    expect(holdings).toHaveTextContent('304.29 USDG');
    expect(holdings).toHaveTextContent('0.361668 SPY');
    expect(holdings).toHaveTextContent('279.32 USDG91.8 percent');
    expect(within(holdings).getAllByText(DEBT_SECURITY_LINE)).toHaveLength(2);
    expect(holdings).toHaveTextContent('Value is balance times the Chainlink price from 25 Sep 2026, 16:03 UTC.');
    expect(within(holdings).getByRole('link', { name: 'See holdings' })).toHaveAttribute('href', '/holdings');
  });

  it('lists the latest payments and what each became, not receipts', async () => {
    renderHome();
    await loaded();
    const recent = region('Recent payments');
    const list = within(recent).getAllByRole('list')[0];
    if (list === undefined) throw new Error('no list of payments');
    const rows = [...list.children] as HTMLElement[];
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent('45.80 USDGReceived');
    expect(rows[2]).toHaveTextContent('675.00 USDG stayed spendable');
    expect(within(rows[3] ?? recent).getByRole('link', { name: '937.25 USDG, details and proof' })).toHaveAttribute(
      'href',
      '/receipts/611',
    );
    expect(rows[3]).toHaveTextContent('93.725 USDG became 0.121335 SPY');
    expect(within(recent).getByRole('link', { name: 'See all payments' })).toHaveAttribute('href', '/payments');
    expect(screen.getByRole('link', { name: /^History/ })).toHaveAttribute('href', '/history');
  });

  it('before anything arrives, says nothing splits until USDG comes from outside and shows what a payday would do', async () => {
    const layer = createMockDataLayer();
    const session = await layer.createAccount({ rule: { ...RULE_DEFAULTS }, recoverySigner: null });
    renderHome(layer);
    const empty = await screen.findByRole('heading', { name: 'Nothing has arrived yet' });
    expect(empty.parentElement).toHaveTextContent('Nothing splits until USDG arrives from outside. Top-ups through the app do not split.');
    expect(screen.getByRole('group', { name: 'Payment address' })).toHaveTextContent(session.account);
    expect(region('Stock Tokens')).toHaveTextContent('None yet');
    expect(await screen.findByRole('region', { name: 'On a 500 USDG payday' })).toHaveTextContent('450.00 USDGstays spendable');
    expect(screen.queryByRole('region', { name: 'This payday' })).toBeNull();
  });

  it('holds every block in place while the account loads, without drawing a zero balance', async () => {
    renderHome(createMockDataLayer({ latencyMs: 30 }));
    expect(screen.getByText('Loading your account')).toBeInTheDocument();
    expect(screen.queryByText(/USDG/)).toBeNull();
    await loaded();
  });

  it('says what did not load and that the USDG is still there, then loads on a second try', async () => {
    const layer = createMockDataLayer();
    let answered = false;
    renderHome({
      ...layer,
      getLedger: (account) => {
        if (answered) return layer.getLedger(account);
        answered = true;
        return Promise.reject(new Error('Robinhood Chain did not answer'));
      },
    });
    const alert = await alertWith('Your account did not load');
    expect(alert).toHaveTextContent(FUNDS_LINE);
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(region('Spend')).toHaveTextContent('3,356.05 USDG'));
  });

  it('signs a returning owner in with their passkey and shows the account', async () => {
    const layer = createMockDataLayer();
    await layer.signOut();
    renderHome(layer);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in with your passkey' }));
    await loaded();
  });

  it('says plainly when the passkey does not sign anyone in, and offers setup', async () => {
    renderHome(createMockDataLayer({ world: createEmptyWorld() }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in with your passkey' }));
    expect(await alertWith('Your passkey did not sign you in. Try again, or set up Sleeve if you are new here.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New to Sleeve? Set up your account' })).toHaveAttribute('href', '/onboard');
  });

  it('grows the equity part of the rail the first time a payday shows, and keeps it still on the next visit', async () => {
    const first = renderHome();
    await loaded();
    const grow = styles.grow;
    if (grow === undefined) throw new Error('the grow class is missing from the stylesheet');
    expect(region('This payday').querySelector('[data-part="waiting"]')).toHaveClass(grow);
    first.unmount();
    renderHome();
    await loaded();
    expect(region('This payday').querySelector('[data-part="waiting"]')).not.toHaveClass(grow);
  });
});
