import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';

import { installDialogPolyfill } from '@/components/__tests__/dialog-polyfill';
import { ToastProvider } from '@/components/ui/toast';
import { DataLayerError } from '@/data/errors';
import { createMockDataLayer, SAMPLE_ACCOUNT } from '@/data/mock';
import { DataLayerProvider } from '@/data/provider';
import type { SleeveDataLayer } from '@/data/types';
import { DEBT_SECURITY_LINE } from '@/lib/copy';

import { RuleScreen } from './rule-screen';

beforeAll(() => {
  installDialogPolyfill();
});

function renderRule(layer: SleeveDataLayer = createMockDataLayer()) {
  return render(
    <DataLayerProvider dataLayer={layer}>
      <ToastProvider>
        <RuleScreen />
      </ToastProvider>
    </DataLayerProvider>,
  );
}

async function loaded(): Promise<void> {
  await screen.findByRole('radiogroup', { name: 'Stock Token to buy' });
}

function preview(): HTMLElement {
  const regions = screen.getAllByRole('region', { name: 'On a 500 USDG payday' });
  const shown = regions[0];
  if (shown === undefined) throw new Error('no payday preview');
  return shown;
}

function dialogElement(): HTMLDialogElement {
  const dialog = document.querySelector('dialog');
  if (dialog === null) throw new Error('no dialog rendered');
  return dialog;
}

/** Presses a dialog's confirm once the transaction preview has read and enabled it. */
async function approve(dialog: HTMLElement, name: string): Promise<void> {
  const button = within(dialog).getByRole('button', { name });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
}

/** Turns transaction previews on or off the way Settings does, through the stored settings. */
function setPreviews(enabled: boolean): void {
  window.localStorage.setItem('sleeve:settings', JSON.stringify({ previewsEnabled: enabled }));
  window.dispatchEvent(new StorageEvent('storage', { key: 'sleeve:settings' }));
}

describe('RuleScreen', () => {
  it('shows the rule as it stands: active, its version, and what every payment does', async () => {
    renderRule();
    await loaded();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Version 2')).toBeInTheDocument();
    expect(screen.getByText(/Every payment: 90% stays spendable and 10% buys SPY\./)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^SPY, SPDR S&P 500 ETF Trust, broad ETF, suggested/ })).toBeChecked();
  });

  it('shows each Stock Token with its reference price and time, the pool apart from it, and the market session', async () => {
    renderRule();
    await loaded();
    const card = screen.getByRole('radio', { name: /^NVDA/ }).closest('label');
    if (card === null) throw new Error('no NVDA card');
    await waitFor(() => expect(card).toHaveTextContent('Chainlink reference225.66 USD'));
    expect(card).toHaveTextContent('Published 25 Sep 2026, 19:56 UTC');
    expect(card).toHaveTextContent('Pool price224.99 USDG');
    expect(card).toHaveTextContent('Allowlisted pool 0xd4EB…14a3, 0.05 percent fee');
    expect(card).toHaveTextContent('Single company');
    await waitFor(() => expect(card).toHaveTextContent('Market closed, opens in 1d 6h'));
    expect(screen.getByText(/Sleeve suggests a broad ETF, never a single company/)).toBeInTheDocument();
  });

  it('previews a 500 USDG payday live as the owner changes the token and the part of each payment', async () => {
    renderRule();
    await loaded();
    await waitFor(() => expect(preview()).toHaveTextContent('450.00 USDGstays spendable'));
    expect(preview()).toHaveTextContent('would wait as USDG until Sun 27 Sep, 20:00 New York time');
    // #when the owner picks QQQ and 20 percent
    fireEvent.click(screen.getByRole('radio', { name: /^QQQ/ }));
    fireEvent.click(screen.getByRole('button', { name: '20%' }));
    // #then the preview and the list of changes follow
    expect(preview()).toHaveTextContent('400.00 USDGstays spendable');
    expect(preview()).toHaveTextContent('100.00 USDG');
    expect(preview()).toHaveTextContent('Stock TokenSPY to QQQ');
    expect(preview()).toHaveTextContent('Part of each payment10% to 20%');
  });

  it('carries the debt security line in the preview when a payment arriving now would buy', async () => {
    const layer = createMockDataLayer();
    layer.simulate.openMarket();
    renderRule(layer);
    await loaded();
    await waitFor(() => expect(within(preview()).getByText(DEBT_SECURITY_LINE)).toBeInTheDocument());
    expect(preview()).toHaveTextContent('would buy SPY now');
  });

  it('prices the worst case of the premium cap in USDG on the equity part', async () => {
    renderRule();
    await loaded();
    expect(
      screen.getByText(/with a 1\.00 percent cap a buy can pay up to about 1\.50 percent above the live price: about 0\.75 USDG on a 50\.00 USDG equity share/),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByRole('slider', { name: 'Premium cap' }), { target: { value: '200' } });
    expect(screen.getByText(/with a 2\.00 percent cap a buy can pay up to about 2\.50 percent/)).toBeInTheDocument();
  });

  it('says why saving is off until something changes', async () => {
    renderRule();
    await loaded();
    expect(screen.getByRole('button', { name: 'Save rule' })).toBeDisabled();
    expect(screen.getByText('Change something above to save a new version.')).toBeInTheDocument();
  });

  it('refuses a minimum buy under 1 USDG with what to change', async () => {
    renderRule();
    await loaded();
    const clip = screen.getByRole('textbox', { name: /Minimum buy/ });
    fireEvent.change(clip, { target: { value: '0.5' } });
    fireEvent.blur(clip);
    expect(await screen.findByText('The minimum buy is at least 1 USDG.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save rule' }));
    expect(document.querySelector('dialog[open]')).toBeNull();
  });

  it('saves a change only after the owner approves it, then shows the new version', async () => {
    renderRule();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: '20%' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save rule' }));
    const dialog = screen.getByRole('dialog', { name: 'Save your rule?' });
    // #then the preview shows the rule now and after, and that no money moves
    const card = await within(dialog).findByRole('region', { name: 'Preview' });
    expect(card).toHaveTextContent('Each payment90% spendable, 10% buys SPY changes to 80% spendable, 20% buys SPY');
    expect(card).toHaveTextContent('No money moves. It applies from the next payment.');
    expect(card).toHaveTextContent("Sleeve's paymaster pays it, so nothing leaves your account for gas.");
    expect(dialog).toHaveTextContent("Your passkey will ask you to approve this. It signs only on Sleeve's site.");
    expect(dialog).toHaveTextContent('Sample data: nothing is sent to Robinhood Chain.');
    // #when the owner approves
    await approve(dialog, 'Approve and save');
    // #then the toast confirms and the page shows version 3 at 20 percent
    expect(await screen.findByText('Rule saved. Version 3 is active.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Version 3')).toBeInTheDocument());
    expect(screen.getByText(/Every payment: 80% stays spendable and 20% buys SPY\./)).toBeInTheDocument();
    expect(dialogElement().open).toBe(false);
  });

  it('turns previews off from the preview, keeps this one, then lists the changes alone and confirms at once', async () => {
    renderRule();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: '20%' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save rule' }));
    const dialog = screen.getByRole('dialog', { name: 'Save your rule?' });
    try {
      // #when the owner turns previews off from the preview
      fireEvent.click(await within(dialog).findByRole('button', { name: 'Do not show this again' }));
      // #then this preview stays, and the way back is Settings
      expect(within(dialog).getByRole('region', { name: 'Preview' })).toBeInTheDocument();
      expect(within(dialog).getByRole('link', { name: 'Turn them back on in Settings' })).toHaveAttribute('href', '/settings');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      // #then the next confirmation lists the changes without a preview and can be approved at once
      fireEvent.click(screen.getByRole('button', { name: 'Save rule' }));
      const again = screen.getByRole('dialog', { name: 'Save your rule?' });
      expect(again).toHaveTextContent('Part of each payment10% to 20%');
      expect(within(again).queryByRole('region', { name: 'Preview' })).toBeNull();
      expect(within(again).getByRole('button', { name: 'Approve and save' })).toBeEnabled();
    } finally {
      setPreviews(true);
    }
  });

  it('keeps the dialog open with what failed when the passkey prompt closes', async () => {
    const layer = createMockDataLayer();
    renderRule({ ...layer, setRule: () => Promise.reject(new DataLayerError({ code: 'PasskeyCancelled' }, 'closed')) });
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: '50%' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save rule' }));
    await approve(dialogElement(), 'Approve and save');
    const alert = await within(dialogElement()).findByRole('alert');
    expect(alert).toHaveTextContent('The rule did not save');
    expect(alert).toHaveTextContent('The passkey prompt closed before you approved it. Nothing changed.');
    expect(dialogElement().open).toBe(true);
  });

  it('pauses after approval, says new payments stay unsorted, then resumes', async () => {
    const layer = createMockDataLayer();
    renderRule(layer);
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Pause rule' }));
    const dialog = screen.getByRole('dialog', { name: 'Pause your rule?' });
    expect(await within(dialog).findByText(/While it is paused, new payments stay unsorted and spendable\./)).toBeInTheDocument();
    await approve(dialog, 'Approve and pause');
    expect(await screen.findByText('Rule paused')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Paused')).toBeInTheDocument());
    expect((await layer.getRule(SAMPLE_ACCOUNT)).status).toBe('PAUSED');
    fireEvent.click(screen.getByRole('button', { name: 'Resume rule' }));
    await approve(dialogElement(), 'Approve and resume');
    expect(await screen.findByText('Rule resumed')).toBeInTheDocument();
    expect((await layer.getRule(SAMPLE_ACCOUNT)).status).toBe('ACTIVE');
  });

  it('says what never splits and what does', async () => {
    renderRule();
    await loaded();
    expect(screen.getByText(/A plain transfer from any wallet counts as a payment and splits, even from your own wallet/)).toBeInTheDocument();
  });

  it('asks a signed-out visitor to sign in', async () => {
    const layer = createMockDataLayer();
    await layer.signOut();
    renderRule(layer);
    expect(await screen.findByRole('button', { name: 'Sign in with your passkey' })).toBeInTheDocument();
  });
});
