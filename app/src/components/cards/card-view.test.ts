import { describe, expect, it } from 'vitest';

import { createMockDataLayer, SAMPLE_CARD_IDS, SAMPLE_RECEIPT_IDS, SAMPLE_WEEK_START } from '@/data/mock';
import type { CardData, CreateCardInput, ReceiptCard, WeekCard } from '@/data/types';
import { DEBT_SECURITY_LINE, DISCLAIMER, SAMPLE_DATA_LINE } from '@/lib/copy';

import {
  cardAltText,
  cardFacts,
  cardFileName,
  cardFingerprint,
  cardHolds,
  cardSummary,
  cardView,
  joinWords,
  type CardViewOptions,
} from './card-view';

const ORIGIN = 'https://sleeve.test';
const SHOW_ALL: CardViewOptions = { amounts: true, proof: true, origin: ORIGIN, sample: false };
const ACCOUNT = '0x3efEf72Ee9aF42fd90f193A1A64aC25384179b36';

async function makeCard(input: CreateCardInput): Promise<CardData> {
  return createMockDataLayer().createCard(input);
}

async function paydayCard(receiptId: bigint, showAmounts = false, showProof = false): Promise<ReceiptCard> {
  const card = await makeCard({ subject: { kind: 'receipt', receiptId }, showAmounts, showProof });
  if (card.kind !== 'receipt') throw new Error('expected a payday card');
  return card;
}

async function weekCard(weekStart: bigint, showAmounts = false, showProof = false): Promise<WeekCard> {
  const card = await makeCard({ subject: { kind: 'week', weekStart }, showAmounts, showProof });
  if (card.kind !== 'week') throw new Error('expected a week card');
  return card;
}

function quietWeek(overrides: Partial<WeekCard>): WeekCard {
  return {
    kind: 'week',
    cardId: 'w',
    weekStart: SAMPLE_WEEK_START,
    weekEnd: SAMPLE_WEEK_START + 604_800n,
    paydays: 1,
    tickerIds: [],
    equityBps: 1_000,
    amounts: null,
    proof: null,
    ...overrides,
  };
}

describe('payday card', () => {
  it('says what the payday became, with the ticker, the split and the debt security line', async () => {
    // #given a buy of SPY under the 10 percent rule
    const card = await paydayCard(SAMPLE_RECEIPT_IDS.filledSpy);

    // #when the card is worked out
    const view = cardView(card, SHOW_ALL);

    // #then it leads with the share of pay and the Stock Token it became
    if (view.kind !== 'payday') throw new Error('expected a payday view');
    expect(view).toMatchObject({
      figure: '10%',
      lead: 'of this payday became',
      token: { key: 'SPY', symbol: 'SPY', shape: 'tile', logo: 'SPY' },
      debtLine: DEBT_SECURITY_LINE,
      rail: { spendBps: 9_000, equityBps: 1_000, waited: false },
      dateLine: '22 Sep 2026',
    });
    expect(view.legend.map((item) => `${item.share} ${item.label}`)).toEqual(['90% stayed spendable', '10% became SPY']);
  });

  it('keeps amounts, the receipt and the account off a card made without them', async () => {
    // #given a card made with the defaults
    const card = await paydayCard(SAMPLE_RECEIPT_IDS.filledSpy);

    // #when it is drawn with every toggle on
    const view = cardView(card, SHOW_ALL);

    // #then nothing that leads to the account appears
    expect([view.amounts, view.proof, view.disclaimer]).toEqual([null, null, null]);
    expect(cardAltText(view)).not.toMatch(/USDG|Receipt|0x/);
  });

  it('shows the amounts the owner showed, as what arrived, what stayed spendable and what it bought', async () => {
    // #given a card made with amounts
    const card = await paydayCard(SAMPLE_RECEIPT_IDS.filledSpy, true);

    // #when it is drawn
    const view = cardView(card, SHOW_ALL);

    // #then the amounts read number then unit
    if (view.kind !== 'payday') throw new Error('expected a payday view');
    expect(view.amounts).toMatchObject({ arrived: '1,200.00 USDG', spendable: '1,080.00 USDG', spent: '120.00 USDG' });
    expect(view.amounts?.bought).toMatch(/^0\.\d+ SPY$/);
  });

  it('lets a viewer leave amounts and proof off', async () => {
    // #given a card made with amounts and proof
    const card = await paydayCard(SAMPLE_RECEIPT_IDS.filledSpy, true, true);

    // #when the viewer turns both off
    const view = cardView(card, { ...SHOW_ALL, amounts: false, proof: false });

    // #then neither is drawn, nor the disclaimer that came with the proof
    expect([view.amounts, view.proof, view.disclaimer]).toEqual([null, null, null]);
  });

  it('never adds what the owner hid', async () => {
    // #given a card made without amounts or proof
    const card = await paydayCard(SAMPLE_RECEIPT_IDS.filledSpy);

    // #when the toggles ask for both
    const view = cardView(card, SHOW_ALL);

    // #then the card still holds neither
    expect(cardHolds(card)).toEqual({ amounts: false, proof: false });
    expect(view.amounts).toBeNull();
  });

  it('adds the receipt, the account, the network and the disclaimer with proof', async () => {
    // #given a card made with proof
    const card = await paydayCard(SAMPLE_RECEIPT_IDS.filledSpy, false, true);

    // #when it is drawn
    const view = cardView(card, SHOW_ALL);

    // #then the proof points the check at the receipt
    expect(view.proof).toMatchObject({
      receipts: 'Receipt 455',
      account: '0x3efE…9b36',
      network: 'Robinhood Chain, chain id 4663',
      verifyLabel: 'sleeve.test/verify/455',
      verifyUrl: 'https://sleeve.test/verify/455',
    });
    expect(view.disclaimer).toBe(DISCLAIMER);
  });

  it('tells a payday that waited for the market apart, with stripes before the buy', async () => {
    // #given a buy that waited for the Sunday reopen
    const card = await paydayCard(SAMPLE_RECEIPT_IDS.settled, true);

    // #when it is drawn
    const view = cardView(card, SHOW_ALL);

    // #then it says it waited, and prints only the amounts the receipt records
    if (view.kind !== 'payday') throw new Error('expected a payday view');
    expect(view.lead).toBe('of this payday waited, then became');
    expect(view.rail.waited).toBe(true);
    expect(view.legend[1]?.label).toBe('waited, then became SPY');
    expect(view.amounts).toMatchObject({ arrived: null, spendable: null, spent: '65.00 USDG' });
  });

  it('prints the card address and the sample line only when it knows them', async () => {
    // #given the sample payday card
    const card = await createMockDataLayer().getCard(SAMPLE_CARD_IDS.receipt);
    if (card === null) throw new Error('missing sample card');

    // #then the address needs an origin and an id, and the sample line needs the mock
    expect(cardView(card, SHOW_ALL).link).toBe('sleeve.test/card/r8KQm2xV4nPz');
    expect(cardView(card, { ...SHOW_ALL, origin: null }).link).toBeNull();
    expect(cardView({ ...card, cardId: '' }, SHOW_ALL).link).toBeNull();
    expect(cardView(card, { ...SHOW_ALL, sample: true }).sampleLine).toBe(SAMPLE_DATA_LINE);
  });
});

describe('week card', () => {
  it('counts the paydays the rule split and names the Stock Tokens they bought', async () => {
    // #given the sample week
    const card = await weekCard(SAMPLE_WEEK_START);

    // #when it is drawn
    const view = cardView(card, SHOW_ALL);

    // #then it leads with the count and names SPY with the debt security line
    if (view.kind !== 'week') throw new Error('expected a week view');
    expect(view).toMatchObject({
      figure: '4',
      lead: 'paydays split this week',
      dateLine: 'Week of 21 Sep 2026',
      debtLine: DEBT_SECURITY_LINE,
    });
    expect(view.tokens.map((token) => token.symbol)).toEqual(['SPY']);
    expect(cardSummary(view)).toBe(`4 paydays split this week. Bought SPY, ${DEBT_SECURITY_LINE}.`);
  });

  it('lists every receipt of the week with proof and points the check at the verifier', async () => {
    // #given the sample week made with amounts and proof
    const card = await weekCard(SAMPLE_WEEK_START, true, true);

    // #when it is drawn
    const view = cardView(card, SHOW_ALL);

    // #then every receipt is named and the check opens the verifier
    expect(view.proof).toMatchObject({ receipts: 'Receipts 455, 560, 611 and 642', verifyUrl: 'https://sleeve.test/verify' });
    expect(view.amounts).not.toBeNull();
  });

  it('says so when a week bought nothing, without the debt security line', () => {
    // #given a week with one payday and no buy
    const card = quietWeek({ paydays: 1 });

    // #when it is drawn
    const view = cardView(card, SHOW_ALL);

    // #then it says nothing was bought and drops the lines about Stock Tokens
    if (view.kind !== 'week') throw new Error('expected a week view');
    expect(view).toMatchObject({ lead: 'payday split this week', boughtLine: 'Nothing bought this week', debtLine: null, stamp: null });
  });

  it('shortens a long receipt list', () => {
    // #given a week with seven receipts and proof
    const card = quietWeek({ paydays: 7, tickerIds: [0], proof: { receiptIds: [1n, 2n, 3n, 4n, 5n, 6n, 7n], account: ACCOUNT } });

    // #then five are named and the rest counted
    expect(cardView(card, SHOW_ALL).proof?.receipts).toBe('Receipts 1, 2, 3, 4, 5 and 2 more');
  });
});

describe('the card in words', () => {
  it('says when the owner hid a part', async () => {
    // #given a card made without amounts or proof
    const card = await paydayCard(SAMPLE_RECEIPT_IDS.filledSpy);

    // #when its facts are listed
    const facts = cardFacts(cardView(card, SHOW_ALL), cardHolds(card));

    // #then both are hidden by the owner
    expect(facts.find((fact) => fact.id === 'amounts')?.value).toBe('Hidden by the owner');
    expect(facts.find((fact) => fact.id === 'proof')?.value).toMatch(/^Hidden by the owner\. Nothing on this card leads/);
  });

  it('says when the viewer left a part off', async () => {
    // #given a card made with amounts and proof
    const card = await paydayCard(SAMPLE_RECEIPT_IDS.filledSpy, true, true);

    // #when the viewer leaves both off
    const facts = cardFacts(cardView(card, { ...SHOW_ALL, amounts: false, proof: false }), cardHolds(card));

    // #then the words say so
    expect(facts.filter((fact) => fact.value === 'Left off this image').map((fact) => fact.id)).toEqual(['amounts', 'proof']);
  });

  it('reads the whole image as one text alternative', async () => {
    // #given a sample card with amounts and proof
    const view = cardView(await paydayCard(SAMPLE_RECEIPT_IDS.filledSpy, true, true), { ...SHOW_ALL, sample: true });

    // #when the alt text is written
    const alt = cardAltText(view);

    // #then it carries the statement, the debt security line, the amounts, the proof and the sample line
    for (const part of [
      'Sleeve payday card, 22 Sep 2026.',
      '10% of this payday became SPY.',
      `${DEBT_SECURITY_LINE}.`,
      '1,200.00 USDG arrived.',
      'Receipt 455.',
    ]) {
      expect(alt).toContain(part);
    }
    expect(alt.endsWith(SAMPLE_DATA_LINE)).toBe(true);
  });
});

describe('helpers', () => {
  it('joins words the way the copy reads', () => {
    expect([joinWords([]), joinWords(['SPY']), joinWords(['SPY', 'QQQ']), joinWords(['SPY', 'QQQ', 'NVDA'])]).toEqual([
      '',
      'SPY',
      'SPY and QQQ',
      'SPY, QQQ and NVDA',
    ]);
  });

  it('names a downloaded file by kind, id and size, keeping only safe characters', () => {
    expect([
      cardFileName('payday', 'r8KQm2xV4nPz', 'post'),
      cardFileName('week', '', 'wide'),
      cardFileName('payday', '../x"y', 'post'),
    ]).toEqual(['sleeve-payday-card-r8KQm2xV4nPz-post.png', 'sleeve-week-card-sample-wide.png', 'sleeve-payday-card-xy-post.png']);
  });

  it('fingerprints what a card says, not its id', async () => {
    // #given one card, the same card under another id, and a card that shows more
    const card = await paydayCard(SAMPLE_RECEIPT_IDS.filledSpy);
    const withAmounts = await paydayCard(SAMPLE_RECEIPT_IDS.filledSpy, true);

    // #then the id does not change the fingerprint, and the content does
    expect(cardFingerprint(card)).toMatch(/^[0-9a-f]{8}$/);
    expect(cardFingerprint({ ...card, cardId: 'another' })).toBe(cardFingerprint(card));
    expect(cardFingerprint(withAmounts)).not.toBe(cardFingerprint(card));
  });
});
