import { RULE_DEFAULTS } from '@sleeve/core';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { installDialogPolyfill } from '@/components/__tests__/dialog-polyfill';
import { ToastProvider } from '@/components/ui/toast';
import { WalletProviders } from '@/components/wallet/wallet-providers';
import { DataLayerError } from '@/data/errors';
import { createMockDataLayer, type MockDataLayer } from '@/data/mock';
import { DataLayerProvider } from '@/data/provider';
import type { SleeveDataLayer } from '@/data/types';
import { NO_RECOVERY_LINE } from '@/lib/signer';

import { OnboardScreen } from './onboard-screen';

beforeAll(() => {
  installDialogPolyfill();
});

function renderOnboard(layer: SleeveDataLayer = createMockDataLayer()) {
  return render(
    <DataLayerProvider dataLayer={layer}>
      <ToastProvider>
        <WalletProviders>
          <OnboardScreen />
        </WalletProviders>
      </ToastProvider>
    </DataLayerProvider>,
  );
}

async function answerEligibility(residence = 'NG'): Promise<void> {
  fireEvent.change(await screen.findByRole('combobox', { name: 'Where do you live?' }), { target: { value: residence } });
  fireEvent.click(within(screen.getByRole('group', { name: 'Are you a US person?' })).getByLabelText('No'));
  fireEvent.click(within(screen.getByRole('group', { name: 'Are you subject to sanctions?' })).getByLabelText('No'));
  fireEvent.click(screen.getByRole('button', { name: 'Check and continue' }));
}

async function stepHeading(name: string): Promise<HTMLElement> {
  return screen.findByRole('heading', { level: 2, name });
}

describe('OnboardScreen', () => {
  it('starts with where the person lives and needs every answer before it checks', async () => {
    renderOnboard();
    await stepHeading('Where you live');
    fireEvent.click(screen.getByRole('button', { name: 'Check and continue' }));
    expect(await screen.findByText('Choose the country you live in.')).toBeInTheDocument();
    expect(screen.getAllByText('Answer this question to go on.')).toHaveLength(2);
    expect(screen.getByText(/Stock Tokens are not offered to residents of the United States, Canada, the United Kingdom/)).toBeInTheDocument();
  });

  it('moves an eligible person in Nigeria on to how they sign, and focuses the new step', async () => {
    renderOnboard();
    await answerEligibility('NG');
    const heading = await stepHeading('How you sign');
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getAllByText('Nigeria, eligible').length).toBeGreaterThan(0);
  });

  it('stops a resident of a restricted country with a clear page, and keeps checking a split open', async () => {
    renderOnboard();
    await answerEligibility('GB');
    expect(await screen.findByRole('heading', { name: 'Sleeve is not available to you' })).toBeInTheDocument();
    expect(screen.getByText('You live in the United Kingdom, where the issuer restricts offers of Stock Tokens.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Check a split' })).toHaveAttribute('href', '/verify');
    expect(screen.getByRole('link', { name: 'Back to the Sleeve site' })).toHaveAttribute('href', '/');
    // #when the person says they chose a wrong answer
    fireEvent.click(screen.getByRole('button', { name: 'I chose a wrong answer by mistake' }));
    // #then the form comes back with what they chose
    expect(await stepHeading('Where you live')).toBeInTheDocument();
  });

  it('stops a request from a restricted country by its connection, with no way around it', async () => {
    const eligibility = vi.fn(async () => ({ eligible: false, ipCountry: 'CH', blocks: [{ kind: 'IP_RESTRICTED' as const, country: 'CH' }] }));
    renderOnboard(createMockDataLayer({ eligibility }));
    await answerEligibility('NG');
    expect(await screen.findByText('Your connection comes from Switzerland, where the issuer restricts offers of Stock Tokens.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'I chose a wrong answer by mistake' })).toBeNull();
  });

  it('says the check did not finish when the server cannot answer, and sets nothing up', async () => {
    const eligibility = vi.fn(() => Promise.reject(new DataLayerError({ code: 'SourceUnavailable' }, 'offline')));
    renderOnboard(createMockDataLayer({ eligibility }));
    await answerEligibility('NG');
    const alert = (await screen.findByText('The check did not finish')).closest('[role="alert"]');
    expect(alert).toHaveTextContent('Sleeve could not check where your connection comes from. Nothing was set up.');
  });

  it('offers a passkey first and a wallet beside it, and says what a wallet owner can do outside Sleeve', async () => {
    renderOnboard();
    await answerEligibility('NG');
    await stepHeading('How you sign');
    const passkey = screen.getByRole('region', { name: 'Use a passkey' });
    expect(passkey).toHaveTextContent("A passkey works only on Sleeve's site, so no other page can sign with it.");
    expect(within(passkey).getByText('Suggested')).toBeInTheDocument();
    const wallet = screen.getByRole('region', { name: 'Use a wallet you already have' });
    expect(wallet).toHaveTextContent('Phone wallets by QR code are off until Sleeve has a WalletConnect project id.');
    expect(await within(wallet).findByRole('button', { name: 'Connect a wallet' })).toBeInTheDocument();
  });

  it('says plainly when the passkey prompt closes, and makes no passkey', async () => {
    const layer = createMockDataLayer();
    renderOnboard({ ...layer, createPasskey: () => Promise.reject(new DataLayerError({ code: 'PasskeyCancelled' }, 'closed')) });
    await answerEligibility('NG');
    fireEvent.click(await screen.findByRole('button', { name: 'Create a passkey' }));
    expect(await screen.findByText('The passkey prompt closed before it finished. Nothing was made. Try again when you are ready.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'How you sign' })).toBeInTheDocument();
  });

  it('sets up a passkey account end to end: recovery skipped with its warning, the rule, then the address', async () => {
    // #given a sample data layer that watches the setup
    const layer: MockDataLayer = createMockDataLayer();
    const createAccount = vi.spyOn(layer, 'createAccount');
    renderOnboard(layer);
    await answerEligibility('NG');
    // #when the owner makes a passkey and skips the recovery wallet
    fireEvent.click(await screen.findByRole('button', { name: 'Create a passkey' }));
    await stepHeading('Recovery wallet');
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(screen.getByText(NO_RECOVERY_LINE)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue without one' }));
    // #and chooses 20 percent to SPY
    await stepHeading('Your rule');
    fireEvent.click(screen.getByRole('button', { name: '20%' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await stepHeading('Your account');
    const summary = screen.getAllByText('20% of each payment buys SPY, cap 1.00 percent, minimum 25 USDG');
    expect(summary.length).toBeGreaterThan(0);
    expect(screen.getByText(/Your passkey will ask you to approve this\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create my Sleeve account' }));
    // #then the address shows only once the account reads back, with the way home
    expect(await screen.findByRole('heading', { name: 'Your Sleeve account is ready' })).toBeInTheDocument();
    const call = createAccount.mock.calls[0]?.[0];
    expect(call?.rule).toEqual({ ...RULE_DEFAULTS, spendBps: 8_000, equityBps: 2_000 });
    expect(call?.recoverySigner).toBeNull();
    expect(call?.signer?.kind).toBe('passkey');
    const session = await layer.getSession();
    expect(await screen.findByRole('group', { name: 'Payment address' })).toHaveTextContent(session?.account ?? 'missing');
    expect(screen.getByRole('link', { name: 'Go to Home' })).toHaveAttribute('href', '/home');
  });

  it('goes back a step without losing what was chosen', async () => {
    renderOnboard();
    await answerEligibility('NG');
    fireEvent.click(await screen.findByRole('button', { name: 'Create a passkey' }));
    await stepHeading('Recovery wallet');
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue without one' }));
    await stepHeading('Your rule');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await stepHeading('Recovery wallet')).toBeInTheDocument();
    expect(screen.getByText(NO_RECOVERY_LINE)).toBeInTheDocument();
  });

  it('says what failed when the account is not created, and offers to try again', async () => {
    const layer = createMockDataLayer();
    renderOnboard({
      ...layer,
      createAccount: () => Promise.reject(new DataLayerError({ code: 'SponsorshipUnavailable' }, 'no sponsor')),
    });
    await answerEligibility('NG');
    fireEvent.click(await screen.findByRole('button', { name: 'Create a passkey' }));
    await stepHeading('Recovery wallet');
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue without one' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Create my Sleeve account' }));
    const alert = (await screen.findByText('The account was not created')).closest('[role="alert"]');
    expect(alert).toHaveTextContent('Sleeve could not cover the network fee for this step right now. Nothing moved.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  });
});
