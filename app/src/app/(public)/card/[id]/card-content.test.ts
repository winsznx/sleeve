import { describe, expect, it } from 'vitest';

import { createMockDataLayer, SAMPLE_CARD_IDS, SAMPLE_RECEIPT_IDS, SAMPLE_WEEK_START } from '@/data/mock';
import type { CardData, ReceiptCard, WeekCard } from '@/data/types';
import { DEBT_SECURITY_LINE, DISCLAIMER } from '@/lib/copy';

import { cardAltText, cardContent, cardFileName, joinWords } from './card-content';

async function sampleCard(cardId: string): Promise<CardData> {
  const card = await createMockDataLayer().getCard(cardId);
  if (card === null) throw new Error(`no sample card ${cardId}`);
  return card;
}

const receiptCard = (overrides: Partial<ReceiptCard>): ReceiptCard => ({
  kind: 'receipt',
  cardId: 'test',
  tickerId: 0,
  status: 'FILLED',
  equityBps: 1_000,
  timestamp: 1_790_084_402n,
  amounts: null,
  proof: null,
  ...overrides,
});

const weekCard = (overrides: Partial<WeekCard>): WeekCard => ({
  kind: 'week',
  cardId: 'test',
  weekStart: SAMPLE_WEEK_START,
  weekEnd: SAMPLE_WEEK_START + 604_800n,
  paydays: 4,
  tickerIds: [0],
  equityBps: 1_000,
  amounts: null,
  proof: null,
  ...overrides,
});

describe('card content', () => {
  it('shows by default only the ticker, the share of pay, the day and the debt security line', async () => {
    const content = cardContent(await sampleCard(SAMPLE_CARD_IDS.receipt), 'sleeve.example');
    expect(content).toMatchObject({
      kind: 'receipt',
      dateLine: '22 Sep 2026',
      figure: '10%',
      headline: 'of my pay became SPY',
      spendLabel: '90% stayed spendable',
      equityLabel: '10% became SPY',
      amounts: null,
      proof: null,
      debtLine: DEBT_SECURITY_LINE,
      disclaimer: DISCLAIMER,
    });
    expect(cardAltText(content)).not.toMatch(/USDG|455|0x/);
  });

  it('adds what arrived and what it bought only when the owner showed amounts', () => {
    const filled = cardContent(receiptCard({ amounts: { usdgIn: 1_200_000_000n, usdgSpent: 120_000_000n, tokensOut: 155_872_191_000_000_000n } }), null);
    expect(filled.amounts).toBe('1,200.00 USDG arrived. 120.00 USDG of it became 0.155872 SPY.');
    const settled = cardContent(
      receiptCard({ status: 'SETTLED', amounts: { usdgIn: 75_000_000n, usdgSpent: 75_000_000n, tokensOut: 97_402_000_000_000_000n } }),
      null,
    );
    expect(settled.amounts).toBe('75.00 USDG waited as USDG, then became 0.097402 SPY.');
  });

  it('names the receipt, the account and where to recompute it once proof is on', async () => {
    const record = await createMockDataLayer().getReceipt(SAMPLE_RECEIPT_IDS.filledSpy);
    const account = record?.receipt.account ?? '0x0000000000000000000000000000000000000000';
    const content = cardContent(receiptCard({ proof: { receiptIds: [455n], account } }), 'sleeve.example');
    expect(content.proof).toMatchObject({
      receipts: 'Receipt 455',
      account: 'Account 0x3efE…9b36',
      verify: 'Recompute it at sleeve.example/verify/455',
    });
  });

  it('counts the paydays of a week and what it bought', async () => {
    const content = cardContent(await sampleCard(SAMPLE_CARD_IDS.week), 'sleeve.example');
    expect(content).toMatchObject({
      kind: 'week',
      dateLine: 'Week of 21 Sep 2026',
      headline: 'of my pay goes to Stock Tokens',
      facts: ['4 paydays split this week', 'Bought SPY'],
    });
    expect(content.proof?.receipts).toBe('Receipts 455, 560, 611 and 642');
    expect(content.proof?.verify).toBe('Recompute any of them at sleeve.example/verify');
  });

  it('says so when a week bought nothing, and shortens a long list of receipts', () => {
    const ids = [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n];
    const content = cardContent(
      weekCard({ paydays: 1, tickerIds: [], proof: { receiptIds: ids, account: '0x3efEf72Ee9aF42fd90f193A1A64aC25384179b36' } }),
      null,
    );
    expect(content.facts).toEqual(['1 payday split this week', 'Nothing bought this week']);
    expect(content.proof?.receipts).toBe('Receipts 1, 2, 3, 4, 5, 6 and 2 more');
    expect(content.proof?.verify).toBe('Recompute any of them with the Sleeve verifier.');
  });

  it('writes week amounts as what arrived and what bought Stock Tokens', () => {
    const content = cardContent(weekCard({ amounts: { usdgIn: 3_412_250_000n, usdgBought: 213_450_000n } }), null);
    expect(content.amounts).toBe('3,412.25 USDG arrived this week. 213.45 USDG bought Stock Tokens.');
  });

  it('keeps a share of pay with basis points exact', () => {
    expect(cardContent(receiptCard({ equityBps: 1_250 }), null)).toMatchObject({ figure: '12.5%', spendLabel: '87.5% stayed spendable' });
  });
});

describe('card helpers', () => {
  it('joins tickers as words', () => {
    expect([joinWords([]), joinWords(['SPY']), joinWords(['SPY', 'QQQ']), joinWords(['SPY', 'QQQ', 'NVDA'])]).toEqual([
      '',
      'SPY',
      'SPY and QQQ',
      'SPY, QQQ and NVDA',
    ]);
  });

  it('reads the whole card in the alt text, in order', () => {
    const content = cardContent(weekCard({}), null);
    expect(cardAltText(content)).toBe(
      'Sleeve card, Week of 21 Sep 2026. 10% of my pay goes to Stock Tokens. debt security, not a share. 4 paydays split this week. Bought SPY. 90% stays spendable, 10% for Stock Tokens.',
    );
    expect(cardFileName(content)).toBe('sleeve-week-card.png');
  });
});
