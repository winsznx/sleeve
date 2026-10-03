import { RULE_DEFAULTS } from '@sleeve/core';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { installDialogPolyfill } from '@/components/__tests__/dialog-polyfill';
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
  await screen.findByRole('region', { name: 'Your money' });
}

function region(name: string): HTMLElement {
  return screen.getByRole('region', { name });
}

function bucketCard(): HTMLElement {
  return screen.getByRole('article', { name: /waiting to buy SPY/ });
}

function dialogElement(): HTMLDialogElement {
  const dialog = document.querySelector('dialog[open]') ?? document.querySelector('dialog');
  if (!(dialog instanceof HTMLDialogElement)) throw new Error('no dialog rendered');
  return dialog;
}

/** Presses a dialog's confirm once the transaction preview has read and enabled it. */
async function approve(dialog: HTMLElement, name: string): Promise<void> {
  const button = within(dialog).getByRole('button', { name });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
}

/** The element announcing an alert that contains the text. The toast region keeps an empty alert of its own. */
async function alertWith(text: string): Promise<HTMLElement> {
  const alert = (await screen.findByText(text)).closest('[role="alert"]');
  if (!(alert instanceof HTMLElement)) throw new Error(`no alert says ${text}`);
  return alert;
}

function cellNamed(calendar: HTMLElement, text: string): HTMLElement {
  const cell = within(calendar).getByText(text, { exact: false });
  return cell;
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

  it('shows the money at a glance: spendable, Stock Tokens and waiting with its reason, and the ways to send and receive', async () => {
    renderHome();
    await loaded();
    const money = region('Your money');
    expect(money).toHaveTextContent('3,901.15 USDG');
    expect(money).toHaveTextContent('In your own account on Robinhood Chain, Stock Tokens valued at the Chainlink reference.');
    expect(money).toHaveTextContent('Spendable3,356.05 USDG');
    expect(money).toHaveTextContent('Plus 165.80 USDG not sorted yet, also spendable.');
    expect(money).toHaveTextContent('Stock Tokens304.29 USDG');
    expect(money).toHaveTextContent('SPY and QQQ at the Chainlink reference');
    expect(within(money).getByText(DEBT_SECURITY_LINE)).toBeInTheDocument();
    expect(money).toHaveTextContent('Waiting to buy SPY75.00 USDG');
    expect(money).toHaveTextContent('Market closed');
    expect(within(money).getByRole('link', { name: 'Send' })).toHaveAttribute('href', '/send');
    expect(within(money).getByRole('link', { name: 'Receive' })).toHaveAttribute('href', '#receive');
  });

  it('says what happens next to the money that is not settled yet', async () => {
    renderHome();
    await loaded();
    const money = region('Your money');
    expect(money).toHaveTextContent(
      '165.80 USDG not sorted yet splits next: 149.22 USDG stays spendable and 16.58 USDG waits to buy SPY.',
    );
    expect(money).toHaveTextContent('75.00 USDG buys SPY after the market opens, Sun 27 Sep, 20:00 New York time.');
  });

  it('charts paydays as stacked bars, the latest chosen with its amount, and says what a chosen payday became', async () => {
    renderHome();
    await loaded();
    const paydays = region('Paydays');
    expect(paydays).toHaveTextContent('5,349.75 USDG');
    expect(paydays).toHaveTextContent('arrived in 8 paydays');
    const bars = within(within(paydays).getByRole('group', { name: 'USDG that arrived each payday' })).getAllByRole('button');
    expect(bars).toHaveLength(8);
    expect(bars.at(-1)).toHaveAttribute('aria-pressed', 'true');
    expect(bars.at(-1)).toHaveAccessibleName(
      'Saturday 26 September: 750.00 USDG arrived. 675.00 USDG stayed spendable and 75.00 USDG waits to buy SPY.',
    );
    expect(paydays).toHaveTextContent('750.00 USDG arrived. 675.00 USDG stayed spendable and 75.00 USDG waits to buy SPY.');
    expect(within(paydays).getByRole('link', { name: 'Details of #642' })).toHaveAttribute('href', '/receipts/642');

    // #when the owner picks the 22 September payday
    const tuesday = bars.find((bar) => bar.getAttribute('aria-label')?.startsWith('Tuesday 22 September'));
    if (tuesday === undefined) throw new Error('no 22 September bar');
    fireEvent.click(tuesday);
    expect(tuesday).toHaveAttribute('aria-pressed', 'true');
    expect(paydays).toHaveTextContent('1,200.00 USDG arrived. 1,080.00 USDG stayed spendable and 120.00 USDG bought SPY.');
    expect(within(paydays).getByRole('link', { name: 'Details of #455' })).toHaveAttribute('href', '/receipts/455');

    // #when the owner switches to weeks
    fireEvent.click(within(paydays).getByRole('radio', { name: 'Weeks' }));
    const weeks = within(within(paydays).getByRole('group', { name: 'USDG that arrived each week' })).getAllByRole('button');
    expect(weeks).toHaveLength(2);
    expect(paydays).toHaveTextContent('Week of Monday 21 September, 4 paydays');
  });

  it('puts paydays and market sessions on the month, with today and the next open marked', async () => {
    renderHome();
    await loaded();
    const calendar = region('Calendar');
    expect(within(calendar).getByRole('table', { name: 'September 2026' })).toBeInTheDocument();
    expect(cellNamed(calendar, 'Saturday 26 September, today, market closed, 1 payday: waits to buy')).toBeInTheDocument();
    expect(cellNamed(calendar, 'Sunday 27 September, market closed, the market opens again this evening')).toBeInTheDocument();
    expect(cellNamed(calendar, 'Monday 7 September, market holiday')).toBeInTheDocument();
    expect(cellNamed(calendar, 'Tuesday 22 September, market open, 1 payday: bought Stock Tokens')).toBeInTheDocument();
    await waitFor(() => expect(calendar).toHaveTextContent('Market closed'));
    fireEvent.click(within(calendar).getByRole('button', { name: 'Next month' }));
    expect(within(calendar).getByRole('table', { name: 'October 2026' })).toBeInTheDocument();
  });

  it('lists the latest payments with where each stands and where it went, each opening its money trail', async () => {
    renderHome();
    await loaded();
    const recent = region('Recent payments');
    const list = within(recent).getAllByRole('list')[0];
    if (list === undefined) throw new Error('no list of payments');
    const rows = [...list.children] as HTMLElement[];
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('45.80 USDG');
    expect(rows[0]).toHaveTextContent('Received');
    expect(rows[0]).toHaveTextContent('Spendable until your rule splits it');
    expect(rows[1]).toHaveTextContent('Waiting to sort');
    expect(rows[2]).toHaveTextContent('Waiting for the market');
    await waitFor(() => expect(rows[2]).toHaveTextContent('675.00 USDG spendable, 75.00 USDG waiting for SPY'));
    const link = within(rows[2] ?? recent).getByRole('link', { name: '750.00 USDG, see its money trail' });
    expect(link.getAttribute('href')).toMatch(/^\/payments#payment-0x[0-9a-f]{64}:0$/);
    expect(within(recent).getByRole('link', { name: 'See every payment' })).toHaveAttribute('href', '/payments');
  });

  it('shows the Stock Tokens by ticker as a ring, with each icon, value and part, and the line under them', async () => {
    renderHome();
    await loaded();
    const tokens = region('Stock Tokens');
    expect(tokens).toHaveTextContent('304.29USDG in total');
    const spy = within(tokens).getByRole('button', { name: 'SPY: 279.32 USDG, 92% of your Stock Tokens' });
    expect(within(tokens).getByRole('button', { name: 'QQQ: 24.97 USDG, 8% of your Stock Tokens' })).toBeInTheDocument();
    expect(within(tokens).getByText(DEBT_SECURITY_LINE)).toBeInTheDocument();
    expect(tokens).toHaveTextContent('Plus 75.00 USDG waiting to buy, held as USDG.');
    fireEvent.focus(spy);
    expect(tokens).toHaveTextContent('279.32USDG in SPY');
    expect(within(tokens).getByRole('link', { name: 'See holdings' })).toHaveAttribute('href', '/holdings');
  });

  it('answers the common questions on the help page, beside two counts of how the account runs', async () => {
    renderHome();
    await loaded();
    const questions = region('Questions');
    expect(questions).toHaveTextContent('Paydays this month8');
    expect(questions).toHaveTextContent('Sorted for you9 of 9');
    expect(within(questions).getByRole('link', { name: 'Why is part of my payment waiting?' })).toHaveAttribute('href', '/help');
    expect(within(questions).getByRole('link', { name: 'Open help' })).toHaveAttribute('href', '/help');
  });

  it('shows the full payment address with copy and a QR code, and the network payers send on', async () => {
    renderHome();
    await loaded();
    const address = screen.getByRole('group', { name: 'Payment address' });
    expect(address).toHaveTextContent(SAMPLE_ACCOUNT);
    expect(within(address).getByRole('button', { name: 'Copy payment address' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'QR code of your payment address' })).toBeInTheDocument();
  });

  it('explains the waiting SPY buy: how much, why, a countdown to the open, since when, and the release', async () => {
    renderHome();
    await loaded();
    const bucket = bucketCard();
    expect(bucket).toHaveTextContent('Market closed');
    expect(bucket).toHaveTextContent('The market is closed, so it waits as USDG and buys SPY after the open.');
    await waitFor(() => expect(bucket).toHaveTextContent('1d 6h'));
    expect(bucket).toHaveTextContent('Waiting for 4 hours, since 26 Sep 2026, 13:30 UTC.');
    expect(within(bucket).getByRole('button', { name: 'Release to spend' })).toBeEnabled();
    expect(within(bucket).queryByRole('button', { name: 'Buy SPY now' })).toBeNull();
  });

  it('releases waiting USDG only after a preview and the owner confirming, then links the record of the move', async () => {
    renderHome();
    await loaded();
    fireEvent.click(within(bucketCard()).getByRole('button', { name: 'Release to spend' }));
    const dialog = screen.getByRole('dialog', { name: 'Release 75.00 USDG to spend?' });
    expect(dialog).toHaveAccessibleDescription('It stops waiting to buy SPY and moves to spend. It stays in your account as USDG.');
    const preview = await within(dialog).findByRole('region', { name: 'Preview' });
    expect(preview).toHaveTextContent('75.00 USDG');
    expect(preview).toHaveTextContent('from Waiting to buy SPY to Spendable');
    expect(preview).toHaveTextContent('It stops waiting and will not buy SPY. It stays in your account as spendable USDG.');
    // #when the owner confirms
    await approve(dialog, 'Approve and release');
    // #then a toast links the record, the bucket is gone and spend grew by 75 USDG
    const toast = (await screen.findByText('Released 75.00 USDG to spend')).parentElement;
    if (toast === null) throw new Error('no toast');
    expect(within(toast).getByRole('link', { name: 'Open #700' })).toHaveAttribute('href', '/receipts/700');
    await waitFor(() => expect(screen.queryByRole('article', { name: /waiting to buy SPY/ })).toBeNull());
    await waitFor(() => expect(region('Your money')).toHaveTextContent('Spendable3,431.05 USDG'));
  });

  it('keeps the money waiting when the owner backs out of the release', async () => {
    renderHome();
    await loaded();
    fireEvent.click(within(bucketCard()).getByRole('button', { name: 'Release to spend' }));
    fireEvent.click(within(dialogElement()).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(document.querySelector('dialog[open]')).toBeNull());
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
    await approve(dialogElement(), 'Approve and release');
    const alert = await within(dialogElement()).findByRole('alert');
    expect(alert).toHaveTextContent('The release did not go through');
    expect(alert).toHaveTextContent('Sleeve could not reach Robinhood Chain. Try again in a moment.');
    expect(alert).toHaveTextContent(FUNDS_LINE);
    expect(dialogElement().open).toBe(true);
  });

  it('sorts the unsorted USDG now after a preview, and the new split joins the paydays', async () => {
    // #given 165.80 USDG from two payments that the keeper has not sorted
    renderHome();
    await loaded();
    const waiting = region('Waiting');
    const sortCard = within(waiting).getByRole('region', { name: '165.80 USDG not sorted yet' });
    expect(sortCard).toHaveTextContent('Sorting now keeps 149.22 USDG spendable and sets 16.58 USDG aside to buy SPY');
    // #when the owner sorts it now
    fireEvent.click(within(sortCard).getByRole('button', { name: 'Sort now' }));
    await approve(screen.getByRole('dialog', { name: 'Sort by your rule now?' }), 'Approve and sort');
    // #then a toast links the split and the chart has a ninth payday
    const toast = (await screen.findByText('Sorted by your rule')).parentElement;
    if (toast === null) throw new Error('no toast');
    expect(within(toast).getByRole('link', { name: 'Open #700' })).toHaveAttribute('href', '/receipts/700');
    await waitFor(() => expect(region('Paydays')).toHaveTextContent('arrived in 9 paydays'));
  });

  it('offers to buy a waiting share now once the market is open, after a preview of the price against the reference', async () => {
    // #given the market open with the weekend share still waiting
    const layer: MockDataLayer = createMockDataLayer();
    layer.simulate.openMarket();
    renderHome(layer);
    await loaded();
    const buy = await within(bucketCard()).findByRole('button', { name: 'Buy SPY now' });
    fireEvent.click(buy);
    const dialog = screen.getByRole('dialog', { name: 'Buy SPY now?' });
    const preview = await within(dialog).findByRole('region', { name: 'Preview' });
    expect(preview).toHaveTextContent(/75\.00 USDG for about 0\.\d+ SPY/);
    expect(preview).toHaveTextContent('from Waiting to buy SPY to SPY you hold');
    expect(preview).toHaveTextContent(/Within your cap of 1\.00 percent above it\./);
    expect(within(preview).getByText(DEBT_SECURITY_LINE)).toBeInTheDocument();
    await approve(dialog, 'Approve and buy');
    expect(await screen.findByText('Bought SPY')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('article', { name: /waiting to buy SPY/ })).toBeNull());
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

  it('before anything arrives, shows the address, an empty chart and list, and what the next payment will do', async () => {
    const layer = createMockDataLayer();
    const session = await layer.createAccount({ rule: { ...RULE_DEFAULTS }, recoverySigner: null });
    renderHome(layer);
    await screen.findByRole('region', { name: 'Your money' });
    expect(screen.getByRole('group', { name: 'Payment address' })).toHaveTextContent(session.account);
    expect(region('Your money')).toHaveTextContent('Stock TokensNone yet');
    expect(region('Your money')).toHaveTextContent(
      'Nothing is pending. Your next payment splits by your rule: 90% stays spendable and 10% buys SPY.',
    );
    expect(within(region('Paydays')).getByRole('heading', { name: 'No paydays yet' })).toBeInTheDocument();
    expect(within(region('Recent payments')).getByRole('heading', { name: 'No payments yet' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Waiting' })).toBeNull();
  });

  it('shows a payment that arrives as received, then as bought once the keeper splits it with the market open', async () => {
    const layer: MockDataLayer = createMockDataLayer();
    layer.simulate.openMarket();
    layer.simulate.receivePayment(1_000_000_000n);
    layer.simulate.runKeeper();
    renderHome(layer);
    await loaded();
    const recent = region('Recent payments');
    await waitFor(() => expect(within(recent).getAllByRole('listitem')[0]).toHaveTextContent('1,000.00 USDG'));
    expect(within(recent).getAllByRole('listitem')[0]).toHaveTextContent('Bought');
    expect(within(within(recent).getAllByRole('listitem')[0] ?? recent).getByText(DEBT_SECURITY_LINE)).toBeInTheDocument();
  });

  it('holds every card in place while the account loads, without drawing a zero balance', async () => {
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
    await waitFor(() => expect(region('Your money')).toHaveTextContent('Spendable3,356.05 USDG'));
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
});
