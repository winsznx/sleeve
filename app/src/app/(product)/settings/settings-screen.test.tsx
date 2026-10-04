import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';

import { installDialogPolyfill } from '@/components/__tests__/dialog-polyfill';
import { ToastProvider } from '@/components/ui/toast';
import { DataLayerError } from '@/data/errors';
import { createMockDataLayer, SAMPLE_ACCOUNT } from '@/data/mock';
import { DataLayerProvider } from '@/data/provider';
import type { SleeveDataLayer } from '@/data/types';

import { SettingsScreen } from './settings-screen';

beforeAll(() => {
  installDialogPolyfill();
});

function renderSettings(layer: SleeveDataLayer = createMockDataLayer()): void {
  render(
    <DataLayerProvider dataLayer={layer}>
      <ToastProvider>
        <SettingsScreen />
      </ToastProvider>
    </DataLayerProvider>,
  );
}

function removeSection(): HTMLElement {
  return screen.getByRole('region', { name: 'Remove Sleeve' });
}

function openDialog(): HTMLDialogElement {
  const dialog = document.querySelector('dialog[open]');
  if (!(dialog instanceof HTMLDialogElement)) throw new Error('no open dialog');
  return dialog;
}

/** Presses the dialog's confirm once its preview has read and enabled it. */
async function approve(name: string): Promise<void> {
  const button = within(openDialog()).getByRole('button', { name });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
}

describe('Settings signed out', () => {
  it('offers to sign in with a passkey or a wallet, beside the way to set up', async () => {
    const layer = createMockDataLayer();
    await layer.signOut();
    renderSettings(layer);
    await screen.findByRole('button', { name: 'Sign in with your passkey' });
    const account = screen.getByRole('region', { name: 'Account' });
    expect(within(account).getByRole('button', { name: 'Sign in with your passkey' })).toBeInTheDocument();
    expect(within(account).getByRole('button', { name: 'Sign in with a wallet' })).toBeInTheDocument();
    expect(within(account).getByRole('link', { name: 'New to Sleeve? Set up your account' })).toHaveAttribute('href', '/onboard');
  });
});

describe('Remove Sleeve in Settings', () => {
  it('previews what moves, then removes Sleeve and lists what went to spend with its record', async () => {
    // #given the sample owner with 75 USDG waiting to buy SPY
    const layer = createMockDataLayer();
    renderSettings(layer);
    const remove = await within(removeSection()).findByRole('button', { name: 'Remove Sleeve' });
    expect(await within(removeSection()).findByText('75.00 USDG waits to buy SPY now, and would move to spend.')).toBeInTheDocument();
    expect(removeSection()).not.toHaveTextContent('There is no remove button in the app yet.');

    // #when the owner asks to remove it
    fireEvent.click(remove);

    // #then the dialog says what removal does, and the preview shows the bucket moving to spend
    const dialog = screen.getByRole('dialog', { name: 'Remove Sleeve?' });
    expect(dialog).toHaveAccessibleDescription(
      'Its module comes off your account. Each amount waiting to buy moves to spend with its own record, and payments stop splitting. Your USDG and Stock Tokens stay in your account.',
    );
    const preview = await within(dialog).findByRole('region', { name: 'Preview' });
    expect(preview).toHaveTextContent('75.00 USDG');
    expect(preview).toHaveTextContent('from Waiting to buy SPY to Spendable');
    expect(preview).toHaveTextContent('From then on, payments stay as USDG and nothing splits them.');

    // #when the owner approves
    await approve('Approve and remove');

    // #then the section says Sleeve is removed and links the RELEASED record of what moved
    const removed = await within(removeSection()).findByRole('status');
    expect(removed).toHaveTextContent('Sleeve is removed');
    expect(removed).toHaveTextContent('75.00 USDG that waited to buy SPY moved to spend.');
    expect(within(removed).getByRole('link', { name: 'Record #700' })).toHaveAttribute('href', '/receipts/700');
    expect(within(removed).getByRole('link', { name: 'Go to Home' })).toHaveAttribute('href', '/home');
    expect((await layer.getAccount(SAMPLE_ACCOUNT)).moduleInstalled).toBe(false);
  });

  it('says what failed and keeps the dialog open when the removal does not go through', async () => {
    const layer = createMockDataLayer();
    renderSettings({
      ...layer,
      removeSleeve: () => Promise.reject(new DataLayerError({ code: 'UninstallFailed', result: false }, 'released nothing')),
    });
    fireEvent.click(await within(removeSection()).findByRole('button', { name: 'Remove Sleeve' }));
    await approve('Approve and remove');
    const alert = await within(openDialog()).findByRole('alert');
    expect(alert).toHaveTextContent('Sleeve was not removed');
    expect(alert).toHaveTextContent('Turning Sleeve back on releases it to spend first.');
    expect(openDialog().open).toBe(true);
  });

  it('for an account Sleeve is off for, says so and links Home to turn it back on, with no remove button', async () => {
    const layer = createMockDataLayer();
    await layer.removeSleeve();
    renderSettings(layer);
    expect(await within(removeSection()).findByText('Sleeve is off for this account. Payments are not split.')).toBeInTheDocument();
    expect(within(removeSection()).getByRole('link', { name: 'Turn Sleeve back on' })).toHaveAttribute('href', '/home');
    expect(within(removeSection()).queryByRole('button', { name: 'Remove Sleeve' })).toBeNull();
  });
});
