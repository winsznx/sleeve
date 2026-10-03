import { RECEIPT_FIELDS } from '@sleeve/core';
import { beforeAll, describe, expect, it } from 'vitest';

import { createMockDataLayer, SAMPLE_RECEIPT_IDS } from '@/data/mock';
import type { ReceiptRecord } from '@/data/types';

import {
  WRAPPED_LINE,
  calendarWords,
  premiumWords,
  rawReceiptFields,
  receiptSections,
  roundWords,
  type ReceiptField,
  type ReceiptSection,
} from './receipt-sections';

const records = new Map<bigint, ReceiptRecord>();

beforeAll(async () => {
  const layer = createMockDataLayer();
  for (const id of Object.values(SAMPLE_RECEIPT_IDS)) {
    const record = await layer.getReceipt(id);
    if (record !== null) records.set(id, record);
  }
});

function sectionsOf(id: bigint): ReceiptSection[] {
  const record = records.get(id);
  if (record === undefined) throw new Error(`no sample receipt ${id}`);
  return receiptSections(record);
}

function field(sections: ReceiptSection[], sectionId: string, fieldId: string): ReceiptField {
  const found = sections.find((section) => section.id === sectionId)?.fields.find((item) => item.id === fieldId);
  if (found === undefined) throw new Error(`no field ${sectionId}.${fieldId}`);
  return found;
}

describe('receipt sections', () => {
  it('lays out a fill: the split, the fill, the market reference apart from the pool, then the record', () => {
    const sections = sectionsOf(SAMPLE_RECEIPT_IDS.filledSpy);
    expect(sections.map((section) => section.id)).toEqual(['split', 'fill', 'reference', 'venue', 'context', 'record', 'logs']);
    expect(field(sections, 'fill', 'tokensOut').value).toMatchObject({ kind: 'amount', unit: 'SPY', tone: 'equity', debtLine: true });
    expect(field(sections, 'fill', 'execPrice').value).toMatchObject({ unit: 'USDG per SPY' });
    expect(field(sections, 'reference', 'roundId').note).toMatch(/^Phase 1, round \d+ of that phase\.$/);
    expect(field(sections, 'context', 'mode')).toMatchObject({ value: { kind: 'text', text: 'WRAPPED' }, note: WRAPPED_LINE });
    expect(field(sections, 'record', 'disclosureHash').note).toBe('Matches the issuer disclosure below.');
  });

  it('keeps every digit of the split', () => {
    const sections = sectionsOf(SAMPLE_RECEIPT_IDS.filledSpySecond);
    expect(field(sections, 'split', 'usdgIn').value).toMatchObject({ value: '937.25', unit: 'USDG' });
    expect(field(sections, 'split', 'usdgSpent').value).toMatchObject({ value: '93.725', tone: 'equity' });
    expect(field(sections, 'split', 'usdgToSpend').value).toMatchObject({ value: '843.525', tone: 'spend' });
  });

  it('marks the fields read from logs as derived and nothing stored in the receipt', () => {
    const sections = sectionsOf(SAMPLE_RECEIPT_IDS.filledSpy);
    const derived = sections.flatMap((section) => section.fields.filter((item) => item.derived).map((item) => item.id));
    expect(derived).toEqual(['rule', 'txHash', 'inbound']);
  });

  it('says why a queued receipt never read the price feed', () => {
    const sections = sectionsOf(SAMPLE_RECEIPT_IDS.queuedSession);
    expect(sections.map((section) => section.id)).toEqual(['split', 'venue', 'context', 'record', 'logs']);
    expect(field(sections, 'split', 'usdgQueued').note).toBe('Waits as USDG in the account because the market was closed.');
    expect(field(sections, 'context', 'feed').note).toContain('the market session check');
    expect(field(sections, 'venue', 'venueId').value).toEqual({ kind: 'text', text: 'None. No swap ran.' });
  });

  it('names the unlisted pool on a refused ticker', () => {
    const sections = sectionsOf(SAMPLE_RECEIPT_IDS.refusedTicker);
    expect(field(sections, 'venue', 'pool').note).toBe('Not on the SPY pool allowlist.');
    expect(field(sections, 'split', 'usdgToSpend').note).toContain('could not buy');
    expect(field(sections, 'context', 'trigger').value).toEqual({ kind: 'text', text: 'Anyone, after the one hour grace period' });
  });

  it('shows a sale per lot with the debt security line and the price below the reference', () => {
    const sections = sectionsOf(SAMPLE_RECEIPT_IDS.sold);
    expect(sections.map((section) => section.id)).toEqual(['sale', 'fill', 'reference', 'venue', 'context', 'record', 'logs']);
    expect(field(sections, 'sale', 'tokensIn').value).toMatchObject({ unit: 'QQQ', debtLine: true });
    expect(field(sections, 'sale', 'lotId').value).toEqual({ kind: 'link', text: 'Lot 212', href: '/receipts/212' });
    expect(field(sections, 'fill', 'premiumBps').value).toMatchObject({ kind: 'text', text: expect.stringContaining('below the market reference') });
  });

  it('shows a reconcile as derived ledger cuts', () => {
    const sections = sectionsOf(SAMPLE_RECEIPT_IDS.reconciled);
    expect(sections.map((section) => section.id)).toEqual(['correction', 'context', 'record', 'logs']);
    const correction = sections[0];
    expect(correction?.fields.every((item) => item.derived)).toBe(true);
    expect(field(sections, 'correction', 'shortfall').value).toMatchObject({ value: '15.00' });
    expect(field(sections, 'correction', 'fromSpend').value).toMatchObject({ value: '15.00' });
  });
});

describe('field words', () => {
  it('reads a Chainlink round id as phase and round', () => {
    expect(roundWords(18_446_744_073_709_551_762n)).toBe('Phase 1, round 146 of that phase.');
  });

  it('reads the calendar version as library and timelocked changes', () => {
    expect([calendarWords(1 << 16), calendarWords((1 << 16) | 1)]).toEqual([
      'Calendar 1, with 0 timelocked changes.',
      'Calendar 1, with 1 timelocked change.',
    ]);
  });

  it('puts the premium in words without dropping its sign', () => {
    expect([premiumWords(4n), premiumWords(1n), premiumWords(-9n), premiumWords(0n)]).toEqual([
      '4 basis points above the market reference',
      '1 basis point above the market reference',
      '9 basis points below the market reference',
      'At the market reference',
    ]);
  });
});

describe('raw receipt fields', () => {
  it('lists all fields in SPEC order with enum indexes for encoding', () => {
    const record = records.get(SAMPLE_RECEIPT_IDS.filledSpy);
    if (record === undefined) throw new Error('no sample receipt');
    const raw = rawReceiptFields(record.receipt);
    expect(raw.map((item) => item.name)).toEqual(Object.keys(RECEIPT_FIELDS));
    expect(raw.find((item) => item.name === 'status')).toEqual({ name: 'status', type: 'Status', value: 'FILLED (0)' });
    expect(raw.find((item) => item.name === 'trigger')?.value).toBe('KEEPER (0)');
    expect(raw.find((item) => item.name === 'usdgIn')?.value).toBe('1200000000');
  });
});
