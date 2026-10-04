import { DISCLOSURE, REASONS, STATUSES } from '@sleeve/core';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DEBT_SECURITY_LINE, DISCLAIMER, EXIT_LINE, NOT_AVAILABLE_YET } from '@/lib/copy';

import { lintText } from '../../../../scripts/copy-lint.mjs';

import { Amount } from './amount';
import { GatedTag, REASON_LABEL, ReasonTag, STATUS_TONE, StatusTag, statusLabel } from './badge';
import { ErrorBlock, FUNDS_STILL_HERE, StatTile } from './card';
import { DebtSecurityLine, ExitLine } from './debt-security-line';
import { Disclosure, DISCLOSURE_ANCHOR } from './disclosure';
import { EmptyState, LoadingState } from './empty-state';
import { Footer } from './footer';
import { GatedCard } from './gated-card';
import { DefinitionList, List, ListRow } from './list';
import { PageHeader } from './page-header';
import { QRCode } from './qr-code';
import { Skeleton, SkeletonGroup } from './skeleton';
import { Wordmark } from './wordmark';

describe('required lines', () => {
  it('prints the debt security line word for word', () => {
    render(<DebtSecurityLine />);
    expect(screen.getByText(DEBT_SECURITY_LINE).textContent).toBe('debt security, not a share');
  });

  it('prints the exit line word for word', () => {
    render(<ExitLine />);
    expect(screen.getByText(EXIT_LINE).textContent).toBe(
      "Sell on the secondary market. Redemption with the issuer exists only under the issuer's conditions and identity checks, and pays cash, not shares. Sleeve offers no redemption.",
    );
  });

  it('puts the disclaimer in the footer, word for word', () => {
    render(<Footer />);
    expect(within(screen.getByRole('contentinfo')).getByText(DISCLAIMER)).toBeInTheDocument();
  });
});

describe('Disclosure', () => {
  const paragraphs = ['First paragraph of the issuer text.', 'Second paragraph.', 'Third.', 'Fourth.'];

  it('shows every paragraph as given, the retrieval date, the source and the full keccak256 hash', () => {
    render(<Disclosure paragraphs={paragraphs} />);
    const block = screen.getByRole('region', { name: 'Issuer disclosure' });
    expect(block).toHaveAttribute('id', DISCLOSURE_ANCHOR);
    const shown = within(block)
      .getAllByText((_, element) => element?.tagName === 'P' && paragraphs.includes(element.textContent ?? ''))
      .map((element) => element.textContent);
    expect(shown).toEqual(paragraphs);
    expect(block).toHaveTextContent('Copied word for word from docs.robinhood.com/rhj, retrieved 2 October 2026.');
    expect(within(block).getByRole('link', { name: 'docs.robinhood.com/rhj' })).toHaveAttribute('href', 'https://docs.robinhood.com/rhj');
    expect(within(block).getByText(DISCLOSURE.keccak256)).toBeInTheDocument();
    expect(within(block).getByRole('button', { name: 'Copy disclosure hash' })).toBeInTheDocument();
  });
});

describe('tags', () => {
  it('shows each onchain status by name, in the tone DESIGN.md 12.3 gives it', () => {
    render(
      <>
        {STATUSES.map((status) => (
          <StatusTag key={status} status={status} />
        ))}
      </>,
    );
    expect(screen.getByText('REFUSED TICKER')).toBeInTheDocument();
    expect(screen.getByText('PART SOLD')).toBeInTheDocument();
    expect(statusLabel('REFUSED_ACCOUNT')).toBe('REFUSED ACCOUNT');
    expect(STATUS_TONE).toMatchObject({ FILLED: 'equity', SETTLED: 'equity', QUEUED: 'waiting', RECONCILED: 'waiting' });
    expect(STATUS_TONE).toMatchObject({ REFUSED_TICKER: 'danger', REFUSED_ACCOUNT: 'danger', SOLD: 'neutral', RELEASED: 'neutral' });
  });

  it('names every waiting reason in plain words that pass the copy lint, and nothing for NONE', () => {
    for (const label of Object.values(REASON_LABEL)) expect(lintText(label), label).toEqual([]);
    const { container } = render(<ReasonTag reason="NONE" />);
    expect(container).toBeEmptyDOMElement();
    render(
      <>
        {REASONS.map((reason) => (
          <ReasonTag key={reason} reason={reason} />
        ))}
      </>,
    );
    expect(screen.getByText('Market closed')).toBeInTheDocument();
  });

  it('labels a gated feature only as not available yet, with no action', () => {
    render(<GatedCard>Borrowing USDG against your Stock Tokens is not available yet.</GatedCard>);
    expect(screen.getByText(NOT_AVAILABLE_YET)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    render(<GatedTag />);
    expect(screen.getAllByText('Not available yet')).toHaveLength(2);
  });
});

describe('lists', () => {
  it('keeps a row link named by its title while the whole row is the target', () => {
    render(
      <List label="Receipts">
        <ListRow title="Bought SPY" meta="Receipt 611" trailing={<Amount value="937.25" unit="USDG" />} href="/receipts/611" />
        <ListRow title="Plain row" />
      </List>,
    );
    const list = screen.getByRole('list', { name: 'Receipts' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getByRole('link', { name: 'Bought SPY' })).toHaveAttribute('href', '/receipts/611');
    expect(within(list).getAllByRole('link')).toHaveLength(1);
  });

  it('marks fields that come from logs as derived', () => {
    render(
      <DefinitionList
        items={[
          { id: 'tx', term: 'Transaction hash', value: '0xabc', mono: true, derived: true },
          { id: 'usdg', term: 'USDG in', value: '1,200.000000 USDG' },
        ]}
      />,
    );
    expect(screen.getByText('Transaction hash').closest('dt')).toHaveTextContent('Transaction hash (derived)');
    expect(screen.getByText('USDG in').closest('dt')).toHaveTextContent(/^USDG in$/);
  });
});

describe('states', () => {
  it('announces loading by name and never shows a number', () => {
    render(<LoadingState label="Loading receipts" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading receipts');
  });

  it('marks skeletons busy with a hidden label and hides the blocks themselves', () => {
    const { container } = render(
      <SkeletonGroup label="Loading your sleeves">
        <Skeleton className="h-8 w-40" />
      </SkeletonGroup>,
    );
    const group = screen.getByRole('status');
    expect(group).toHaveAttribute('aria-busy', 'true');
    expect(group).toHaveTextContent('Loading your sleeves');
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('gives an empty state a heading, a next step and one action', () => {
    render(<EmptyState title="No payments yet" action={<a href="#receive">Show my address</a>}>Nothing splits until USDG arrives from outside.</EmptyState>);
    expect(screen.getByRole('heading', { name: 'No payments yet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Show my address' })).toBeInTheDocument();
  });

  it('says what failed and, for an owner action, that the USDG is still there', () => {
    render(<ErrorBlock title="The release did not go through" fundsStillHere />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('The release did not go through');
    expect(alert).toHaveTextContent(FUNDS_STILL_HERE);
  });

  it('takes any node as a stat value, so a skeleton can stand in while it loads', () => {
    render(<StatTile label="Waiting to buy" value={<SkeletonGroup label="Loading">x</SkeletonGroup>} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});

describe('page frame', () => {
  it('gives a page one h1, a way back and its actions', () => {
    render(<PageHeader title="Receipt 455" back={{ href: '/receipts', label: 'Receipts' }} actions={<button type="button">Make a card</button>} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Receipt 455' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Receipts' })).toHaveAttribute('href', '/receipts');
  });

  it('names the logo link Sleeve', () => {
    render(<Wordmark href="/home" />);
    expect(screen.getByRole('link', { name: 'Sleeve' })).toHaveAttribute('href', '/home');
  });
});

describe('QRCode', () => {
  it('draws one labelled image with a quiet zone of four modules', () => {
    render(<QRCode value="0x3efEf72Ee9aF42fd90f193A1A64aC25384179b36" label="QR code of your payment address" />);
    const image = screen.getByRole('img', { name: 'QR code of your payment address' });
    // Version 3 is 29 modules; with four on each side the view box is 37.
    expect(image).toHaveAttribute('viewBox', '0 0 37 37');
    expect(image.querySelectorAll('path')).toHaveLength(1);
  });
});
