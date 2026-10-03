import { describe, expect, it } from 'vitest';

import { PRIMARY_NAV, SECONDARY_NAV } from '@/components/sleeve/navigation';

import { flattenGroups, paletteGroups, paletteNumber } from './palette-items';

const PAGES = [...PRIMARY_NAV, ...SECONDARY_NAV];

function labels(query: string, signedIn = true): string[] {
  return flattenGroups(paletteGroups({ query, pages: PAGES, signedIn })).map((item) => item.label);
}

describe('paletteNumber', () => {
  it('reads an action number with or without the hash, and drops leading zeros', () => {
    expect(paletteNumber('642')).toBe(642n);
    expect(paletteNumber(' #642 ')).toBe(642n);
    expect(paletteNumber('# 642')).toBe(642n);
    expect(paletteNumber('0642')).toBe(642n);
  });

  it('refuses anything that is not a number from 1', () => {
    expect(paletteNumber('0')).toBeNull();
    expect(paletteNumber('64.2')).toBeNull();
    expect(paletteNumber('-3')).toBeNull();
    expect(paletteNumber('spy')).toBeNull();
    expect(paletteNumber('')).toBeNull();
  });
});

describe('paletteGroups', () => {
  it('lists every page, the actions and the four launch Stock Tokens for an empty query, in that order', () => {
    const groups = paletteGroups({ query: '', pages: PAGES, signedIn: true });
    expect(groups.map((group) => group.label)).toEqual(['Pages', 'Actions', 'Stock Tokens']);
    expect(labels('')).toEqual([
      'Home',
      'Payments',
      'Holdings',
      'Rule',
      'History',
      'Settings',
      'Help',
      'Check a split',
      'Receive USDG',
      'Copy payment address',
      'Sell a Stock Token back to USDG',
      'About Sleeve',
      'SPY',
      'QQQ',
      'NVDA',
      'AAPL',
    ]);
  });

  it('offers receiving and copying the address only to a signed-in owner', () => {
    expect(labels('', false)).not.toContain('Receive USDG');
    expect(labels('', false)).not.toContain('Copy payment address');
    expect(labels('', false)).toContain('Sell a Stock Token back to USDG');
  });

  it('matches every word against labels, descriptions and keywords, case aside', () => {
    expect(labels('spy')).toEqual(['SPY']);
    expect(labels('apple')).toEqual(['AAPL']);
    expect(labels('INBOX')).toEqual(['Payments']);
    expect(labels('csv')).toEqual(['History']);
    expect(labels('payment address')).toEqual(['Home', 'Receive USDG', 'Copy payment address']);
  });

  it('puts labels that start with the query first within a group', () => {
    // "ch" is in the descriptions of Holdings ("Chainlink") and Rule ("each"), and starts "Check a split".
    const pages = paletteGroups({ query: 'ch', pages: PAGES, signedIn: true }).find((group) => group.key === 'pages');
    expect(pages?.items.map((item) => item.label)).toEqual(['Check a split', 'Holdings', 'Rule']);
  });

  it('turns a number into the action it names: its details first, then the public check', () => {
    const groups = paletteGroups({ query: '#642', pages: PAGES, signedIn: true });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe('Action #642');
    expect(groups[0]?.items.map((item) => [item.label, 'href' in item ? item.href : null])).toEqual([
      ['Open #642', '/receipts/642'],
      ['Check #642 on the public page', '/verify/642'],
    ]);
  });

  it('leads a ticker to its holding on the holdings page', () => {
    const spy = flattenGroups(paletteGroups({ query: 'spy', pages: PAGES, signedIn: true }))[0];
    expect(spy).toMatchObject({ kind: 'ticker', href: '/holdings#holding-SPY', tickerId: 0 });
  });

  it('finds nothing for words that match no item, and never a gated feature', () => {
    expect(labels('zzz')).toEqual([]);
    for (const word of ['borrow', 'pay link', 'basket', 'crew']) expect(labels(word)).toEqual([]);
  });
});
