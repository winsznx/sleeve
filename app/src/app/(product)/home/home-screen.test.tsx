import { RULE_DEFAULTS } from '@sleeve/core';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { installDialogPolyfill } from '@/components/__tests__/dialog-polyfill';
import styles from '@/components/ui/motion.module.css';
import { ToastProvider } from '@/components/ui/toast';
import { DataLayerError } from '@/data/errors';
import { buildFixtureWorld, createEmptyWorld, createMockDataLayer, SAMPLE_ACCOUNT } from '@/data/mock';
import { DataLayerProvider } from '@/data/provider';
import type { SleeveDataLayer } from '@/data/types';
import { DEBT_SECURITY_LINE } from '@/lib/copy';

import { HomeScreen } from './home-screen';

const SENTENCE = 'When you get paid, 90% stays spendable and 10% buys SPY Stock Tokens into your own account.';
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
  await screen.findByText(SENTENCE);
}

function cardWithHeading(name: string | RegExp): HTMLElement {
  const card = screen.getByRole('heading', { name }).closest('section, article');
  if (!(card instanceof HTMLElement)) throw new Error(`no card headed ${String(name)}`);
  return card;
}

function dialogElement(): HTMLDialogElement {
  const dialog = document.querySelector('dialog');
  if (dialog === null) throw new Error('no dialog rendered');
  return dialog;
}

/** A read or write that fails the way an unreachable chain would, without the provider retrying it. */
function unreachable(): Error {
  return new Error('Robinhood Chain did not answer');
}

/** The element announcing an alert that contains the text. The toast region keeps an empty alert of its own. */
async function alertWith(text: string): Promise<HTMLElement> {
  const alert = (await screen.findByText(text)).closest('[role="alert"]');
  if (!(alert instanceof HTMLElement)) throw new Error(`no alert says ${text}`);
  return alert;
}

describe('HomeScreen', () => {
  it('opens on the sentence: what the rule does with every payment', async () => {
    // #given the sample owner, 10 percent to SPY
    renderHome();
    // #then the page title and the rule in plain words lead
    expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument();
    expect(await screen.findByText(SENTENCE)).toBeInTheDocument();
  });

  it('leads with the latest payment split: what stayed spendable and what waits, with the way to its proof', async () => {
    // #given the weekend payment that queued for the market
    renderHome();
    await loaded();
    // #when the owner looks at the lead card
    const latest = screen.getByRole('region', { name: 'Latest payment' });
    // #then it carries the receipt, its two numbers and the links to the receipt and the verifier
    expect(latest).toHaveTextContent('QUEUED');
    expect(latest).toHaveTextContent('Receipt 642, 26 Sep 2026, 13:30 UTC');
    expect(latest).toHaveTextContent(
      '750.00 USDG arrived. 675.00 USDG stayed spendable and 75.00 USDG stayed as USDG to buy SPY later, because the market was closed.',
    );
    expect(within(latest).getByText('waiting: market closed')).toBeInTheDocument();
    expect(within(latest).getByRole('link', { name: 'Open receipt 642' })).toHaveAttribute('href', '/receipts/642');
    expect(within(latest).getByRole('link', { name: 'Recompute this receipt' })).toHaveAttribute('href', '/verify/642');
  });

  it('shows both sleeves, with the debt security line under every Stock Token holding', async () => {
    // #given the sample owner holds SPY and QQQ
    renderHome();
    await loaded();
    // #when the owner reads the sleeves
    const spend = cardWithHeading('Spend');
    const equity = cardWithHeading('Stock Tokens');
    // #then spend is in USDG, and each holding shows its value at the Chainlink price and the debt security line
    expect(spend).toHaveTextContent('3,356.05 USDG');
    expect(equity).toHaveTextContent('SPY');
    expect(equity).toHaveTextContent('QQQ');
    expect(equity).toHaveTextContent('by the Chainlink price from');
    expect(within(equity).getAllByText(DEBT_SECURITY_LINE)).toHaveLength(2);
  });

  it('shows USDG that has not been split as waiting to be sorted and spendable, with the way to sort it', async () => {
    // #given two payments the keeper has not sorted yet
    renderHome();
    await loaded();
    // #when the owner reads what is waiting
    const unsorted = cardWithHeading('165.80 USDG waiting to be sorted');
    // #then it says the money is spendable now and leads to the inbox
    expect(unsorted).toHaveTextContent('It is spendable now. It arrived in 2 payments and your rule has not split it yet.');
    expect(within(unsorted).getByRole('link', { name: 'Open inbox' })).toHaveAttribute('href', '/inbox');
  });

  it('explains the waiting SPY buy in plain words: how much, why, since when and when it tries again', async () => {
    // #given 75 USDG waiting since Saturday morning because the market is closed
    renderHome();
    await loaded();
    // #when the owner reads the bucket
    const bucket = cardWithHeading('75.00 USDG waiting to buy SPY');
    // #then the reason, the reopen time and how long it waited are spelled out, with a release button
    expect(bucket).toHaveTextContent('Market closed');
    expect(bucket).toHaveTextContent('Sleeve buys SPY after it reopens, Sun 27 Sep, 20:00 New York time.');
    expect(bucket).toHaveTextContent('Waiting for 4 hours, since 26 Sep 2026, 13:30 UTC.');
    expect(within(bucket).getByRole('button', { name: 'Release to spend' })).toBeEnabled();
  });

  it('releases waiting USDG to spend only after the owner confirms, then confirms with its receipt', async () => {
    // #given the waiting SPY bucket
    renderHome();
    await loaded();
    fireEvent.click(within(cardWithHeading('75.00 USDG waiting to buy SPY')).getByRole('button', { name: 'Release to spend' }));
    const dialog = screen.getByRole('dialog', { name: 'Release 75.00 USDG to spend?' });
    expect(dialog).toHaveAccessibleDescription('It stops waiting to buy SPY and moves to spend. It stays in your account as USDG.');

    // #when the owner confirms
    fireEvent.click(within(dialog).getByRole('button', { name: 'Release to spend' }));

    // #then a toast links the RELEASED receipt, the bucket is gone and spend grew by 75 USDG
    const toast = (await screen.findByText('Released 75.00 USDG to spend')).parentElement;
    if (toast === null) throw new Error('no toast');
    expect(within(toast).getByRole('link', { name: 'Open receipt 700' })).toHaveAttribute('href', '/receipts/700');
    expect(dialogElement().open).toBe(false);
    expect(screen.queryByRole('heading', { name: '75.00 USDG waiting to buy SPY' })).toBeNull();
    expect(cardWithHeading('Spend')).toHaveTextContent('3,431.05 USDG');
  });

  it('after five days waiting, asks the owner to raise the cap, switch ticker or release, and links the rule', async () => {
    // #given the same bucket five days on, chain time moved forward
    const world = buildFixtureWorld();
    world.clock = { l2Block: world.clock.l2Block + 3_665_088n, timestamp: world.clock.timestamp + 432_000n };
    renderHome(createMockDataLayer({ world }));
    await loaded();
    // #when the owner reads the bucket
    const bucket = cardWithHeading('75.00 USDG waiting to buy SPY');
    // #then the long wait asks for a decision and leads to the rule
    expect(bucket).toHaveTextContent('Waiting for 5 days');
    expect(bucket).toHaveTextContent('You can raise your cap, switch ticker, or release it to spend.');
    expect(within(bucket).getByRole('link', { name: 'Edit your rule' })).toHaveAttribute('href', '/rule');
  });

  it('with the rule paused, says new USDG stays unsorted and spendable until it resumes', async () => {
    // #given the owner paused the rule
    const layer = createMockDataLayer();
    await layer.pauseRule();
    renderHome(layer);
    // #when home loads
    const sentence = await screen.findByText(
      'Your rule is paused, so new USDG stays unsorted and spendable until you resume it.',
    );
    // #then the unsorted USDG says why it is not sorting, and the rule is one tap away
    expect(sentence).toBeInTheDocument();
    expect(cardWithHeading('165.80 USDG waiting to be sorted')).toHaveTextContent(
      'Your rule is paused, so it stays unsorted until you resume it.',
    );
    expect(screen.getByRole('link', { name: 'Edit rule' })).toHaveAttribute('href', '/rule');
  });

  it('keeps the money waiting when the owner backs out of the release', async () => {
    // #given the release dialog is open
    renderHome();
    await loaded();
    fireEvent.click(within(cardWithHeading('75.00 USDG waiting to buy SPY')).getByRole('button', { name: 'Release to spend' }));
    // #when the owner chooses to keep waiting
    fireEvent.click(within(dialogElement()).getByRole('button', { name: 'Keep waiting' }));
    // #then the dialog closes and the bucket still waits
    expect(dialogElement().open).toBe(false);
    expect(cardWithHeading('75.00 USDG waiting to buy SPY')).toBeInTheDocument();
  });

  it('says what failed and that the USDG is still in the account when a release does not go through', async () => {
    // #given Robinhood Chain does not answer the release
    const layer = createMockDataLayer();
    renderHome({
      ...layer,
      release: () => Promise.reject(new DataLayerError({ code: 'SourceUnavailable' }, 'Robinhood Chain did not answer')),
    });
    await loaded();
    fireEvent.click(within(cardWithHeading('75.00 USDG waiting to buy SPY')).getByRole('button', { name: 'Release to spend' }));
    // #when the owner confirms
    fireEvent.click(within(dialogElement()).getByRole('button', { name: 'Release to spend' }));
    // #then the dialog stays open with what failed, why, and that nothing moved
    const alert = await within(dialogElement()).findByRole('alert');
    expect(alert).toHaveTextContent('The release did not go through');
    expect(alert).toHaveTextContent('Sleeve could not reach Robinhood Chain. Try again in a moment.');
    expect(alert).toHaveTextContent(FUNDS_LINE);
    expect(dialogElement().open).toBe(true);
  });

  it('shows the full payment address with copy and a QR code, and the network payers send on', async () => {
    // #given the sample owner
    renderHome();
    await loaded();
    // #when the owner looks for where to get paid
    const address = screen.getByRole('group', { name: 'Payment address' });
    // #then all 42 characters are on screen beside the QR code, with the network in words
    expect(address).toHaveTextContent(SAMPLE_ACCOUNT);
    expect(within(address).getByRole('button', { name: 'Copy payment address' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'QR code of your payment address' })).toBeInTheDocument();
    expect(screen.getByText('Payers send USDG on Robinhood Chain to this address. Your rule splits what arrives.')).toBeInTheDocument();
  });

  it('lists the receipts before the latest payment, each opening its page', async () => {
    // #given the sample history
    renderHome();
    await loaded();
    // #when the owner reads recent receipts
    const recent = screen.getByRole('region', { name: 'Recent receipts' });
    // #then three receipts after the lead are listed, and the full history is one link away
    expect(within(recent).getAllByRole('listitem')).toHaveLength(3);
    expect(within(recent).getByRole('link', { name: 'Bought SPY' })).toHaveAttribute('href', '/receipts/611');
    expect(within(recent).getByRole('link', { name: 'See all receipts' })).toHaveAttribute('href', '/receipts');
  });

  it('before anything arrives, says nothing splits until USDG comes from outside and puts the address first', async () => {
    // #given a new account with the default rule and nothing received
    const layer = createMockDataLayer();
    const session = await layer.createAccount({ rule: { ...RULE_DEFAULTS }, recoverySigner: null });
    renderHome(layer);
    // #when home loads
    const empty = await screen.findByRole('heading', { name: 'Nothing has arrived yet' });
    // #then the empty state explains, the new address follows, and the sleeves start at nothing
    expect(empty.parentElement).toHaveTextContent(
      'Nothing splits until USDG arrives from outside. Top-ups through the app do not split.',
    );
    expect(screen.getByRole('group', { name: 'Payment address' })).toHaveTextContent(session.account);
    expect(screen.getByText('No Stock Tokens yet. Your equity share buys them as payments arrive.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Latest payment' })).toBeNull();
  });

  it('holds every block in place while the account loads, without drawing a zero balance', async () => {
    // #given a data layer that takes a moment to answer
    renderHome(createMockDataLayer({ latencyMs: 30 }));
    // #then a labeled skeleton stands in and no amount shows yet
    expect(screen.getByText('Loading your account')).toBeInTheDocument();
    expect(screen.queryByText(/USDG/)).toBeNull();
    await loaded();
  });

  it('says what did not load and that the USDG is still there, then loads on a second try', async () => {
    // #given the ledger read fails once
    const layer = createMockDataLayer();
    let answered = false;
    renderHome({
      ...layer,
      getLedger: (account) => {
        if (answered) return layer.getLedger(account);
        answered = true;
        return Promise.reject(unreachable());
      },
    });
    const alert = await alertWith('Your account did not load');
    expect(alert).toHaveTextContent(FUNDS_LINE);
    // #when the owner tries again
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    // #then the account shows
    await waitFor(() => expect(cardWithHeading('Spend')).toHaveTextContent('3,356.05 USDG'));
  });

  it('signs a returning owner in with their passkey and shows the account', async () => {
    // #given no one is signed in on this device
    const layer = createMockDataLayer();
    await layer.signOut();
    renderHome(layer);
    // #when the owner signs in
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in with your passkey' }));
    // #then home fills in
    expect(await screen.findByText(SENTENCE)).toBeInTheDocument();
  });

  it('says plainly when the passkey does not sign anyone in, and offers setup', async () => {
    // #given a device with no Sleeve passkey
    renderHome(createMockDataLayer({ world: createEmptyWorld() }));
    // #when the owner tries to sign in
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in with your passkey' }));
    // #then the failure is announced and the way in for someone new stays on screen
    expect(await alertWith('Your passkey did not sign you in. Try again, or set up Sleeve if you are new here.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New to Sleeve? Set up your account' })).toHaveAttribute('href', '/onboard');
  });

  it('grows the equity segment the first time a split shows, and keeps it still on the next visit', async () => {
    // #given a browser that never showed this account's splits
    const first = renderHome();
    await loaded();
    const firstShowing = screen.getByRole('region', { name: 'Latest payment' }).querySelector('[data-part="waiting"]');
    const grow = styles.grow;
    if (grow === undefined) throw new Error('the grow class is missing from the stylesheet');
    expect(firstShowing).toHaveClass(grow);
    first.unmount();
    // #when the owner comes back to the same split
    renderHome();
    await loaded();
    // #then it stays still
    const nextVisit = screen.getByRole('region', { name: 'Latest payment' }).querySelector('[data-part="waiting"]');
    expect(nextVisit).not.toHaveClass(grow);
  });
});
