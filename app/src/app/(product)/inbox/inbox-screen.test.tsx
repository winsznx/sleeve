import { EXPLORER_URL, RULE_DEFAULTS, shortAddress } from '@sleeve/core';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@/components/ui/toast';
import { DataLayerError } from '@/data/errors';
import { createMockDataLayer, SAMPLE_ACCOUNT } from '@/data/mock';
import { DataLayerProvider } from '@/data/provider';
import type { InboxItem, SleeveDataLayer } from '@/data/types';

import { InboxScreen } from './inbox-screen';

const FUNDS_LINE = 'Nothing moved. Your USDG is still in your account.';

/** The sample inbox, newest first: 45.80 not sorted, 120 waiting out the grace period, then nine sorted. */
let sample: InboxItem[] = [];

beforeAll(async () => {
  sample = await createMockDataLayer().getInbox(SAMPLE_ACCOUNT);
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
});

function renderInbox(layer: SleeveDataLayer = createMockDataLayer()) {
  return render(
    <DataLayerProvider dataLayer={layer}>
      <ToastProvider>
        <InboxScreen />
      </ToastProvider>
    </DataLayerProvider>,
  );
}

function sampleItem(index: number): InboxItem {
  const item = sample[index];
  if (item === undefined) throw new Error(`no sample transfer at ${index}`);
  return item;
}

async function transferRows(): Promise<HTMLElement[]> {
  const list = await screen.findByRole('region', { name: 'Transfers' });
  return within(list).getAllByRole('listitem');
}

async function alertWith(text: string): Promise<HTMLElement> {
  const alert = (await screen.findByText(text)).closest('[role="alert"]');
  if (!(alert instanceof HTMLElement)) throw new Error(`no alert says ${text}`);
  return alert;
}

describe('InboxScreen', () => {
  it('lists every inbound transfer newest first, and labels what comes from chain logs as derived', async () => {
    // #given the sample owner's eleven payments
    renderInbox();
    // #when the inbox loads
    const rows = await transferRows();
    // #then every transfer is a row, under a line that says the list is derived from logs
    expect(rows).toHaveLength(11);
    expect(screen.getByRole('region', { name: 'Transfers' })).toHaveTextContent(
      'Read from Robinhood Chain transfer logs. The sender, the transaction hash and the receipt that sorted each transfer are derived from those logs.',
    );
  });

  it('shows the sender, amount, time, state and derived transaction hash of a transfer not sorted yet', async () => {
    // #given the 45.80 USDG that arrived last
    renderInbox();
    const [newest] = await transferRows();
    const item = sampleItem(0);
    // #then the row carries each fact, and says it stays spendable
    expect(newest).toHaveTextContent(`From ${shortAddress(item.from)}`);
    expect(newest).toHaveTextContent('45.80 USDG');
    expect(newest).toHaveTextContent('Not sorted yet');
    expect(newest).toHaveTextContent('26 Sep 2026, 17:59 UTC');
    expect(newest).toHaveTextContent('It stays spendable in your account until it is.');
    expect(newest).toHaveTextContent(`Transaction hash (derived)${shortAddress(item.txHash)}`);
  });

  it('says when anyone may start the split for a transfer waiting out the grace period', async () => {
    // #given the 120 USDG the keeper has held for a while
    renderInbox();
    const rows = await transferRows();
    // #then its row names the grace deadline in UTC
    expect(rows[1]).toHaveTextContent('Waiting to sort');
    expect(rows[1]).toHaveTextContent(
      "If Sleeve's keeper has not sorted it by 26 Sep 2026, 18:22 UTC, anyone can start the split.",
    );
  });

  it('links a sorted transfer to the receipt that sorted it', async () => {
    // #given the weekend payment of 750 USDG
    renderInbox();
    const rows = await transferRows();
    // #then its row says sorted and opens receipt 642
    expect(rows[2]).toHaveTextContent('Sorted by your rule.');
    expect(within(rows[2] ?? document.body).getByRole('link', { name: 'Open receipt 642' })).toHaveAttribute(
      'href',
      '/receipts/642',
    );
  });

  it('copies the full transaction hash from the short one on screen', async () => {
    // #given a clipboard
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true, writable: true });
    renderInbox();
    const [newest] = await transferRows();
    // #when the owner copies the newest transfer's hash
    await act(async () => {
      fireEvent.click(
        within(newest ?? document.body).getByRole('button', {
          name: 'Copy transaction hash of the 45.80 USDG transfer, 26 Sep 2026, 17:59 UTC',
        }),
      );
    });
    // #then all 66 characters go to the clipboard
    expect(writeText).toHaveBeenCalledWith(sampleItem(0).txHash);
  });

  it('opens a transaction in the explorer when the transfers come from Robinhood Chain', async () => {
    // #given the same transfers read from Robinhood Chain
    renderInbox({ ...createMockDataLayer(), source: 'chain' });
    const [newest] = await transferRows();
    // #then each row links its transaction on the explorer, in a new tab
    const link = within(newest ?? document.body).getByRole('link', { name: 'View on explorer (opens in a new tab)' });
    expect(link).toHaveAttribute('href', `${EXPLORER_URL}/tx/${sampleItem(0).txHash}`);
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('leaves the explorer out for sample data', async () => {
    // #given the mock data layer
    renderInbox();
    await transferRows();
    // #then no row points at an explorer that never saw these transactions
    expect(screen.queryByRole('link', { name: /View on explorer/ })).toBeNull();
  });

  it('shows what sorting now would do with the unsorted USDG, in numbers and in words', async () => {
    // #given 165.80 USDG unsorted on Saturday, with the market closed
    renderInbox();
    // #when the owner reads the card above the list
    const card = await screen.findByRole('region', { name: '165.80 USDG waiting to be sorted' });
    // #then it says it is spendable, and how the rule would split it now
    expect(card).toHaveTextContent('From 2 payments. It is spendable in your account now.');
    expect(within(card).getByText('stays spendable')).toBeInTheDocument();
    expect(within(card).getByText('waits: market closed')).toBeInTheDocument();
    expect(card).toHaveTextContent(
      'Sorting now keeps 149.22 USDG spendable and sets 16.58 USDG aside to buy SPY, held as USDG in your account. The market is closed. Sleeve buys SPY after it reopens, Sun 27 Sep, 20:00 New York time.',
    );
  });

  it('sorts the unsorted USDG on request and links the receipt that records it', async () => {
    // #given the unsorted card
    renderInbox();
    const card = await screen.findByRole('region', { name: '165.80 USDG waiting to be sorted' });
    // #when the owner sorts now
    fireEvent.click(within(card).getByRole('button', { name: 'Sort now' }));
    // #then a toast links receipt 700, the card goes, and both transfers now point at that receipt
    const toast = (await screen.findByText('Sorted by your rule')).parentElement;
    expect(within(toast ?? document.body).getByRole('link', { name: 'Open receipt 700' })).toHaveAttribute(
      'href',
      '/receipts/700',
    );
    expect(screen.queryByRole('region', { name: /waiting to be sorted/ })).toBeNull();
    for (const row of (await transferRows()).slice(0, 2)) {
      expect(within(row).getByRole('link', { name: 'Open receipt 700' })).toHaveAttribute('href', '/receipts/700');
    }
  });

  it('says what failed and that the USDG is still in the account when a sort does not go through', async () => {
    // #given Robinhood Chain does not answer the split
    const layer = createMockDataLayer();
    renderInbox({
      ...layer,
      split: () => Promise.reject(new DataLayerError({ code: 'SourceUnavailable' }, 'Robinhood Chain did not answer')),
    });
    const card = await screen.findByRole('region', { name: '165.80 USDG waiting to be sorted' });
    // #when the owner sorts now
    fireEvent.click(within(card).getByRole('button', { name: 'Sort now' }));
    // #then the card says what failed, why, and that nothing moved
    const alert = await alertWith('The sort did not go through');
    expect(alert).toHaveTextContent('Sleeve could not reach Robinhood Chain. Try again in a moment.');
    expect(alert).toHaveTextContent(FUNDS_LINE);
  });

  it('explains why nothing sorts while the rule is paused, and leads to the rule', async () => {
    // #given the owner paused the rule
    const layer = createMockDataLayer();
    await layer.pauseRule();
    renderInbox(layer);
    // #when the owner reads the unsorted card
    const card = await screen.findByRole('region', { name: '165.80 USDG waiting to be sorted' });
    // #then there is no sort button, only the reason and the way to the rule
    expect(within(card).queryByRole('button', { name: 'Sort now' })).toBeNull();
    expect(card).toHaveTextContent('Your rule is paused, so this stays unsorted and spendable until you resume it.');
    expect(within(card).getByRole('link', { name: 'Go to your rule' })).toHaveAttribute('href', '/rule');
  });

  it('before anything arrives, says what will show here and gives the payment address', async () => {
    // #given a new account with nothing received
    const layer = createMockDataLayer();
    const session = await layer.createAccount({ rule: { ...RULE_DEFAULTS }, recoverySigner: null });
    renderInbox(layer);
    // #when the inbox loads
    const empty = await screen.findByRole('heading', { name: 'No USDG has arrived yet' });
    // #then it explains what lands here and shows the address to share
    expect(empty.parentElement).toHaveTextContent('Top-ups through the app go to spend and do not split.');
    expect(screen.getByRole('group', { name: 'Payment address' })).toHaveTextContent(session.account);
  });

  it('holds the list in place while transfers load', async () => {
    // #given a data layer that takes a moment to answer
    renderInbox(createMockDataLayer({ latencyMs: 30 }));
    // #then a labeled skeleton stands in until the rows arrive
    expect(screen.getByText('Loading your inbox')).toBeInTheDocument();
    expect(await transferRows()).toHaveLength(11);
  });

  it('says what did not load and that the USDG is still there, then loads on a second try', async () => {
    // #given the inbox read fails once
    const layer = createMockDataLayer();
    let answered = false;
    renderInbox({
      ...layer,
      getInbox: (account) => {
        if (answered) return layer.getInbox(account);
        answered = true;
        return Promise.reject(new Error('Robinhood Chain did not answer'));
      },
    });
    const alert = await alertWith('Your inbox did not load');
    expect(alert).toHaveTextContent(FUNDS_LINE);
    // #when the owner tries again
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    // #then the transfers show
    await waitFor(async () => expect(await transferRows()).toHaveLength(11));
  });

  it('asks a signed out visitor to sign in before showing any transfer', async () => {
    // #given no one is signed in
    const layer = createMockDataLayer();
    await layer.signOut();
    renderInbox(layer);
    // #then the inbox offers the passkey sign in and lists nothing
    expect(await screen.findByRole('button', { name: 'Sign in with your passkey' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Transfers' })).toBeNull();
  });
});
