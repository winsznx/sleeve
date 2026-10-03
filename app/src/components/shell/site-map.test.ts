import { describe, expect, it } from 'vitest';

import { PRIMARY_NAV, SECONDARY_NAV, SECTION_ALIASES } from '@/components/sleeve/navigation';

import { avatarCells } from './account-avatar';
import { currentSection, isCurrentPath } from './sections';
import { footerColumns, LANDING_ANCHORS, PRODUCT_LINKS, proofLinks, sourceLink, sourceUrl } from './site-map';

const ALL_NAV = [...PRIMARY_NAV, ...SECONDARY_NAV];

describe('the app navigation (D-024)', () => {
  it('puts the payday places first and proof behind them', () => {
    expect(PRIMARY_NAV.map((item) => [item.label, item.href])).toEqual([
      ['Home', '/home'],
      ['Payments', '/payments'],
      ['Holdings', '/holdings'],
      ['Rule', '/rule'],
    ]);
    expect(SECONDARY_NAV.map((item) => [item.label, item.href])).toEqual([
      ['History', '/history'],
      ['Check a split', '/verify'],
    ]);
  });

  it('matches a section and the pages under it, never a sibling that shares a prefix', () => {
    expect(isCurrentPath('/history', '/history')).toBe(true);
    expect(isCurrentPath('/history/455', '/history')).toBe(true);
    expect(isCurrentPath('/historyx', '/history')).toBe(false);
  });

  it('files the old addresses and the detail pages under the places they belong to', () => {
    // #given the receipts, inbox and sell paths, which have no place of their own in the navigation
    // #then each lights the place it now lives under, with a crumb for the page; an action reads by its number
    expect(currentSection('/receipts/455', ALL_NAV, SECTION_ALIASES)).toMatchObject({ item: { href: '/history' }, trail: '#455' });
    expect(currentSection('/receipts', ALL_NAV, SECTION_ALIASES)).toMatchObject({ item: { href: '/history' }, trail: 'Details' });
    expect(currentSection('/inbox', ALL_NAV, SECTION_ALIASES)).toMatchObject({ item: { href: '/payments' }, trail: null });
    expect(currentSection('/sell', ALL_NAV, SECTION_ALIASES)).toMatchObject({ item: { href: '/holdings' }, trail: 'Sell back' });
    expect(currentSection('/payments', ALL_NAV, SECTION_ALIASES)).toMatchObject({ item: { label: 'Payments' }, trail: null });
    expect(currentSection('/onboard', ALL_NAV, SECTION_ALIASES)).toBeNull();
  });
});

describe('the marketing site map', () => {
  it('leads the Product menu with the payday split and links into the landing', () => {
    expect(PRODUCT_LINKS.map((link) => link.title)).toEqual([
      'How a payday splits',
      'The two sleeves',
      'Your rule',
      'Holdings and sell-back',
    ]);
    expect(PRODUCT_LINKS.map((link) => link.href)).toEqual([
      `/#${LANDING_ANCHORS.how}`,
      `/#${LANDING_ANCHORS.sleeves}`,
      `/#${LANDING_ANCHORS.rule}`,
      `/#${LANDING_ANCHORS.holdings}`,
    ]);
  });

  it('links the proof documents to the source once it is public, and to the proof section until then', () => {
    expect(sourceUrl(undefined)).toBeNull();
    expect(sourceUrl('http://example.com/repo')).toBeNull();
    expect(sourceUrl(' https://github.com/owner/sleeve/ ')).toBe('https://github.com/owner/sleeve');
    expect(sourceLink('docs/GATES.md', null)).toBe('/#proof');
    expect(proofLinks('https://github.com/owner/sleeve').map((link) => link.href)).toEqual([
      '/verify',
      'https://github.com/owner/sleeve/blob/main/docs/HP2_RESULTS.md',
      'https://github.com/owner/sleeve/blob/main/docs/audit/AUDIT_R1.md',
      'https://github.com/owner/sleeve/blob/main/docs/GATES.md',
    ]);
  });

  it('gives the footer Product, Proof and Legal columns, with the issuer disclosure under Legal', () => {
    const columns = footerColumns(null);
    expect(columns.map((column) => column.heading)).toEqual(['Product', 'Proof', 'Legal']);
    expect(columns[2]?.links[0]).toEqual({ href: '/disclosure/rhj-disclosure.txt', label: 'Issuer disclosure' });
  });

  it('never names a gated feature anywhere a visitor can navigate', () => {
    const words = [
      ...ALL_NAV.flatMap((item) => [item.label, item.description ?? '', ...(item.keywords ?? [])]),
      ...PRODUCT_LINKS.flatMap((link) => [link.title, link.description]),
      ...proofLinks(null).flatMap((link) => [link.title, link.description]),
      ...footerColumns(null).flatMap((column) => column.links.map((link) => link.label)),
    ].join(' ');
    expect(words).not.toMatch(/borrow|pay link|basket|crew/i);
  });
});

describe('the account avatar', () => {
  it('draws a mirrored pattern from the address, the same every time', () => {
    const cells = avatarCells('0x3efEf72Ee9aF42fd90f193A1A64aC25384179b36');
    expect(cells).toEqual(avatarCells('0x3efEf72Ee9aF42fd90f193A1A64aC25384179b36'));
    for (const cell of cells) expect(cells).toContainEqual({ x: 4 - cell.x, y: cell.y });
  });

  it('never draws an empty tile', () => {
    expect(avatarCells('0x0000000000000000000000000000000000000000')).toEqual([{ x: 2, y: 2 }]);
  });
});
