import { EXPLORER_URL } from '@sleeve/core';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { getAddress } from 'viem';
import { beforeAll, describe, expect, it } from 'vitest';

import { installDialogPolyfill } from '@/components/__tests__/dialog-polyfill';
import { DataLayerError } from '@/data/errors';
import { createMockDataLayer, SAMPLE_ACCOUNT, type MockDataLayer } from '@/data/mock';
import { DataLayerProvider } from '@/data/provider';
import type { SleeveDataLayer } from '@/data/types';

import { addressGroups, checkAmount, checkDestination } from './_lib/send';
import { SendScreen } from './send-screen';

/** A payee's address as a wallet shows it, with its EIP-55 checksum. */
const PAYEE = getAddress('0x15373ca332fbb73a8559de6e2bb32974dc68d613');

/** The address with the case of its first letter flipped: one wrong capital, which the checksum catches. */
function mistyped(address: string): string {
  const index = address.slice(2).search(/[a-fA-F]/) + 2;
  const letter = address.charAt(index);
  const flipped = letter === letter.toUpperCase() ? letter.toLowerCase() : letter.toUpperCase();
  return `${address.slice(0, index)}${flipped}${address.slice(index + 1)}`;
}

beforeAll(() => {
  installDialogPolyfill();
});

function renderSend(layer: SleeveDataLayer = createMockDataLayer()) {
  render(
    <DataLayerProvider dataLayer={layer}>
      <SendScreen />
    </DataLayerProvider>,
  );
  return layer;
}

async function form(): Promise<HTMLElement> {
  return screen.findByRole('form', { name: 'Send to an outside address' });
}

function fill(amount: string, to: string): void {
  fireEvent.change(screen.getByRole('textbox', { name: 'You send' }), { target: { value: amount } });
  fireEvent.change(screen.getByRole('textbox', { name: 'To' }), { target: { value: to } });
}

describe('checks before a send', () => {
  it('accepts a checksummed address and one with no checksum, and says which it is', () => {
    expect(checkDestination(PAYEE, SAMPLE_ACCOUNT)).toEqual({ kind: 'valid', address: PAYEE, checksummed: true });
    expect(checkDestination(PAYEE.toLowerCase(), SAMPLE_ACCOUNT)).toEqual({ kind: 'valid', address: PAYEE, checksummed: false });
  });

  it('refuses a broken checksum, a short address, the zero address and the account itself', () => {
    expect(checkDestination(mistyped(PAYEE), SAMPLE_ACCOUNT).kind).toBe('invalid');
    expect(checkDestination('0x1234', SAMPLE_ACCOUNT).kind).toBe('invalid');
    expect(checkDestination(`0x${'0'.repeat(40)}`, SAMPLE_ACCOUNT).kind).toBe('invalid');
    expect(checkDestination(SAMPLE_ACCOUNT.toLowerCase(), SAMPLE_ACCOUNT).kind).toBe('invalid');
  });

  it('takes an amount up to the most that can be sent, in USDG places', () => {
    expect(checkAmount('120.5', 200_000_000n)).toEqual({ kind: 'valid', amount: 120_500_000n });
    expect(checkAmount('0', 200_000_000n).kind).toBe('invalid');
    expect(checkAmount('200.000001', 200_000_000n).kind).toBe('invalid');
    expect(checkAmount('', 200_000_000n)).toEqual({ kind: 'empty' });
  });

  it('groups an address by four for reading', () => {
    expect(addressGroups(PAYEE)).toHaveLength(10);
    expect(addressGroups(PAYEE).join('')).toBe(PAYEE.slice(2));
  });
});

describe('SendScreen', () => {
  it('says what can be sent: spendable and not sorted yet, never what waits to buy', async () => {
    renderSend();
    await form();
    const what = screen.getByRole('region', { name: 'What you can send' });
    expect(what).toHaveTextContent('Spendable3,356.055124 USDG');
    expect(what).toHaveTextContent('Not sorted yet, also spendable165.80 USDG');
    expect(what).toHaveTextContent('Waiting to buy, not included75.00 USDG');
    expect(within(what).getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/home#waiting');
    fireEvent.click(screen.getByRole('button', { name: 'Max, send all 3,521.855124 USDG' }));
    expect(screen.getByRole('textbox', { name: 'You send' })).toHaveValue('3521.855124');
  });

  it('refuses an amount over what can be sent and an address with a mistyped capital', async () => {
    renderSend();
    await form();
    fill('5000', mistyped(PAYEE));
    fireEvent.click(screen.getByRole('button', { name: 'Review the send' }));
    expect(screen.getByText('That is more than you can send now, 3,521.855124 USDG.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'To' })).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('heading', { name: 'Check and send' })).toBeNull();
  });

  it('checks, previews and sends, then shows the transaction and the balance read back', async () => {
    const layer = renderSend() as MockDataLayer;
    await form();
    // #given 120 USDG to a checksummed address
    fill('120', PAYEE);
    expect(screen.getByText('The checksum matches, so no letter is mistyped. Still check that it is the address you were given.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review the send' }));
    // #then the confirm step shows the whole address and the preview of what moves
    const confirm = await screen.findByRole('region', { name: 'Check and send' });
    expect(confirm).toHaveTextContent(`0x${addressGroups(PAYEE).join('')}`);
    const preview = await within(confirm).findByRole('region', { name: 'Preview' });
    expect(preview).toHaveTextContent('120.00 USDG');
    expect(preview).toHaveTextContent(`from Spendable to ${PAYEE.slice(0, 6)}`);
    expect(preview).toHaveTextContent("Sleeve's paymaster pays it, so nothing leaves your account for gas.");
    const send = within(confirm).getByRole('button', { name: 'Approve and send' });
    expect(send).toBeDisabled();
    // #when the owner checks the address and approves
    fireEvent.click(within(confirm).getByRole('checkbox', { name: /I checked every character of this address/ }));
    await waitFor(() => expect(send).toBeEnabled());
    fireEvent.click(send);
    // #then the result shows what left, the transaction and the balance after
    const done = await screen.findByRole('heading', { name: 'Sent 120.00 USDG' });
    await waitFor(() => expect(done).toHaveFocus());
    const result = done.closest('section');
    if (result === null) throw new Error('no result card');
    const link = within(result).getByRole('link', { name: /Open it on the Robinhood Chain explorer/ });
    expect(link.getAttribute('href')).toMatch(new RegExp(`^${EXPLORER_URL}/tx/0x[0-9a-f]{64}$`));
    expect(result).toHaveTextContent('Your account now holds 3,476.855124 USDG, read back after the send.');
    expect((await layer.getLedger(SAMPLE_ACCOUNT)).spend).toBe(3_236_055_124n);
  });

  it('goes back to the form with the draft kept, and says what failed when the send does not go through', async () => {
    const layer = createMockDataLayer();
    renderSend({ ...layer, withdraw: () => Promise.reject(new DataLayerError({ code: 'PasskeyCancelled' }, 'closed')) });
    await form();
    fill('10', PAYEE.toLowerCase());
    expect(screen.getByText('This address has no checksum, so a mistyped letter would not show. Check every character.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review the send' }));
    const confirm = await screen.findByRole('region', { name: 'Check and send' });
    fireEvent.click(within(confirm).getByRole('checkbox', { name: /I checked every character/ }));
    const send = within(confirm).getByRole('button', { name: 'Approve and send' });
    await waitFor(() => expect(send).toBeEnabled());
    fireEvent.click(send);
    const alert = (await screen.findByText('The send did not go through')).closest('[role="alert"]');
    expect(alert).toHaveTextContent('The passkey prompt closed before you approved it.');
    expect(alert).toHaveTextContent('Nothing moved. Your USDG is still in your account.');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Edit' }));
    expect(await screen.findByRole('textbox', { name: 'You send' })).toHaveValue('10');
  });

  it('asks a signed-out visitor to sign in', async () => {
    const layer = createMockDataLayer();
    await layer.signOut();
    renderSend(layer);
    expect(await screen.findByRole('heading', { name: 'Sign in to send' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/onboard');
  });
});
