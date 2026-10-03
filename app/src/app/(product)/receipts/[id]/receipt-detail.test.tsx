import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { receiptSentence } from '@/components/sleeve/text';
import { installDialogPolyfill } from '@/components/__tests__/dialog-polyfill';
import { FUNDS_STILL_HERE } from '@/components/ui/card';
import { createMockDataLayer, SAMPLE_RECEIPT_IDS } from '@/data/mock';
import { DataLayerProvider } from '@/data/provider';
import type { ReceiptRecord, SleeveDataLayer } from '@/data/types';
import { DEBT_SECURITY_LINE } from '@/lib/copy';

import { ReceiptDetail } from './receipt-detail';
import { WRAPPED_LINE } from './receipt-sections';

const navigation = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navigation.push }),
}));

beforeAll(() => {
  installDialogPolyfill();
});

beforeEach(() => {
  navigation.push.mockReset();
});

function renderReceipt(id: bigint, layer: SleeveDataLayer = createMockDataLayer()) {
  render(
    <DataLayerProvider dataLayer={layer}>
      <ReceiptDetail id={id.toString()} disclosure={<section aria-label="Issuer disclosure">Issuer text</section>} />
    </DataLayerProvider>,
  );
  return layer;
}

async function sampleRecord(id: bigint): Promise<ReceiptRecord> {
  const record = await createMockDataLayer().getReceipt(id);
  if (record === null) throw new Error(`no sample receipt ${id}`);
  return record;
}

function section(name: string): HTMLElement {
  return screen.getByRole('region', { name });
}

describe('receipt detail', () => {
  it('shows a fill: the sentence, the split, the token amount with the debt security line, and every field', async () => {
    const record = await sampleRecord(SAMPLE_RECEIPT_IDS.filledSpy);
    renderReceipt(SAMPLE_RECEIPT_IDS.filledSpy);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Receipt 455');

    expect(await screen.findByText(receiptSentence(record))).toBeInTheDocument();
    expect(screen.getByText('FILLED')).toBeInTheDocument();
    expect(screen.getAllByText(DEBT_SECURITY_LINE).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('link', { name: 'Recompute this receipt' })).toHaveAttribute('href', '/verify/455');

    const reference = section('Market reference');
    expect(within(reference).getByText('Chainlink round')).toBeInTheDocument();
    expect(within(reference).getByText(record.receipt.roundId.toString())).toBeInTheDocument();
    expect(within(section('How it ran')).getByText(WRAPPED_LINE)).toBeInTheDocument();
    expect(within(section('Onchain record')).getByText(record.receiptHash)).toBeInTheDocument();
    expect(within(section('From chain logs')).getAllByText('(derived)')).toHaveLength(2);
    expect(screen.getByRole('region', { name: 'Issuer disclosure' })).toBeInTheDocument();
  });

  it('keeps the fields as stored behind one disclosure, in SPEC order', async () => {
    renderReceipt(SAMPLE_RECEIPT_IDS.filledSpy);
    const summary = await screen.findByRole('heading', { name: 'All 39 fields as stored' });
    const details = summary.closest('details');
    expect(details).not.toBeNull();
    expect(within(details ?? document.body).getByText('FILLED (0)')).toBeInTheDocument();
    expect(within(details ?? document.body).getByText('1200000000')).toBeInTheDocument();
  });

  it('explains a queued receipt that never read the price', async () => {
    renderReceipt(SAMPLE_RECEIPT_IDS.queuedSession);
    const summary = await screen.findByRole('region', { name: 'Summary' });
    expect(within(summary).getByText('QUEUED')).toBeInTheDocument();
    expect(within(summary).getByText('Market closed')).toBeInTheDocument();
    expect(within(section('How it ran')).getByText('Not read')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Market reference' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Make a card' })).toBeNull();
  });

  it('notes a receipt that belongs to another account and offers no card for it', async () => {
    renderReceipt(SAMPLE_RECEIPT_IDS.refusedAccount);
    expect(await screen.findByText("Another account's receipt")).toBeInTheDocument();
    expect(screen.getByText('REFUSED ACCOUNT')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Make a card' })).toBeNull();
  });

  it('says plainly when the receipt has not been written yet', async () => {
    renderReceipt(9_999n);
    expect(await screen.findByRole('heading', { name: 'No receipt 9999 yet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See your receipts' })).toHaveAttribute('href', '/receipts');
  });

  it('says what failed and that the USDG is still in the account, then loads on retry', async () => {
    const layer = createMockDataLayer();
    let failing = true;
    renderReceipt(SAMPLE_RECEIPT_IDS.filledSpy, {
      ...layer,
      getReceipt: (id: bigint) => (failing ? Promise.reject(new Error('offline')) : layer.getReceipt(id)),
    });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Receipt 455 did not load');
    expect(alert).toHaveTextContent(FUNDS_STILL_HERE);
    failing = false;
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('FILLED')).toBeInTheDocument();
  });
});

describe('making a card from a receipt', () => {
  async function openComposer(layer: SleeveDataLayer): Promise<HTMLElement> {
    renderReceipt(SAMPLE_RECEIPT_IDS.filledSpy, layer);
    fireEvent.click(await screen.findByRole('button', { name: 'Make a card' }));
    return screen.findByRole('dialog', { name: 'Make a card' });
  }

  it('makes a card with amounts and proof off unless the owner adds them', async () => {
    const layer = createMockDataLayer();
    const dialog = await openComposer(layer);
    expect(within(dialog).getByRole('checkbox', { name: 'Show amounts' })).not.toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: 'Show proof' })).not.toBeChecked();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Make card' }));
    });
    await waitFor(() => expect(navigation.push).toHaveBeenCalledTimes(1));
    const cardId = String(navigation.push.mock.calls[0]?.[0]).replace('/card/', '');
    const card = await layer.getCard(cardId);
    expect(card).toMatchObject({ kind: 'receipt', tickerId: 0, amounts: null, proof: null });
  });

  it('adds the receipt number only after the warning that it reveals the account', async () => {
    const layer = createMockDataLayer();
    const dialog = await openComposer(layer);
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Show amounts' }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Show proof' }));

    const confirm = within(dialog).getByRole('button', { name: 'Add the receipt number' });
    expect(within(dialog).getByText('The receipt number reveals your account')).toBeInTheDocument();
    expect(confirm).toHaveAccessibleDescription(expect.stringContaining('Anyone can look up receipt 455'));
    expect(within(dialog).getByRole('checkbox', { name: 'Show proof' })).not.toBeChecked();
    fireEvent.click(confirm);
    expect(within(dialog).getByRole('checkbox', { name: 'Show proof' })).toBeChecked();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Make card' }));
    });
    await waitFor(() => expect(navigation.push).toHaveBeenCalledTimes(1));
    const card = await layer.getCard(String(navigation.push.mock.calls[0]?.[0]).replace('/card/', ''));
    expect(card?.proof?.receiptIds).toEqual([SAMPLE_RECEIPT_IDS.filledSpy]);
    expect(card?.amounts).not.toBeNull();
  });
});
