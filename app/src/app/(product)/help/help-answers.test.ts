import { describe, expect, it } from 'vitest';

import { HELP_ANSWERS, matchesQuery } from './help-answers';

describe('help answers', () => {
  it('answer each question the owner asks, each with a way to a screen', () => {
    expect(HELP_ANSWERS.map((answer) => answer.id)).toEqual([
      'where-money-went',
      'holdings',
      'send',
      'waiting',
      'what-i-bought',
      'stock-token',
      'cost',
      'sell-back',
      'getting-out',
      'who-can-use',
    ]);
    for (const answer of HELP_ANSWERS) expect(answer.links.length).toBeGreaterThan(0);
  });

  it('call a Stock Token a debt security, not a share', () => {
    const stockToken = HELP_ANSWERS.find((answer) => answer.id === 'stock-token');
    expect(stockToken?.paragraphs.join(' ')).toContain('debt security, not a share');
  });

  it('match every word of a search in the question, the answer or the keywords', () => {
    const titles = (query: string) => HELP_ANSWERS.filter((answer) => matchesQuery(answer, query)).map((answer) => answer.id);
    expect(titles('')).toHaveLength(HELP_ANSWERS.length);
    expect(titles('withdraw')).toEqual(['send']);
    expect(titles('recovery passkey')).toContain('getting-out');
    expect(titles('zzz')).toEqual([]);
  });
});
