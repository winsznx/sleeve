import { RULE_DEFAULTS, shortAddress } from '@sleeve/core';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { ReceiveProvider } from '@/components/shell/receive';
import { installDialogPolyfill } from '@/components/__tests__/dialog-polyfill';
import { ToastProvider } from '@/components/ui/toast';
import { DataLayerError } from '@/data/errors';
import { createMockDataLayer, SAMPLE_ACCOUNT } from '@/data/mock';
import { DataLayerProvider } from '@/data/provider';
import type { InboxItem, SleeveDataLayer } from '@/data/types';
import { DEBT_SECURITY_LINE } from '@/lib/copy';

import { PaymentsScreen } from './payments-screen';

const FUNDS_LINE = 'Nothing moved. Your USDG is still in your account.';

/** The sample payments, newest first: 45.80 not sorted, 120 waiting out the grace period, then nine sorted. */
let sample: InboxItem[] = [];

beforeAll(async () => {
  installDialogPolyfill();
  sample = await createMockDataLayer().getInbox(SAMPLE_ACCOUNT);
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
});

function renderPayments(layer: SleeveDataLayer = createMockDataLayer()) {
  return render(
    <DataLayerProvider dataLayer={layer}>
      <ToastProvider>
        <PaymentsScreen />
      </ToastProvider>
    </DataLayerProvider>,
  );
}

/** Every payment row, newest first, across the day groups. */
async function paymentRows(): Promise<HTMLElement[]> {
  const register = await screen.findByRole('region', { name: 'Every payment' });
  await waitFor(() => expect(within(register).queryAllByText('Sat 26 Sep 2026').length).toBeGreaterThan(0));
  return within(register)
    .getAllByRole('listitem')
    .filter((item) => item.parentElement?.parentElement?.tagName === 'SECTION');
}

function rowFor(rows: HTMLElement[], amount: string): HTMLElement {
  const row = rows.find((candidate) => candidate.textContent?.startsWith(amount));
  if (row === undefined) throw new Error(`no payment of ${amount}`);
  return row;
}

describe('PaymentsScreen', () => {
  it('lists every payment newest first by day, and says what comes from transfer logs', async () => {
    renderPayments();
    const rows = await paymentRows();
    expect(rows).toHaveLength(11);
    expect(rows[0]).toHaveTextContent('45.80 USDG');
    const register = screen.getByRole('region', { name: 'Every payment' });
    expect(register).toHaveTextContent(
      'Open a payment to follow its money: who sent it, how your rule split it, what it bought and where it is now. The sender, the transaction hash and the split that sorted each payment are read from Robinhood Chain transfer logs.',
    );
    expect(within(register).getByRole('region', { name: 'Sat 26 Sep 2026' })).toHaveTextContent('3 payments');
  });

  it('shows a payment not sorted yet: sender, amount, time, its state, and its derived transaction hash with copy', async () => {
    renderPayments();
    const [newest] = await paymentRows();
    const item = sample[0];
    if (newest === undefined || item === undefined) throw new Error('no newest payment');
    expect(newest).toHaveTextContent(`From ${shortAddress(item.from)}`);
    expect(newest).toHaveTextContent('Received');
    expect(newest).toHaveTextContent('26 Sep 2026, 17:59 UTC');
    expect(newest).toHaveTextContent('Not sorted yet. It is spendable in your account until your rule splits it.');
    expect(newest).toHaveTextContent(`Transaction ${shortAddress(item.txHash)} (derived)`);
    expect(within(newest).getByRole('button', { name: /Copy the transaction hash of the 45\.80 USDG payment/ })).toBeInTheDocument();
    expect(within(newest).queryByRole('link')).toBeNull();
  });

  it('says when anyone may start the split of a payment waiting out the grace period', async () => {
    renderPayments();
    const rows = await paymentRows();
    const waiting = rowFor(rows, '120.00 USDG');
    expect(waiting).toHaveTextContent('Waiting to sort');
    expect(waiting).toHaveTextContent("If Sleeve's keeper has not sorted it by 26 Sep 2026, 18:22 UTC, anyone can start the split.");
  });

  it('says what each sorted payment became, and links the details of its split', async () => {
    renderPayments();
    const rows = await paymentRows();
    const weekend = rowFor(rows, '750.00 USDG');
    expect(weekend).toHaveTextContent('675.00 USDG stayed spendable');
    expect(weekend).toHaveTextContent('75.00 USDG waits as USDG to buy SPY Market closed');
    expect(weekend).toHaveTextContent('Waiting for the market');

    const bought = rowFor(rows, '1,200.00 USDG');
    expect(bought).toHaveTextContent('Bought');
    expect(bought).toHaveTextContent('1,080.00 USDG stayed spendable');
    expect(bought).toHaveTextContent('120.00 USDG became 0.155872 SPY');
    expect(within(bought).getByText(DEBT_SECURITY_LINE)).toBeInTheDocument();

    const waitedThenBought = rowFor(rows, '650.00 USDG');
    expect(waitedThenBought).toHaveTextContent('65.00 USDG waited, then bought SPY on 21 Sep 2026');
    expect(waitedThenBought).toHaveTextContent('It waited because the market was closed.');
    expect(within(waitedThenBought).getByText(DEBT_SECURITY_LINE)).toBeInTheDocument();

    const released = rowFor(rows, '100.00 USDG');
    expect(released).toHaveTextContent('10.00 USDG waited, then moved to spend on 15 Sep 2026');
    expect(within(released).queryByText(DEBT_SECURITY_LINE)).toBeNull();

    const refused = rowFor(rows, '500.00 USDG');
    expect(refused).toHaveTextContent('All 500.00 USDG stayed spendable');
    expect(refused).toHaveTextContent('The pool this split named is not on the SPY allowlist, so the equity share went to spend.');

    const covered = rowFor(rows, '25.00 USDG');
    expect(covered).toHaveTextContent('USDG had left your account outside Sleeve, so this payment went to match your balance');
  });

  it('opens a payment that waits into its money trail: sender, split, the spendable part, why and until when it waits, and where it is now', async () => {
    renderPayments();
    const weekend = rowFor(await paymentRows(), '750.00 USDG');
    const toggle = within(weekend).getByRole('button', { name: '750.00 USDG, show its money trail' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const trail = within(weekend).getByRole('list', { name: 'Money trail' });
    const item = sample.find((candidate) => candidate.amount === 750_000_000n);
    if (item === undefined) throw new Error('no 750 USDG payment');
    expect(trail).toHaveTextContent(`750.00 USDG arrivedFrom ${shortAddress(item.from)}, 26 Sep 2026, 13:29 UTC.`);
    expect(trail).toHaveTextContent('Your rule split it');
    expect(trail).toHaveTextContent('rule version 2: 90% stays spendable and 10% buys SPY');
    expect(trail).toHaveTextContent('675.00 USDG stayed spendable');
    expect(trail).toHaveTextContent('75.00 USDG waits to buy SPY');
    expect(trail).toHaveTextContent('Why: the market was closed.');
    await waitFor(() => expect(trail).toHaveTextContent('When: after the market reopens, Sun 27 Sep, 20:00 New York time.'));
    expect(trail).toHaveTextContent('Where it is now');
    expect(trail).toHaveTextContent('75.00 USDG as USDG, waiting to buy SPY.');
    expect(within(weekend).getByRole('link', { name: 'Details and proof of #642' })).toHaveAttribute('href', '/receipts/642');
    fireEvent.click(toggle);
    expect(within(weekend).queryByRole('list', { name: 'Money trail' })).toBeNull();
  });

  it('follows a payment that bought to its price against the market reference and the lot that holds it now', async () => {
    renderPayments();
    const bought = rowFor(await paymentRows(), '1,200.00 USDG');
    fireEvent.click(within(bought).getByRole('button', { name: '1,200.00 USDG, show its money trail' }));
    const trail = within(bought).getByRole('list', { name: 'Money trail' });
    expect(trail).toHaveTextContent('120.00 USDG bought 0.155872 SPY');
    expect(trail).toHaveTextContent(/At [\d,.]+ USDG per SPY, against a Chainlink market reference of [\d,.]+ USD, [\d.]+ percent (above|below) it, within your cap of 1\.00 percent\./);
    expect(within(trail).getByText(DEBT_SECURITY_LINE)).toBeInTheDocument();
    await waitFor(() => expect(trail).toHaveTextContent(/0\.155872 SPY held in your own account, lot 455\./));
  });

  it('sums what arrived, how much sorted with no action from the owner, and what is not sorted yet', async () => {
    renderPayments();
    const summary = await screen.findByRole('region', { name: 'Payments so far' });
    expect(summary).toHaveTextContent('5,540.55 USDG');
    expect(summary).toHaveTextContent('In 11 payments.');
    await waitFor(() => expect(summary).toHaveTextContent('9 of 9'));
    expect(summary).toHaveTextContent('165.80 USDG2 payments, spendable now.');
  });

  it('narrows the list to payments not sorted yet, or to sorted ones', async () => {
    renderPayments();
    await paymentRows();
    fireEvent.click(screen.getByRole('button', { name: /^Not sorted/ }));
    expect(await paymentRows()).toHaveLength(2);
    expect(screen.getByRole('button', { name: /^Not sorted/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /^Sorted/ }));
    expect((await paymentRows()).length).toBe(9);
  });

  it('sorts the unsorted USDG now, then lists both payments as sorted', async () => {
    renderPayments();
    await paymentRows();
    const sortCard = screen.getByRole('region', { name: '165.80 USDG not sorted yet' });
    fireEvent.click(within(sortCard).getByRole('button', { name: 'Sort now' }));
    // #then the preview says what moves where before anything is signed
    const dialog = screen.getByRole('dialog', { name: 'Sort by your rule now?' });
    const preview = await within(dialog).findByRole('region', { name: 'Preview' });
    expect(preview).toHaveTextContent('149.22 USDG');
    expect(preview).toHaveTextContent('Not sorted yet');
    expect(preview).toHaveTextContent('Waiting to buy SPY');
    expect(preview).toHaveTextContent(/The market is closed, so the equity share waits as USDG and buys SPY after it reopens/);
    const approve = within(dialog).getByRole('button', { name: 'Approve and sort' });
    await waitFor(() => expect(approve).toBeEnabled());
    fireEvent.click(approve);
    const toast = (await screen.findByText('Sorted by your rule')).parentElement;
    if (toast === null) throw new Error('no toast');
    expect(within(toast).getByRole('link', { name: 'Open #700' })).toHaveAttribute('href', '/receipts/700');
    await waitFor(() => expect(screen.queryByRole('region', { name: '165.80 USDG not sorted yet' })).toBeNull());
    const rows = await paymentRows();
    expect(rowFor(rows, '45.80 USDG')).toHaveTextContent('Waiting for the market');
    expect(rowFor(rows, '45.80 USDG')).toHaveTextContent('Split together with 1 other payment.');
  });

  it('says what failed and that the USDG is still in the account when sorting does not go through', async () => {
    const layer = createMockDataLayer();
    renderPayments({ ...layer, split: () => Promise.reject(new DataLayerError({ code: 'SourceUnavailable' }, 'down')) });
    await paymentRows();
    fireEvent.click(screen.getByRole('button', { name: 'Sort now' }));
    const approve = within(screen.getByRole('dialog', { name: 'Sort by your rule now?' })).getByRole('button', { name: 'Approve and sort' });
    await waitFor(() => expect(approve).toBeEnabled());
    fireEvent.click(approve);
    const alert = (await screen.findByText('The sort did not go through')).closest('[role="alert"]');
    expect(alert).toHaveTextContent(FUNDS_LINE);
  });

  it('opens the Receive dialog from the page action inside the shell, and offers none outside it', async () => {
    const outside = renderPayments();
    await paymentRows();
    expect(screen.queryByRole('button', { name: 'Receive USDG' })).toBeNull();
    outside.unmount();
    render(
      <DataLayerProvider dataLayer={createMockDataLayer()}>
        <ToastProvider>
          <ReceiveProvider account={SAMPLE_ACCOUNT}>
            <PaymentsScreen />
          </ReceiveProvider>
        </ToastProvider>
      </DataLayerProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Receive USDG' }));
    expect(await screen.findByRole('dialog', { name: 'Receive USDG' })).toHaveTextContent(SAMPLE_ACCOUNT);
  });

  it('starts empty for a new account, with the address and what does not split', async () => {
    const layer = createMockDataLayer();
    const session = await layer.createAccount({ rule: { ...RULE_DEFAULTS }, recoverySigner: null });
    renderPayments(layer);
    expect(await screen.findByRole('heading', { name: 'No payments yet' })).toBeInTheDocument();
    expect(screen.getByText(/Nothing splits until USDG arrives from outside/)).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Payment address' })).toHaveTextContent(session.account);
  });

  it('says what did not load, then loads on a second try', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const layer = createMockDataLayer();
    let answered = false;
    renderPayments({
      ...layer,
      getInbox: (account) => {
        if (answered) return layer.getInbox(account);
        answered = true;
        return Promise.reject(new Error('Robinhood Chain did not answer'));
      },
    });
    const alert = (await screen.findByText('Your payments did not load')).closest('[role="alert"]');
    if (!(alert instanceof HTMLElement)) throw new Error('no alert');
    expect(alert).toHaveTextContent(FUNDS_LINE);
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await paymentRows()).toHaveLength(11);
  });

  it('asks a signed-out visitor to sign in with a passkey or a wallet', async () => {
    const layer = createMockDataLayer();
    await layer.signOut();
    renderPayments(layer);
    expect(await screen.findByRole('button', { name: 'Sign in with your passkey' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in with a wallet' })).toBeInTheDocument();
  });

  it('for an account Sleeve is off for, shows a short note and the way Home instead of payments it no longer sorts', async () => {
    const layer = createMockDataLayer();
    await layer.removeSleeve();
    renderPayments(layer);
    expect(await screen.findByText('Sleeve is off for this account')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Home' })).toHaveAttribute('href', '/home');
    expect(screen.queryByRole('region', { name: 'Every payment' })).toBeNull();
  });
});
