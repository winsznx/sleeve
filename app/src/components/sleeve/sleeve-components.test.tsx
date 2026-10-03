import { STATUSES, type Status } from '@sleeve/core';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { createMockDataLayer, SAMPLE_ACCOUNT, SAMPLE_RECEIPT_IDS } from '@/data/mock';
import type { BucketView, Holding, InboxItem, LedgerView, ReceiptRecord } from '@/data/types';
import { DEBT_SECURITY_LINE } from '@/lib/copy';
import type { Rule } from '@sleeve/core';

import { BucketWaitingCard, LONG_WAIT_SECONDS } from './bucket-waiting-card';
import { HoldingRow } from './holding-row';
import { InboxRow } from './inbox-row';
import { PremiumLine, premiumLinePropsOf, premiumSentence } from './premium-line';
import { ReceiptRow, ReceiptSummary } from './receipt-summary';
import { RuleSummary } from './rule-summary';
import { SleeveCard } from './sleeve-card';
import { SplitLegend, SplitRail, splitPartsOf } from './split-rail';

let receipts: ReceiptRecord[] = [];
let holdings: Holding[] = [];
let inbox: InboxItem[] = [];
let ledger: LedgerView;
let rule: Rule;
let buckets: BucketView[] = [];

beforeAll(async () => {
  const layer = createMockDataLayer();
  const found = await Promise.all(Object.values(SAMPLE_RECEIPT_IDS).map((id) => layer.getReceipt(id)));
  receipts = found.filter((record): record is ReceiptRecord => record !== null);
  [holdings, inbox, ledger, rule, buckets] = await Promise.all([
    layer.getHoldings(SAMPLE_ACCOUNT),
    layer.getInbox(SAMPLE_ACCOUNT),
    layer.getLedger(SAMPLE_ACCOUNT),
    layer.getRule(SAMPLE_ACCOUNT),
    layer.getBuckets(SAMPLE_ACCOUNT),
  ]);
});

function byStatus(status: Status): ReceiptRecord {
  const found = receipts.find((record) => record.receipt.status === status);
  if (found === undefined) throw new Error(`no sample ${status} receipt`);
  return found;
}

function byId(id: bigint): ReceiptRecord {
  const found = receipts.find((record) => record.receipt.id === id);
  if (found === undefined) throw new Error(`no sample receipt ${id}`);
  return found;
}

const TOKEN_STATUSES: readonly Status[] = ['FILLED', 'SETTLED', 'PART_SOLD', 'SOLD'];

describe('split rail', () => {
  it('reads each receipt into spend, bought and waiting, with refused equity counted as spend', () => {
    expect(splitPartsOf(byId(SAMPLE_RECEIPT_IDS.filledSpySecond).receipt)).toEqual({ spend: 843_525_000n, equity: 93_725_000n, waiting: 0n });
    expect(splitPartsOf(byId(SAMPLE_RECEIPT_IDS.queuedSession).receipt)).toEqual({ spend: 675_000_000n, equity: 0n, waiting: 75_000_000n });
    expect(splitPartsOf(byStatus('REFUSED_TICKER').receipt)).toEqual({ spend: 500_000_000n, equity: 0n, waiting: 0n });
    expect(splitPartsOf(byStatus('SOLD').receipt)).toBeNull();
    expect(splitPartsOf(byStatus('RECONCILED').receipt)).toBeNull();
  });

  it('is hidden from assistive technology, drops empty parts, and weighs the rest by amount', () => {
    const { container } = render(<SplitRail parts={{ spend: 9_000n, equity: 1_000n, waiting: 0n }} />);
    const rail = container.firstElementChild;
    expect(rail).toHaveAttribute('aria-hidden', 'true');
    const segments = Array.from(rail?.children ?? []);
    expect(segments.map((segment) => segment.getAttribute('data-part'))).toEqual(['spend', 'equity']);
    expect(segments.map((segment) => (segment instanceof HTMLElement ? segment.style.flexGrow : ''))).toEqual(['9000', '1000']);
  });

  it('renders nothing for an empty payment', () => {
    const { container } = render(<SplitRail parts={{ spend: 0n, equity: 0n, waiting: 0n }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('puts exact amounts and plain labels in the legend', () => {
    render(
      <SplitLegend
        items={[
          { kind: 'spend', amount: 843_525_000n, label: 'spendable' },
          { kind: 'equity', amount: 93_725_000n, label: 'became SPY' },
        ]}
      />,
    );
    const [spend, equity] = screen.getAllByRole('listitem');
    expect(spend).toHaveTextContent(/^843\.525 USDG\s*spendable$/);
    expect(equity).toHaveTextContent(/^93\.725 USDG\s*became SPY$/);
  });
});

describe('ReceiptSummary', () => {
  it.each(STATUSES.map((status) => [status]))('shows %s with its tag and plain sentence', (status) => {
    const record = byStatus(status);
    render(<ReceiptSummary record={record} href={`/receipts/${record.receipt.id}`} verifyHref={`/verify/${record.receipt.id}`} />);
    const card = screen.getByRole('article');
    expect(within(card).getByText(status.replace(/_/g, ' '))).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: `Open receipt ${record.receipt.id}` })).toHaveAttribute(
      'href',
      `/receipts/${record.receipt.id}`,
    );
    expect(within(card).getByRole('link', { name: 'Recompute this receipt' })).toHaveAttribute('href', `/verify/${record.receipt.id}`);
    const debtLines = within(card).queryAllByText(DEBT_SECURITY_LINE);
    expect(debtLines).toHaveLength(TOKEN_STATUSES.includes(status) ? 1 : 0);
  });

  it('leads a fill with the two numbers, the token, the debt security line and the premium', () => {
    render(<ReceiptSummary record={byId(SAMPLE_RECEIPT_IDS.filledSpySecond)} />);
    const card = screen.getByRole('article');
    expect(card).toHaveTextContent(/843\.525 USDG\s*spendable/);
    expect(card).toHaveTextContent(/93\.725 USDG\s*became SPY/);
    expect(card).toHaveTextContent('0.121335 SPY for 93.725 USDG');
    expect(card).toHaveTextContent('Bought 0.07 percent above the market reference.');
    // The debt security line sits directly under the token amount.
    expect(within(card).getByText(DEBT_SECURITY_LINE).previousElementSibling).toHaveTextContent('0.121335 SPY for 93.725 USDG');
  });

  it('labels a waiting part with its reason', () => {
    render(<ReceiptSummary record={byId(SAMPLE_RECEIPT_IDS.queuedSession)} />);
    expect(screen.getByRole('article')).toHaveTextContent(/75\.00 USDG\s*waiting: market closed/);
  });
});

describe('ReceiptRow', () => {
  it('links the title and shows the status, the number, the time and the amount', () => {
    const record = byId(SAMPLE_RECEIPT_IDS.filledSpySecond);
    render(
      <ul>
        <ReceiptRow record={record} href="/receipts/611" />
      </ul>,
    );
    const row = screen.getByRole('listitem');
    expect(within(row).getByRole('link', { name: 'Bought SPY' })).toHaveAttribute('href', '/receipts/611');
    expect(row).toHaveTextContent('FILLED');
    expect(row).toHaveTextContent('Receipt 611');
    expect(row).toHaveTextContent('25 Sep 2026, 14:05 UTC');
    expect(row).toHaveTextContent('937.25 USDG');
  });
});

describe('PremiumLine', () => {
  it('words the premium by side and sign, never as a gain or loss', () => {
    expect(premiumSentence('buy', 4n)).toBe('Bought 0.04 percent above the market reference.');
    expect(premiumSentence('buy', -3n)).toBe('Bought 0.03 percent below the market reference.');
    expect(premiumSentence('buy', 0n)).toBe('Bought at the market reference.');
    expect(premiumSentence('sell', -9n)).toBe('Sold 0.09 percent below the market reference.');
  });

  it('keeps the all-in price and the Chainlink reference apart, each with its own time', () => {
    const props = premiumLinePropsOf(byId(SAMPLE_RECEIPT_IDS.filledSpySecond).receipt);
    if (props === null) throw new Error('a fill has a premium line');
    render(<PremiumLine {...props} />);
    expect(screen.getByText('All-in price').nextElementSibling).toHaveTextContent('772.44 USDG per SPYPaid 25 Sep 2026, 14:05 UTC');
    expect(screen.getByText('Market reference').nextElementSibling).toHaveTextContent(
      '771.90 USD per SPYChainlink price from 25 Sep 2026, 13:20 UTC',
    );
  });

  it('has nothing to say for receipts that neither bought nor sold', () => {
    expect(premiumLinePropsOf(byStatus('QUEUED').receipt)).toBeNull();
    expect(premiumLinePropsOf(byStatus('RELEASED').receipt)).toBeNull();
  });
});

describe('SleeveCard', () => {
  it('shows spend, and unsorted USDG as spendable too', () => {
    render(<SleeveCard kind="spend" spend={ledger.spend} unsorted={ledger.unsorted} />);
    const card = screen.getByRole('heading', { name: 'Spend' }).closest('section');
    expect(card).toHaveTextContent('3,356.05 USDG');
    expect(card).toHaveTextContent('Another 165.80 USDG arrived and is not sorted yet. It is spendable too.');
  });

  it('puts the debt security line under every holding and shows waiting USDG', () => {
    render(<SleeveCard kind="equity" holdings={holdings} pending={ledger.pendingTotal} />);
    expect(screen.getAllByText(DEBT_SECURITY_LINE)).toHaveLength(holdings.length);
    expect(screen.getByText('75.00 USDG').closest('p')).toHaveTextContent('75.00 USDG waiting to buy, held as USDG in your account.');
  });

  it('says what happens next when there are no Stock Tokens yet', () => {
    render(<SleeveCard kind="equity" holdings={[]} pending={0n} />);
    expect(screen.getByText('No Stock Tokens yet. Your equity share buys them as payments arrive.')).toBeInTheDocument();
  });
});

describe('BucketWaitingCard', () => {
  it('gives the reason, the reopen time and how long it has waited, and releases on request', () => {
    const bucket = buckets[0];
    if (bucket === undefined) throw new Error('the sample owner has a waiting bucket');
    const onRelease = vi.fn();
    render(
      <BucketWaitingCard bucket={bucket} now={ledger.asOf.timestamp} reopensAt={1_790_553_600n} rule={rule} onRelease={onRelease} />,
    );
    const card = screen.getByRole('article');
    expect(within(card).getByRole('heading')).toHaveTextContent('75.00 USDG waiting to buy SPY');
    expect(card).toHaveTextContent('Market closed');
    expect(card).toHaveTextContent('The market is closed. Sleeve buys SPY after it reopens, Sun 27 Sep, 20:00 New York time.');
    expect(card).toHaveTextContent('Waiting for 4 hours, since 26 Sep 2026, 13:30 UTC.');
    expect(card).not.toHaveTextContent('raise your cap');
    fireEvent.click(within(card).getByRole('button', { name: 'Release to spend' }));
    expect(onRelease).toHaveBeenCalledTimes(1);
  });

  it('shows the release running and refuses a second click', () => {
    const onRelease = vi.fn();
    const bucket: BucketView = { tickerId: 0, amount: 75_000_000n, since: 0n, reason: 'SESSION' };
    render(<BucketWaitingCard bucket={bucket} now={3_600n} onRelease={onRelease} releasing />);
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(button);
    expect(onRelease).not.toHaveBeenCalled();
  });

  it('asks for a decision after five days and links the rule', () => {
    const bucket: BucketView = { tickerId: 1, amount: 41_250_000n, since: 1_000n, reason: 'PREMIUM' };
    render(
      <BucketWaitingCard bucket={bucket} now={1_000n + LONG_WAIT_SECONDS} rule={rule} onRelease={() => undefined} ruleHref="/rule" />,
    );
    const card = screen.getByRole('article');
    expect(card).toHaveTextContent('Waiting for 5 days');
    expect(card).toHaveTextContent('You can raise your cap, switch ticker, or release it to spend.');
    expect(within(card).getByRole('link', { name: 'Edit your rule' })).toHaveAttribute('href', '/rule');
    expect(card).toHaveTextContent('more than 1.00 percent above the market reference');
  });
});

describe('HoldingRow', () => {
  it('puts the debt security line directly under the token amount and values it at the Chainlink price', () => {
    const holding = holdings[0];
    if (holding === undefined) throw new Error('the sample owner holds SPY');
    render(
      <ul>
        <HoldingRow holding={holding} href="/sell" />
      </ul>,
    );
    const row = screen.getByRole('listitem');
    const link = within(row).getByRole('link', { name: '0.361668 SPY' });
    expect(link).toHaveAttribute('href', '/sell');
    expect(within(row).getByText(DEBT_SECURITY_LINE)).toBeInTheDocument();
    expect(row).toHaveTextContent('279.32 USDG');
    expect(row).toHaveTextContent('SPDR S&P 500 ETF Trust, in 3 lots. Valued at the Chainlink price from 25 Sep 2026, 16:03 UTC.');
    expect(row).not.toHaveTextContent('arrived outside Sleeve');
  });

  it('says when some of the balance cannot be sold through Sleeve', () => {
    const holding = holdings[0];
    if (holding === undefined) throw new Error('the sample owner holds SPY');
    render(
      <ul>
        <HoldingRow holding={{ ...holding, balance: holding.balance + 10_000_000_000_000_000n }} />
      </ul>,
    );
    expect(screen.getByRole('listitem')).toHaveTextContent('0.01 SPY arrived outside Sleeve and cannot be sold here.');
  });
});

describe('InboxRow', () => {
  it('shows each state in words, and links a sorted transfer to its receipt', () => {
    render(
      <ul>
        {inbox.map((item) => (
          <InboxRow key={item.id} item={item} />
        ))}
      </ul>,
    );
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('45.80 USDG received');
    expect(rows[0]).toHaveTextContent('Not sorted yet');
    expect(rows[0]).toHaveTextContent('From 0xB4ae…98C7');
    expect(rows[1]).toHaveTextContent('Waiting to sort');
    expect(rows[1]).toHaveTextContent('anyone can start the split');
    const sorted = rows[2];
    if (sorted === undefined) throw new Error('expected a sorted transfer');
    expect(within(sorted).getByRole('link', { name: 'Receipt 642' })).toHaveAttribute('href', '/receipts/642');
  });
});

describe('RuleSummary', () => {
  it('states the split, the caps, the minimum buy and the worst case against the live price', () => {
    render(<RuleSummary rule={rule} editHref="/rule" />);
    const card = screen.getByRole('heading', { name: 'Your rule' }).closest('section');
    expect(card).toHaveTextContent('Every payment: 90% stays spendable and 10% buys SPY.');
    expect(card).toHaveTextContent('Active');
    expect(card).toHaveTextContent('Version 2');
    expect(card).toHaveTextContent('1.00% above the market reference');
    expect(card).toHaveTextContent('the most a buy could pay above the live price is about 1.50 percent');
    expect(card).toHaveTextContent('0.50% from the quote');
    expect(card).toHaveTextContent('25.00 USDG');
    expect(screen.getByRole('link', { name: 'Edit rule' })).toHaveAttribute('href', '/rule');
  });

  it('explains a paused rule and an unset one', () => {
    const { rerender } = render(<RuleSummary rule={{ ...rule, status: 'PAUSED' }} />);
    expect(screen.getByText('Paused', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText(/New USDG stays unsorted and spendable/)).toBeInTheDocument();
    rerender(<RuleSummary rule={{ ...rule, status: 'NONE' }} editHref="/rule" />);
    expect(screen.getByRole('heading', { name: 'No rule yet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Set your rule' })).toHaveAttribute('href', '/rule');
  });
});
