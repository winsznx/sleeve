import { describe, expect, it } from 'vitest';

import { normalizeEmail, parseWaitlistRequest, waitlistSource } from './waitlist';

describe('normalizeEmail', () => {
  it('trims and lowercases an address', () => {
    expect(normalizeEmail('  Ada@Example.COM ')).toBe('ada@example.com');
  });

  it.each(['', 'ada', 'ada@example', '@example.com', 'ada@@example.com', 'a da@example.com', `${'a'.repeat(250)}@x.co`])(
    'refuses %j',
    (text) => {
      expect(normalizeEmail(text)).toBeNull();
    },
  );
});

describe('waitlistSource', () => {
  it('keeps a short lowercase name and falls back to site otherwise', () => {
    expect([waitlistSource('footer'), waitlistSource(null), waitlistSource('Footer'), waitlistSource('x'.repeat(33))]).toEqual([
      'footer',
      'site',
      'site',
      'site',
    ]);
  });
});

describe('parseWaitlistRequest', () => {
  it('reads an email with an optional answer and source', () => {
    // #given a filled form opened from the footer
    const body = { email: ' Ada@Example.com', paidWith: 'stablecoins', source: 'footer', company: '' };
    // #when the server reads it
    const parsed = parseWaitlistRequest(body);
    // #then the email is normalized and the answer kept
    expect(parsed).toEqual({ kind: 'entry', entry: { email: 'ada@example.com', paidWith: 'stablecoins', source: 'footer' } });
  });

  it('treats an empty answer as no answer', () => {
    expect(parseWaitlistRequest({ email: 'ada@example.com', paidWith: '' })).toEqual({
      kind: 'entry',
      entry: { email: 'ada@example.com', paidWith: null, source: 'site' },
    });
  });

  it('refuses an answer outside the list', () => {
    expect(parseWaitlistRequest({ email: 'ada@example.com', paidWith: 'gold' })).toMatchObject({ kind: 'invalid' });
  });

  it('refuses a body without a usable email', () => {
    expect([parseWaitlistRequest(null), parseWaitlistRequest({ email: 'ada' }), parseWaitlistRequest({})]).toEqual([
      { kind: 'invalid', error: 'Send the form as a JSON object.' },
      { kind: 'invalid', error: 'Enter an email address like you@example.com.' },
      { kind: 'invalid', error: 'Enter an email address like you@example.com.' },
    ]);
  });

  it('spots the honeypot before anything else', () => {
    expect(parseWaitlistRequest({ email: 'not an email', company: 'Acme' })).toEqual({ kind: 'trap' });
  });
});
