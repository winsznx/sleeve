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

describe('proof fact sections', () => {
  it('lists the receipt itself, how the action ran and what the logs add', () => {
    const sections = sectionsOf(SAMPLE_RECEIPT_IDS.filledSpy);
    expect(sections.map((section) => section.id)).toEqual(['record', 'context', 'logs']);
    expect(sections.map((section) => section.title)).toEqual(['The receipt', 'How it ran', 'From chain logs']);
    expect(field(sections, 'context', 'mode')).toMatchObject({ value: { kind: 'text', text: 'WRAPPED' }, note: WRAPPED_LINE });
    expect(field(sections, 'record', 'disclosureHash').note).toBe('Matches the issuer disclosure below.');
    expect(field(sections, 'record', 'id').value).toEqual({ kind: 'machine', value: '455', copyLabel: 'Copy receipt id' });
  });

  it('points machine values at the block explorer by path', () => {
    const sections = sectionsOf(SAMPLE_RECEIPT_IDS.filledSpy);
    const record = records.get(SAMPLE_RECEIPT_IDS.filledSpy);
    expect(field(sections, 'logs', 'txHash').value).toMatchObject({ explorer: `/tx/${record?.derived.txHash}` });
    expect(field(sections, 'record', 'account').value).toMatchObject({ explorer: `/address/${record?.receipt.account}` });
    expect(field(sections, 'record', 'receiptHash').value).not.toHaveProperty('explorer', expect.any(String));
  });

  it('marks the fields read from logs or the rule history as derived and nothing stored in the receipt', () => {
    const sections = sectionsOf(SAMPLE_RECEIPT_IDS.filledSpy);
    const derived = sections.flatMap((section) => section.fields.filter((item) => item.derived).map((item) => item.id));
    expect(derived).toEqual(['rule', 'txHash', 'inbound']);
  });

  it('says why a queued receipt never read the price feed', () => {
    const sections = sectionsOf(SAMPLE_RECEIPT_IDS.queuedSession);
    expect(field(sections, 'context', 'feed').note).toContain('the market session check');
    expect(field(sections, 'context', 'reason').value).toEqual({ kind: 'text', text: 'Market closed' });
  });

  it('names who started a public split', () => {
    const sections = sectionsOf(SAMPLE_RECEIPT_IDS.refusedTicker);
    expect(field(sections, 'context', 'trigger').value).toEqual({ kind: 'text', text: 'Anyone, after the one hour grace period' });
  });

  it('keeps the same sections for a correction, whose cuts the hero shows', () => {
    expect(sectionsOf(SAMPLE_RECEIPT_IDS.reconciled).map((section) => section.id)).toEqual(['record', 'context', 'logs']);
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
