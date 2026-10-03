import { describe, expect, it } from 'vitest';

import {
  BUILT_ON_LINE,
  DEBT_SECURITY_LINE,
  DISCLAIMER,
  EXIT_LINE,
  ISSUER_NAME,
  NOT_AVAILABLE_YET,
  SAMPLE_DATA_LINE,
} from '@/lib/copy';

import { DEFAULT_TARGET, lintPaths, lintSource, lintText, REQUIRED_LINES } from '../../scripts/copy-lint.mjs';

function rulesOf(text: string): string[] {
  return lintText(text).map((finding) => finding.rule);
}

describe('copy lint rules (I12, PRD 11)', () => {
  it.each([
    ['Bought 0.1 SPY shares', 'share'],
    ['Your shares of QQQ', 'share'],
    ['equity shares', 'share'],
    ['share price', 'share'],
    ['a share of SPY', 'share'],
    ['Become a shareholder', 'share'],
    ['You own the stock', 'stock-ownership'],
    ['stock ownership for everyone', 'stock-ownership'],
    ['ownership of the underlying', 'stock-ownership'],
    ['Collect dividends', 'dividend'],
    ['Earn yield on USDG', 'yield'],
    ['5% APY', 'yield'],
    ['Strong returns', 'performance'],
    ['Annualized gain', 'performance'],
    ['best execution on every buy', 'best-execution'],
    ['always the best price', 'best-execution'],
    ['Buy tokenized stocks', 'tokenized-stock'],
    ['tokenised equities', 'tokenized-stock'],
    ['Live on Hood Chain', 'hood-chain'],
    ['Robinhood Stock Tokens', 'bare-robinhood'],
    ["Robinhood's wallet", 'bare-robinhood'],
    ['ROBINHOOD CHAIN', 'bare-robinhood'],
    ['Robinhood chain', 'bare-robinhood'],
    ['Buy $HOOD', 'hood-ticker'],
    ['two stock tokens', 'stock-token-case'],
    ['Our partner Robinhood Chain', 'partnership'],
    ['Endorsed by the issuer', 'partnership'],
    ['Pay now — settle later', 'dash'],
    ['Monday–Friday', 'dash'],
    ['Borrow against your Stock Tokens', 'gated-feature'],
    ['Send your pay link', 'gated-feature'],
    ['Pick a basket', 'gated-feature'],
    ['Join a crew', 'gated-feature'],
  ])('flags %j as %s', (text, rule) => {
    expect(rulesOf(text)).toContain(rule);
  });

  it.each([
    'Your equity share waits as USDG.',
    'Spend share 90%, equity share 10%',
    '10% share of pay',
    'Debt security, not a share.',
    'Share card',
    'Share',
    'Tap to share',
    'Copy or share the address',
    'Built on Robinhood Chain',
    'Robinhood Chain, chain id 4663',
    'Copied word for word from docs.robinhood.com/rhj',
    'You hold a Stock Token, a debt security.',
    'STOCK TOKENS',
    'Stock Tokens issued by Robinhood Assets (Jersey) Limited',
    'Borrowing against Stock Tokens is not available yet.',
    'Crews: not available yet',
    'The market reopens Sunday at 20:00 New York time.',
    'Bought 0.10 percent above the market reference.',
  ])('passes %j', (text) => {
    expect(rulesOf(text)).toEqual([]);
  });

  it('passes every line the product must show word for word', () => {
    const lines = [DISCLAIMER, EXIT_LINE, DEBT_SECURITY_LINE, BUILT_ON_LINE, ISSUER_NAME, NOT_AVAILABLE_YET, SAMPLE_DATA_LINE];
    expect(lines.flatMap(rulesOf)).toEqual([]);
  });

  it('allows the disclaimer and the exit line exactly as copy.ts holds them', () => {
    expect([...REQUIRED_LINES].sort()).toEqual([DISCLAIMER, EXIT_LINE].sort());
  });

  it('still flags a near copy of a required line', () => {
    expect(rulesOf('Sleeve is affiliated with Robinhood Markets, Inc.')).toEqual(['bare-robinhood', 'partnership']);
  });
});

describe('copy lint over source files', () => {
  const source = `
'use client';
import { BorrowCard } from './borrow-card';
type Feature = 'borrow' | 'crews';
const keys = { shares: 1, 'crew-id': 2 };
const trigger = 'PAYLINK';
const label = 'Pay link, not available yet';
export function Holding({ amount }: { amount: string }) {
  return (
    <section className="share-grid" data-kind="dividend" title="Holding">
      <p>You hold {amount} <strong>shares</strong> of SPY</p>
      <p>Your equity <strong>share</strong> waits &mdash; the market is closed.</p>
      <button aria-label="Borrow now">{\`\${amount} yield\`}</button>
    </section>
  );
}
`;
  const findings = lintSource(source, 'holding.tsx');

  it('reads JSX text with its inline elements, entities, attributes and templates', () => {
    expect(findings.map((finding) => `${finding.line}:${finding.rule}`).sort()).toEqual([
      '11:share',
      '12:dash',
      '13:gated-feature',
      '13:yield',
    ]);
  });

  it('skips imports, types, object keys, enum tokens and silent attributes', () => {
    expect(findings.some((finding) => [3, 4, 5, 6, 7, 10].includes(finding.line))).toBe(false);
  });
});

describe('app/src', () => {
  it('has no UI string that breaks a copy rule', () => {
    const { files, findings } = lintPaths([DEFAULT_TARGET]);
    expect(files).toBeGreaterThan(0);
    expect(findings).toEqual([]);
  });
});
