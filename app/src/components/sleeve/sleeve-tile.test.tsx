import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';

import { createMockDataLayer, SAMPLE_ACCOUNT, SAMPLE_RECEIPT_IDS } from '@/data/mock';
import type { Holding, InboxItem, ReceiptRecord } from '@/data/types';
import { DEBT_SECURITY_LINE } from '@/lib/copy';

import { paymentStory } from './payment-outcome';
import { PaymentRow } from './payment-row';
import { SpendTile, StockTokensTile } from './sleeve-tile';

let holdings: Holding[] = [];
let inbox: InboxItem[] = [];
let receipts: ReceiptRecord[] = [];

beforeAll(async () => {
  const layer = createMockDataLayer();
  [holdings, inbox, receipts] = await Promise.all([
    layer.getHoldings(SAMPLE_ACCOUNT),
    layer.getInbox(SAMPLE_ACCOUNT),
    layer.listReceipts({ account: SAMPLE_ACCOUNT, limit: 100 }).then((page) => page.items),
  ]);
});

describe('the sleeve tiles', () => {
  it('shows spend with what else is spendable, and the way to payments', () => {
    render(<SpendTile spend={3_356_050_000n} unsorted={165_800_000n} />);
    const tile = screen.getByRole('region', { name: 'Spend' });
    expect(tile).toHaveTextContent('3,356.05 USDG');
    expect(tile).toHaveTextContent('Another 165.80 USDG arrived and is not sorted yet. It is spendable too.');
    expect(within(tile).getByRole('link', { name: 'See payments' })).toHaveAttribute('href', '/payments');
  });

  it('shows Stock Tokens at the Chainlink reference with the debt security line, and what waits', () => {
    render(<StockTokensTile holdings={holdings} pending={75_000_000n} />);
    const tile = screen.getByRole('region', { name: 'Stock Tokens' });
    expect(tile).toHaveTextContent('304.29 USDG');
    expect(within(tile).getByText(DEBT_SECURITY_LINE)).toBeInTheDocument();
    expect(tile).toHaveTextContent('75.00 USDG waiting to buy, held as USDG in your account.');
  });

  it('says none yet before anything was bought', () => {
    render(<StockTokensTile holdings={[]} pending={0n} />);
    const tile = screen.getByRole('region', { name: 'Stock Tokens' });
    expect(tile).toHaveTextContent('None yet');
    expect(within(tile).queryByText(DEBT_SECURITY_LINE)).toBeNull();
  });
});

describe('PaymentRow', () => {
  it('links a sorted payment to the details of its split and says what it became', () => {
    const item = inbox.find((candidate) => candidate.sortedBy?.receiptId === SAMPLE_RECEIPT_IDS.filledSpy);
    const record = receipts.find((candidate) => candidate.receipt.id === SAMPLE_RECEIPT_IDS.filledSpy);
    if (item === undefined || record === undefined) throw new Error('no sample buy');
    render(
      <ul>
        <PaymentRow item={item} story={paymentStory(item, record)} href={`/receipts/${record.receipt.id}`} />
      </ul>,
    );
    expect(screen.getByRole('link', { name: '1,200.00 USDG, details and proof' })).toHaveAttribute('href', '/receipts/455');
    expect(screen.getByText('Bought')).toHaveAttribute('data-status', 'bought');
    expect(screen.getByText('120.00 USDG became 0.155872 SPY')).toBeInTheDocument();
    expect(screen.getByText(DEBT_SECURITY_LINE)).toBeInTheDocument();
  });

  it('opens and closes a money trail in place of the link when it has one', () => {
    const item = inbox.find((candidate) => candidate.sortedBy?.receiptId === SAMPLE_RECEIPT_IDS.filledSpy);
    const record = receipts.find((candidate) => candidate.receipt.id === SAMPLE_RECEIPT_IDS.filledSpy);
    if (item === undefined || record === undefined) throw new Error('no sample buy');
    const toggles: boolean[] = [];
    const { rerender } = render(
      <ul>
        <PaymentRow
          item={item}
          story={paymentStory(item, record)}
          trail={{ id: 'trail', expanded: false, onToggle: () => toggles.push(true), content: <p>The trail</p> }}
        />
      </ul>,
    );
    const button = screen.getByRole('button', { name: '1,200.00 USDG, show its money trail' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveAttribute('aria-controls', 'trail');
    expect(screen.queryByText('The trail')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    fireEvent.click(button);
    expect(toggles).toHaveLength(1);
    rerender(
      <ul>
        <PaymentRow
          item={item}
          story={paymentStory(item, record)}
          trail={{ id: 'trail', expanded: true, onToggle: () => toggles.push(true), content: <p>The trail</p> }}
        />
      </ul>,
    );
    expect(screen.getByRole('button', { name: '1,200.00 USDG, hide its money trail' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('The trail')).toBeInTheDocument();
  });

  it('gives an unsorted payment no link and says it is spendable', () => {
    const [item] = inbox;
    if (item === undefined) throw new Error('no payment');
    render(
      <ul>
        <PaymentRow item={item} story={paymentStory(item, null)} />
      </ul>,
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Received')).toBeInTheDocument();
    expect(screen.getByText('Not sorted yet. It is spendable in your account until your rule splits it.')).toBeInTheDocument();
  });
});
