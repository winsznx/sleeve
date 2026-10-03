import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SAMPLE_ACCOUNT, SAMPLE_RECEIPT_IDS, createMockDataLayer } from '@/data/mock';
import { DataLayerProvider } from '@/data/provider';
import type { InboxItem, SleeveDataLayer } from '@/data/types';
import { DEBT_SECURITY_LINE } from '@/lib/copy';

import { PaymentRow } from './payment-row';

async function sampleInbox(layer: SleeveDataLayer): Promise<InboxItem[]> {
  return layer.getInbox(SAMPLE_ACCOUNT);
}

function renderRow(layer: SleeveDataLayer, payment: InboxItem): HTMLElement {
  render(
    <DataLayerProvider dataLayer={layer}>
      <ul>
        <PaymentRow payment={payment} />
      </ul>
    </DataLayerProvider>,
  );
  return screen.getByRole('listitem');
}

describe('PaymentRow', () => {
  it('shows what a payment that bought became, with the debt security line under it', async () => {
    const layer = createMockDataLayer();
    const bought = (await sampleInbox(layer)).find((item) => item.sortedBy?.receiptId === SAMPLE_RECEIPT_IDS.filledSpy);
    if (bought === undefined) throw new Error('the sample inbox has no payment sorted by the SPY buy');
    const row = renderRow(layer, bought);
    await waitFor(() => expect(row).toHaveTextContent('1,080.00 USDG spendable, 120.00 USDG became SPY'));
    expect(row).toHaveTextContent(`became SPY${DEBT_SECURITY_LINE}`);
    expect(row).toHaveTextContent('1,200.00 USDGSorted');
  });

  it('shows a payment whose equity share waits without the line, since nothing was bought', async () => {
    const layer = createMockDataLayer();
    const waiting = (await sampleInbox(layer)).find((item) => item.sortedBy?.receiptId === SAMPLE_RECEIPT_IDS.queuedSession);
    if (waiting === undefined) throw new Error('the sample inbox has no payment sorted by the weekend wait');
    const row = renderRow(layer, waiting);
    await waitFor(() => expect(row).toHaveTextContent('675.00 USDG spendable, 75.00 USDG waiting, market closed'));
    expect(row).not.toHaveTextContent(DEBT_SECURITY_LINE);
  });

  it('says an unsplit payment is spendable until the rule splits it, and names a failed read', async () => {
    const layer = createMockDataLayer();
    const inbox = await sampleInbox(layer);
    const unsplit = inbox.find((item) => item.state !== 'SORTED');
    if (unsplit === undefined) throw new Error('the sample inbox has no unsplit payment');
    const row = renderRow(layer, unsplit);
    expect(row).toHaveTextContent('Spendable until your rule splits it');

    const sorted = inbox.find((item) => item.sortedBy !== null);
    if (sorted === undefined) throw new Error('the sample inbox has no sorted payment');
    const broken = { ...layer, getReceipt: () => Promise.reject(new Error('RPC down')) };
    render(
      <DataLayerProvider dataLayer={broken}>
        <ul aria-label="broken">
          <PaymentRow payment={sorted} />
        </ul>
      </DataLayerProvider>,
    );
    expect(await screen.findByText('What it became did not load.')).toBeInTheDocument();
  });
});
