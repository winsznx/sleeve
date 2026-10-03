import { DISCLOSURE } from '@sleeve/core';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createMockDataLayer } from '@/data/mock';
import { DataLayerProvider } from '@/data/provider';
import type { SleeveDataLayer } from '@/data/types';
import { BUILT_ON_LINE, DEBT_SECURITY_LINE, EXIT_LINE } from '@/lib/copy';
import { disclosureParagraphs, readDisclosureText } from '@/lib/disclosure';
import { PROHIBITED_JURISDICTIONS, RESTRICTED_JURISDICTIONS } from '@/lib/jurisdictions';

import { lintText } from '../../../../scripts/copy-lint.mjs';

import { resolveExampleReceiptId } from './example-receipt';
import { ONE_SENTENCE } from './landing-copy';
import { MarketingHeader } from './marketing-header';
import LandingPage from './page';

async function renderLanding(layer: SleeveDataLayer = createMockDataLayer()): Promise<HTMLElement> {
  const { container } = render(<DataLayerProvider dataLayer={layer}>{await LandingPage()}</DataLayerProvider>);
  return container;
}

function section(name: string): HTMLElement {
  return screen.getByRole('region', { name });
}

/** Every text node outside the issuer's verbatim disclosure, one per line, as a reader meets them. */
function visibleCopy(root: HTMLElement): string[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const lines: string[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.textContent?.trim() ?? '';
    if (text !== '' && node.parentElement?.closest('#issuer-disclosure') === null) lines.push(text);
  }
  return lines;
}

describe('landing page', () => {
  it('leads with the one sentence as the page heading', async () => {
    await renderLanding();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(ONE_SENTENCE);
    expect(ONE_SENTENCE).toBe(
      'When you get paid, part of it becomes a US Stock Token you own and the rest stays spendable. You set it once.',
    );
    const starts = screen.getAllByRole('link', { name: 'Get your payment address' });
    expect(starts.map((link) => link.getAttribute('href'))).toEqual(['/onboard', '/onboard']);
    expect(screen.getByText(BUILT_ON_LINE)).toBeInTheDocument();
  });

  it('explains how it works in three steps, in order', async () => {
    await renderLanding();
    const steps = within(section('How it works')).getAllByRole('listitem');
    expect(steps.map((step) => within(step).getByRole('heading').textContent)).toEqual([
      'Set your rule once',
      'Share your payment address',
      'Get paid',
    ]);
    expect(steps[0]).toHaveTextContent('The suggested start is 10% in SPY, a broad fund.');
  });

  it('shows the example payday from its receipt, with the debt security line and links to the receipt and the verifier', async () => {
    await renderLanding();
    expect(await screen.findByRole('link', { name: 'Open receipt 455' })).toHaveAttribute('href', '/receipts/455');
    const payday = screen.getByRole('list', { name: 'The payday, as it arrived' });
    expect(payday).toHaveTextContent('Payment arrived1,200.00 USDG');
    expect(payday).toHaveTextContent('Stays spendable1,080.00 USDG');
    expect(payday).toHaveTextContent('Became SPY0.155872 SPY');
    expect(within(payday).getByText(DEBT_SECURITY_LINE)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Recompute this receipt' })).toHaveAttribute('href', '/verify/455');
  });

  it('offers the receipt as proof, field by field, with the verify page and the example receipt', async () => {
    await renderLanding();
    const proof = section('The receipt is the proof');
    expect(within(proof).getByRole('link', { name: 'Verify a receipt' })).toHaveAttribute('href', '/verify');
    expect(within(proof).getByRole('link', { name: 'Open the example receipt' })).toHaveAttribute('href', '/receipts/455');
    const fields = await within(proof).findByRole('region', { name: 'Receipt 455, as recorded' });
    expect(fields).toHaveTextContent('Price paid, all in769.85 USDG per SPY');
    expect(fields).toHaveTextContent('Bought 0.04 percent above the market reference. The cap was 1.00 percent.');
    expect(fields).toHaveTextContent('Transaction (derived)');
    expect(within(fields).getByRole('link', { name: DISCLOSURE.keccak256 })).toHaveAttribute('href', '#issuer-disclosure');
    expect(within(fields).getByRole('link', { name: 'Recompute receipt 455' })).toHaveAttribute('href', '/verify/455');
  });

  it('says what Sleeve is not, with borrow and the pay link only as gated cards', async () => {
    await renderLanding();
    const not = section('What Sleeve is not');
    expect(within(not).getAllByText('Not available yet')).toHaveLength(2);
    expect(within(not).getByText('Borrowing USDG against your Stock Tokens is not available yet.')).toBeInTheDocument();
    expect(within(not).getByText('A pay link, where a payer sends and splits in one step, is not available yet.')).toBeInTheDocument();
    const live = [...screen.queryAllByRole('link'), ...screen.queryAllByRole('button')];
    expect(live.filter((control) => /borrow|pay link|basket|crew/i.test(control.textContent ?? ''))).toEqual([]);
  });

  it('names every restricted and prohibited jurisdiction', async () => {
    await renderLanding();
    const eligibility = section('Who can use Sleeve');
    for (const country of [...Object.values(RESTRICTED_JURISDICTIONS), ...Object.values(PROHIBITED_JURISDICTIONS)]) {
      expect(eligibility).toHaveTextContent(country);
    }
    expect(eligibility).toHaveTextContent('You cannot use it if you are a US person');
  });

  it('says what a holder holds, the exit line, and the issuer disclosure word for word with its hash', async () => {
    await renderLanding();
    const hold = section('What you hold');
    expect(hold).toHaveTextContent(
      'Each Stock Token is a debt security, not a share, issued by Robinhood Assets (Jersey) Limited.',
    );
    expect(within(hold).getByText(EXIT_LINE)).toBeInTheDocument();
    const disclosure = within(hold).getByRole('region', { name: 'Issuer disclosure' });
    for (const paragraph of disclosureParagraphs(await readDisclosureText())) {
      expect(within(disclosure).getByText(paragraph)).toBeInTheDocument();
    }
    expect(disclosure).toHaveTextContent(DISCLOSURE.keccak256);
  });

  it('passes the copy lint as rendered, outside the verbatim disclosure', async () => {
    const container = await renderLanding();
    await screen.findByRole('link', { name: 'Open receipt 455' });
    const findings = visibleCopy(container).flatMap((line) => lintText(line).map((finding) => `${finding.rule}: ${line}`));
    expect(findings).toEqual([]);
  });

  it('explains the split without numbers when there is no example receipt yet', async () => {
    const base = createMockDataLayer();
    await renderLanding({ ...base, getReceipt: () => Promise.resolve(null) });
    expect(await screen.findByRole('heading', { name: 'The suggested start' })).toBeInTheDocument();
    expect(screen.getByText('Every payment: 90% stays spendable and 10% buys SPY.')).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'What every receipt records' })).toBeInTheDocument();
  });
});

describe('example receipt', () => {
  it('uses the sample SPY buy with the mock, a configured id on chain, and none otherwise', () => {
    expect(resolveExampleReceiptId('mock', undefined)).toBe(455n);
    expect(resolveExampleReceiptId('chain', undefined)).toBeNull();
    expect(resolveExampleReceiptId('chain', ' 1207 ')).toBe(1207n);
    expect(() => resolveExampleReceiptId('chain', '0x4b7')).toThrow(/must be a receipt id/);
  });
});

describe('marketing header', () => {
  it('carries the wordmark, a skip link and one way into the app', () => {
    render(<MarketingHeader />);
    expect(screen.getByRole('link', { name: 'Sleeve' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main-content');
    expect(screen.getByRole('link', { name: 'Open the app' })).toHaveAttribute('href', '/home');
    expect(screen.getByRole('link', { name: 'How it works' })).toHaveAttribute('href', '#how-it-works');
  });
});
