import { beforeAll, describe, expect, it } from 'vitest';

import { createMockDataLayer, SAMPLE_RECEIPT_IDS } from '@/data/mock';
import type { ReceiptRecord } from '@/data/types';

import { lintText } from '../../../../../../scripts/copy-lint.mjs';

import { actionNoun, correctionModel, moveModel, percentOf, priceModel, routeModel, sessionModel, splitModel } from './receipt-panels';

const records = new Map<bigint, ReceiptRecord>();

beforeAll(async () => {
  const layer = createMockDataLayer();
  for (const id of Object.values(SAMPLE_RECEIPT_IDS)) {
    const record = await layer.getReceipt(id);
    if (record !== null) records.set(id, record);
  }
});

function sample(id: bigint): ReceiptRecord {
  const record = records.get(id);
  if (record === undefined) throw new Error(`no sample receipt ${id}`);
  return record;
}

describe('where the money went', () => {
  it('splits a payday into what stayed spendable and what became the Stock Token, with each part of the payday', () => {
    const record = sample(SAMPLE_RECEIPT_IDS.filledSpy);
    const split = splitModel(record);
    expect(split?.parts).toEqual({ spend: record.receipt.usdgToSpend, equity: record.receipt.usdgSpent, waiting: 0n });
    expect(split?.legs.map((leg) => [leg.kind, leg.percent])).toEqual([
      ['spend', '90 percent'],
      ['equity', '10 percent'],
    ]);
    expect(split?.legs[1]).toMatchObject({ kind: 'equity', tokens: record.receipt.tokensOut, symbol: 'SPY', token: 'SPY', lotId: 455n });
    expect(split?.premium).toBe('Bought 0.04 percent above the market reference.');
  });

  it('keeps a waiting equity share as USDG with its reason, and counts refused equity as spendable', () => {
    const queued = splitModel(sample(SAMPLE_RECEIPT_IDS.queuedSession));
    expect(queued?.legs.map((leg) => leg.kind)).toEqual(['spend', 'waiting']);
    expect(queued?.legs[1]).toMatchObject({ reason: 'SESSION', amount: 75_000_000n });
    expect(queued?.legs[1]?.kind === 'waiting' ? queued.legs[1].sentence : '').toContain('because the market was closed');
    const refused = splitModel(sample(SAMPLE_RECEIPT_IDS.refusedTicker));
    expect(refused?.parts).toEqual({ spend: 500_000_000n, equity: 0n, waiting: 0n });
    expect(refused?.legs[1]).toMatchObject({ kind: 'refused', amount: 50_000_000n });
    expect(refused?.legs[1]?.kind === 'refused' ? refused.legs[1].sentence : '').toContain('not on the SPY allowlist');
  });

  it('draws a buy after a wait, a release and a sale as one move each', () => {
    expect(splitModel(sample(SAMPLE_RECEIPT_IDS.sold))).toBeNull();
    const sale = moveModel(sample(SAMPLE_RECEIPT_IDS.sold));
    expect(sale).toMatchObject({
      heading: 'The sale',
      from: { label: 'Sold from lot 212', token: 'QQQ', amount: '0.108026', debtSecurity: true },
      to: { label: 'Went to spend', token: 'USDG', amount: '80.006416', debtSecurity: false },
      premium: 'Sold 0.09 percent below the market reference.',
    });
    expect(moveModel(sample(SAMPLE_RECEIPT_IDS.settled))).toMatchObject({ heading: 'The buy', from: { label: 'Waited as USDG' }, to: { label: 'Became SPY' } });
    expect(moveModel(sample(SAMPLE_RECEIPT_IDS.released))).toMatchObject({ heading: 'The release', premium: null, to: { label: 'Moved to spend' } });
    expect(moveModel(sample(SAMPLE_RECEIPT_IDS.filledSpy))).toBeNull();
  });

  it('lists the cuts a correction made, spend first', () => {
    expect(correctionModel(sample(SAMPLE_RECEIPT_IDS.reconciled))).toMatchObject({
      shortfall: 15_000_000n,
      cuts: [{ id: 'spend', label: 'Taken from spend', amount: 15_000_000n, kind: 'spend' }],
      lot: null,
      sentence:
        'USDG left the account outside Sleeve, for example through an old approval. To match the balance, Sleeve lowered spend by 15.00 USDG.',
    });
    expect(correctionModel(sample(SAMPLE_RECEIPT_IDS.filledSpy))).toBeNull();
  });

  it('rounds a part of a payday to a hundredth of a percent and names each kind of action', () => {
    expect([percentOf(1n, 3n), percentOf(2n, 3n), percentOf(0n, 0n)]).toEqual(['33.33 percent', '66.67 percent', '0 percent']);
    expect(['filledSpy', 'settled', 'released', 'sold', 'reconciled'].map((name) => actionNoun(sample(SAMPLE_RECEIPT_IDS[name as keyof typeof SAMPLE_RECEIPT_IDS]).receipt))).toEqual([
      'split',
      'buy',
      'release',
      'sale',
      'correction',
    ]);
  });
});

describe('the price', () => {
  it('keeps the pool fill and the Chainlink reference apart, each with its own time', () => {
    const record = sample(SAMPLE_RECEIPT_IDS.filledSpy);
    const model = priceModel(record);
    expect(model).not.toBeNull();
    expect(model?.fill).toMatchObject({ side: 'buy', execPrice: '769.859026', premiumBps: 4n, words: '4 basis points above the market reference' });
    expect(model?.reference).toBe('769.55120477');
    expect(model?.fill?.filledAt).toBe(record.receipt.timestamp);
    expect(model?.referenceAt).toBe(record.receipt.updatedAt);
    expect(model?.fill?.referenceAge).toBe(record.receipt.timestamp - record.receipt.updatedAt);
    expect(model?.round).toMatch(/^Phase 1, round \d+ of that phase\.$/);
  });

  it("checks a buy against the rule's cap, read from the rule history and marked derived", () => {
    expect(priceModel(sample(SAMPLE_RECEIPT_IDS.filledSpy))?.fill?.cap).toEqual({ bps: 100, source: 'rule', derived: true, within: true });
  });

  it('reads a sale below the reference as a discount inside the cap', () => {
    const fill = priceModel(sample(SAMPLE_RECEIPT_IDS.sold))?.fill;
    expect(fill).toMatchObject({ side: 'sell', premiumBps: -9n, sentence: 'Sold 0.09 percent below the market reference.' });
    expect(fill?.cap?.within).toBe(true);
  });

  it('shows the reference alone when the guard read it but no swap ran', () => {
    const model = priceModel(sample(SAMPLE_RECEIPT_IDS.queuedClip));
    expect(model?.fill).toBeNull();
    expect(model?.multiplier).not.toBeNull();
  });

  it('has no price at all when the guard stopped before the feed', () => {
    expect(priceModel(sample(SAMPLE_RECEIPT_IDS.queuedSession))).toBeNull();
    expect(priceModel(sample(SAMPLE_RECEIPT_IDS.refusedTicker))).toBeNull();
  });
});

describe('the route', () => {
  it('names the pool, its fee tier and allowlist standing, and what moved each way', () => {
    const route = routeModel(sample(SAMPLE_RECEIPT_IDS.filledSpy));
    expect(route).toMatchObject({
      swapRan: true,
      venue: 'Uniswap v3',
      venuePath: 'through SwapRouter02',
      from: { token: 'USDG', amount: '120.00 USDG' },
      to: { token: 'SPY', amount: '0.155872693654184832 SPY' },
      pool: { allowlisted: true, fee: 500 },
    });
    expect(route?.minOut).toMatch(/ SPY$/);
  });

  it('turns around for a sale', () => {
    const route = routeModel(sample(SAMPLE_RECEIPT_IDS.sold));
    expect(route?.from.token).toBe('QQQ');
    expect(route?.to).toMatchObject({ token: 'USDG', amount: '80.006416 USDG' });
    expect(route?.quote).toMatch(/ USDG per QQQ$/);
  });

  it('shows the planned route when no swap ran, and an unlisted pool as such', () => {
    const queued = routeModel(sample(SAMPLE_RECEIPT_IDS.queuedSession));
    expect(queued).toMatchObject({ swapRan: false, venue: null, quote: null, minOut: null, pool: { allowlisted: true } });
    const refused = routeModel(sample(SAMPLE_RECEIPT_IDS.refusedTicker));
    expect(refused?.pool).toMatchObject({ allowlisted: false, fee: null });
  });

  it('has no route for money that only moved between ledgers', () => {
    expect(routeModel(sample(SAMPLE_RECEIPT_IDS.released))).toBeNull();
    expect(routeModel(sample(SAMPLE_RECEIPT_IDS.reconciled))).toBeNull();
  });
});

describe('the market session', () => {
  it('says what the session check found for each kind of receipt', () => {
    const checks = (
      ['filledSpy', 'settled', 'queuedSession', 'queuedClip', 'refusedTicker', 'refusedAccount', 'released', 'sold', 'reconciled'] as const
    ).map((name) => sessionModel(sample(SAMPLE_RECEIPT_IDS[name]).receipt).check);
    expect(checks).toEqual(['open', 'open', 'closed', 'open', 'not-reached', 'not-reached', 'none', 'open', 'none']);
    expect(sessionModel(sample(SAMPLE_RECEIPT_IDS.queuedClip).receipt).checkText).toBe(
      'Open. The guard passed the session check and stopped later, at the minimum buy.',
    );
  });

  it('prints the block time in New York and how long waiting USDG waited', () => {
    const settled = sessionModel(sample(SAMPLE_RECEIPT_IDS.settled).receipt);
    expect(settled.newYork).toMatch(/New York time$/);
    expect(settled.calendar).toBe('Calendar 1, with 0 timelocked changes.');
    expect(settled.waitingSince).not.toBeNull();
    expect(settled.waited).toBeGreaterThan(0n);
    expect(sessionModel(sample(SAMPLE_RECEIPT_IDS.filledSpy).receipt).waitingSince).toBeNull();
  });
});

describe('copy rules', () => {
  it('every panel sentence passes the copy lint', () => {
    const words = [...records.values()].flatMap((record) => {
      const price = priceModel(record);
      const route = routeModel(record);
      const session = sessionModel(record.receipt);
      const split = splitModel(record);
      const move = moveModel(record);
      return [
        ...(split?.legs.map((leg) => ('sentence' in leg ? leg.sentence : leg.percent)) ?? []),
        move?.from.label ?? '',
        move?.from.note ?? '',
        move?.to.label ?? '',
        move?.to.note ?? '',
        ...(move?.notes ?? []),
        ...(correctionModel(record)?.cuts.map((cut) => cut.label) ?? []),
        price?.fill?.sentence ?? '',
        price?.fill?.words ?? '',
        price?.round ?? '',
        route?.venue ?? '',
        route?.venuePath ?? '',
        session.checkText,
        session.calendar,
      ];
    });
    expect(words.flatMap((text) => lintText(text))).toEqual([]);
  });
});

describe('a settle the guard refused', () => {
  it('draws the waiting bucket moving to spend, with why, never as a payday split', () => {
    const released = sample(SAMPLE_RECEIPT_IDS.released);
    const refused = {
      ...released,
      receipt: { ...released.receipt, status: 'REFUSED_TICKER' as const, usdgIn: 0n, usdgToEquity: released.receipt.usdgToSpend },
    };
    expect(splitModel(refused)).toBeNull();
    const move = moveModel(refused);
    expect(move?.heading).toBe('The refused buy');
    expect(move?.from).toMatchObject({ label: 'Waited to buy QQQ', amount: '10.00', token: 'USDG' });
    expect(move?.to).toMatchObject({ label: 'Moved to spend', amount: '10.00' });
    expect(move?.notes).toEqual(["QQQ is no longer on Sleeve's ticker list, so the waiting USDG went to spend."]);
    expect(actionNoun(refused.receipt)).toBe('refused buy');
    expect(moveModel({ ...released, receipt: { ...released.receipt, usdgIn: 0n } })?.from.amount).toBe('10.00');
  });
});

describe("a lot's correction", () => {
  it('trims Stock Tokens off one lot, moves nothing, and says so in its own numbers', () => {
    const reconciled = sample(SAMPLE_RECEIPT_IDS.reconciled);
    const lotCorrection = {
      ...reconciled,
      receipt: { ...reconciled.receipt, tickerId: 0, lotId: 455n, tokensIn: 50_000_000_000_000_000n, usdgIn: 0n },
      reconciliation: null,
    };
    expect(correctionModel(lotCorrection)).toEqual({
      sentence:
        'SPY left the account outside Sleeve, for example in a transfer signed elsewhere. To match the balance, Sleeve trimmed lot 455 by 0.05 SPY. Nothing moved.',
      shortfall: null,
      cuts: [],
      lot: { lotId: 455n, tokens: 50_000_000_000_000_000n, symbol: 'SPY', token: 'SPY' },
      order: 'Lots are trimmed oldest first, the order a sell takes them in.',
    });
    expect(correctionModel(reconciled)?.lot).toBeNull();
    expect(correctionModel(reconciled)?.order).toBe('The ledgers come down in a fixed order: spend first, then USDG waiting to buy, lowest ticker first.');
  });
});
