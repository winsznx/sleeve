import type { Address } from '@sleeve/core';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { JSX } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { installDialogPolyfill } from '@/components/__tests__/dialog-polyfill';
import { fakeWalletLayer, sampleOwnedByWallet } from '@/components/__tests__/fake-wallet-layer';
import { WalletLayerProvider, type WalletLayer } from '@/components/wallet/wallet-layer';
import { useSession } from '@/data/hooks';
import { createMockDataLayer } from '@/data/mock';
import { DataLayerProvider } from '@/data/provider';
import type { SleeveDataLayer } from '@/data/types';

import { ActionDialog, useActionGate } from './action-dialog';

const OWNER: Address = '0x05a1C0FfEE00000000000000000000000000b92D';
const OTHER: Address = '0x3333333333333333333333333333333333333333';

beforeAll(() => {
  installDialogPolyfill();
});

afterEach(() => {
  window.localStorage.clear();
});

function dialogElement(): HTMLDialogElement {
  const dialog = document.querySelector('dialog');
  if (!(dialog instanceof HTMLDialogElement)) throw new Error('no dialog rendered');
  return dialog;
}

/** Pausing the rule, as the Rule screen asks for it. */
function PauseDialog({ onConfirm }: { onConfirm: () => void }): JSX.Element {
  return (
    <ActionDialog
      open
      onClose={() => undefined}
      action={{ kind: 'pauseRule' }}
      title="Pause your rule?"
      description="New payments stay unsorted and spendable."
      confirmLabel="Pause rule"
      busyLabel="Pausing"
      busy={false}
      onConfirm={onConfirm}
    />
  );
}

function renderWith(layer: SleeveDataLayer, walletLayer: WalletLayer, ui: JSX.Element) {
  return render(
    <DataLayerProvider dataLayer={layer}>
      <WalletLayerProvider layer={walletLayer}>{ui}</WalletLayerProvider>
    </DataLayerProvider>,
  );
}

describe('ActionDialog for a passkey session', () => {
  it('says the passkey asks to approve, and asks to connect nothing', async () => {
    const wallet = fakeWalletLayer({ address: OWNER });
    renderWith(createMockDataLayer(), wallet.layer, <PauseDialog onConfirm={vi.fn()} />);
    expect(await screen.findByText("Your passkey will ask you to approve this. It signs only on Sleeve's site.", { exact: false })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Connect your wallet to sign' })).toBeNull();
    expect(wallet.events).toEqual([]);
  });
});

describe('ActionDialog for a wallet session with no wallet in this tab', () => {
  it('connects the owner’s wallet first, stepping out of the top layer while the wallet modal is open, then signs', async () => {
    // #given a wallet session read back after a reload, and a wallet that connects through its modal
    const openWhileModal: boolean[] = [];
    const wallet = fakeWalletLayer({ address: OWNER, whileModalOpen: () => openWhileModal.push(dialogElement().open) });
    const onConfirm = vi.fn();
    renderWith(sampleOwnedByWallet(OWNER), wallet.layer, <PauseDialog onConfirm={onConfirm} />);
    const step = await screen.findByRole('region', { name: 'Connect your wallet to sign' });
    expect(step).toHaveTextContent('This account belongs to the wallet 0x05a1…b92D. Connect that wallet here, then approve.');
    expect(screen.getByRole('button', { name: 'Pause rule' })).toBeDisabled();
    expect(wallet.events).toEqual([]);

    // #when the owner connects the wallet
    fireEvent.click(within(step).getByRole('button', { name: 'Connect your wallet' }));

    // #then the dialog left the top layer while the modal was open, and came back without the step
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Connect your wallet to sign' })).toBeNull());
    expect(openWhileModal).toEqual([false]);
    await waitFor(() => expect(dialogElement().open).toBe(true));
    expect(wallet.events).toEqual(['load', 'connect', 'modal']);
    expect(screen.getByText('Your wallet will ask you to sign a long code.', { exact: false })).toBeInTheDocument();
    // #then Confirm goes on to the signature
    const confirm = screen.getByRole('button', { name: 'Pause rule' });
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('names the owner it needs when another wallet connects, and keeps Confirm off', async () => {
    const wallet = fakeWalletLayer({ address: OTHER, connect: 'connected' });
    renderWith(sampleOwnedByWallet(OWNER), wallet.layer, <PauseDialog onConfirm={vi.fn()} />);
    const step = await screen.findByRole('region', { name: 'Connect your wallet to sign' });
    fireEvent.click(within(step).getByRole('button', { name: 'Connect your wallet' }));
    expect(await within(step).findByRole('alert')).toHaveTextContent(
      'Your wallet has 0x3333…3333 selected. Switch to 0x05a1…b92D in your wallet to continue.',
    );
    expect(within(step).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pause rule' })).toBeDisabled();
    expect(dialogElement().open).toBe(true);
  });

  it('opens the dialog for its connect step even with previews off, instead of running the action at once', async () => {
    // #given previews turned off in Settings, and a wallet session with no wallet in this tab
    window.localStorage.setItem('sleeve:settings', JSON.stringify({ previewsEnabled: false }));
    const run = vi.fn();
    function Gate(): JSX.Element {
      const session = useSession();
      const gate = useActionGate();
      if (session.data === undefined) return <p>Reading the session</p>;
      return (
        <>
          <button type="button" onClick={() => gate.start({ kind: 'pauseRule' }, run)}>
            Pause
          </button>
          {gate.open ? <p>Dialog asked for</p> : null}
        </>
      );
    }
    renderWith(sampleOwnedByWallet(OWNER), fakeWalletLayer({ address: OWNER }).layer, <Gate />);
    // #when the action is pressed
    fireEvent.click(await screen.findByRole('button', { name: 'Pause' }));
    // #then the dialog is asked for, and nothing ran at once
    expect(screen.getByText('Dialog asked for')).toBeInTheDocument();
    expect(run).not.toHaveBeenCalled();
  });
});
