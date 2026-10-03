import { REASONS, type Rule } from '@sleeve/core';
import { beforeAll, describe, expect, it } from 'vitest';

import { createMockDataLayer, NEXT_OPEN, SAMPLE_ACCOUNT } from '@/data/mock';
import type { SplitPreview } from '@/data/types';

import { lintText } from '../../../../../../scripts/copy-lint.mjs';
import { forecastSort } from './sort-preview';

let weekend: SplitPreview;
let rule: Rule;

beforeAll(async () => {
  const layer = createMockDataLayer();
  [weekend, rule] = await Promise.all([layer.previewSplit(SAMPLE_ACCOUNT), layer.getRule(SAMPLE_ACCOUNT)]);
});

describe('forecastSort', () => {
  it('shows the equity share waiting for the market when sorted on a weekend', () => {
    // #given 165.80 USDG unsorted on Saturday, with SPY closed until Sunday 20:00 New York time
    // #when the inbox forecasts a sort now
    const forecast = forecastSort(weekend, rule, NEXT_OPEN);
    // #then 149.22 stays spendable and 16.58 waits as USDG, with the reopen time in words
    expect(forecast).toEqual({
      parts: { spend: 149_220_000n, equity: 0n, waiting: 16_580_000n },
      legend: [
        { kind: 'spend', amount: 149_220_000n, label: 'stays spendable' },
        { kind: 'waiting', amount: 16_580_000n, label: 'waits: market closed' },
      ],
      sentence:
        'Sorting now keeps 149.22 USDG spendable and sets 16.58 USDG aside to buy SPY, held as USDG in your account. The market is closed. Sleeve buys SPY after it reopens, Sun 27 Sep, 20:00 New York time.',
    });
  });

  it('names the minimum buy when the equity share is below it', () => {
    // #given an open market and an equity share under the 25 USDG minimum
    const preview: SplitPreview = { ...weekend, outcome: { kind: 'QUEUE', reason: 'CLIP' } };
    // #when the inbox forecasts a sort now
    const forecast = forecastSort(preview, rule, null);
    // #then the legend and the sentence both say why it waits
    expect([forecast?.legend[1]?.label, forecast?.sentence]).toEqual([
      'waits: below your minimum buy',
      'Sorting now keeps 149.22 USDG spendable and sets 16.58 USDG aside to buy SPY, held as USDG in your account. This is below your minimum buy of 25.00 USDG, so it waits. Sleeve buys once the waiting amount reaches the minimum.',
    ]);
  });

  it('shows a buy when every check before the swap would pass, and says the cap still applies', () => {
    // #given a preview whose guard clears up to the premium check
    const preview: SplitPreview = { ...weekend, outcome: { kind: 'BUY' } };
    // #when the inbox forecasts a sort now
    const forecast = forecastSort(preview, rule, null);
    // #then the equity share shows as bought, if the price is within the cap
    expect([forecast?.parts, forecast?.sentence]).toEqual([
      { spend: 149_220_000n, equity: 16_580_000n, waiting: 0n },
      'Sorting now keeps 149.22 USDG spendable and buys SPY with 16.58 USDG if the price is within your cap. If it is not, that part waits as USDG in your account.',
    ]);
  });

  it('counts a refused equity share as spend, for a blocked ticker or a blocked account', () => {
    // #given previews that would refuse the buy
    const ticker = forecastSort({ ...weekend, outcome: { kind: 'REFUSE', status: 'REFUSED_TICKER' } }, rule, null);
    const account = forecastSort({ ...weekend, outcome: { kind: 'REFUSE', status: 'REFUSED_ACCOUNT' } }, rule, null);
    // #then all of it stays spendable and the sentence says why
    expect([ticker?.parts, ticker?.sentence, account?.sentence]).toEqual([
      { spend: 165_800_000n, equity: 0n, waiting: 0n },
      'Sorting now keeps all of it spendable. SPY cannot be bought through Sleeve right now, so the 16.58 USDG equity share goes to spend too.',
      "Sorting now keeps all of it spendable. The issuer's blocklist includes this account, so the 16.58 USDG equity share goes to spend too.",
    ]);
  });

  it('forecasts nothing while the rule is paused or nothing is unsorted', () => {
    // #given a paused rule, and a preview with nothing to split
    const paused = forecastSort({ ...weekend, ruleStatus: 'PAUSED' }, rule, null);
    const idle = forecastSort({ ...weekend, unsorted: 0n, outcome: null }, rule, null);
    // #then there is nothing to forecast
    expect([paused, idle]).toEqual([null, null]);
  });

  it('writes sentences that pass the copy lint', () => {
    // #given every outcome a preview can carry
    const outcomes: SplitPreview['outcome'][] = [
      { kind: 'BUY' },
      { kind: 'REFUSE', status: 'REFUSED_TICKER' },
      { kind: 'REFUSE', status: 'REFUSED_ACCOUNT' },
      ...REASONS.map((reason) => ({ kind: 'QUEUE' as const, reason })),
    ];
    // #when each is put into words
    const texts = outcomes.flatMap((outcome) => {
      const forecast = forecastSort({ ...weekend, outcome }, rule, NEXT_OPEN);
      return forecast === null ? [] : [forecast.sentence, ...forecast.legend.map((item) => item.label)];
    });
    // #then none trips a copy rule
    expect(texts.flatMap((text) => lintText(text).map((finding) => `${finding.rule}: ${text}`))).toEqual([]);
  });
});
