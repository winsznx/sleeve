// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { requestCountry } from './country';
import { POST } from './route';

function ask(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/eligibility', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const LAGOS = { residence: 'NG', notUsPerson: true, notSanctioned: true };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/eligibility', () => {
  it('lets a resident of Nigeria through when the request comes from Nigeria', async () => {
    // #given an attestation from Lagos and Vercel's country header
    vi.stubEnv('ELIGIBILITY_IP_COUNTRY', '');
    const response = await POST(ask(LAGOS, { 'x-vercel-ip-country': 'NG' }));
    // #then nothing blocks and the answer is never cached
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ eligible: true, ipCountry: 'NG', blocks: [] });
  });

  it('blocks a request from a restricted country even when the attestation says otherwise', async () => {
    vi.stubEnv('ELIGIBILITY_IP_COUNTRY', '');
    const response = await POST(ask(LAGOS, { 'x-vercel-ip-country': 'GB' }));
    expect(await response.json()).toEqual({
      eligible: false,
      ipCountry: 'GB',
      blocks: [{ kind: 'IP_RESTRICTED', country: 'GB' }],
    });
  });

  it('lists every block: residence, IP, a US person and sanctions', async () => {
    vi.stubEnv('ELIGIBILITY_IP_COUNTRY', '');
    const response = await POST(
      ask({ residence: 'ir', notUsPerson: false, notSanctioned: false }, { 'x-vercel-ip-country': 'VG' }),
    );
    expect(await response.json()).toEqual({
      eligible: false,
      ipCountry: 'VG',
      blocks: [
        { kind: 'RESIDENCE_PROHIBITED', country: 'IR' },
        { kind: 'IP_RESTRICTED', country: 'VG' },
        { kind: 'US_PERSON' },
        { kind: 'SANCTIONS' },
      ],
    });
  });

  it('takes the local override instead of the header outside production', async () => {
    // #given a laptop run that stands in for Russia
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('ELIGIBILITY_IP_COUNTRY', 'ru');
    const response = await POST(ask(LAGOS, { 'x-vercel-ip-country': 'NG' }));
    expect(await response.json()).toMatchObject({ eligible: false, ipCountry: 'RU', blocks: [{ kind: 'IP_PROHIBITED', country: 'RU' }] });
  });

  it('ignores the override in production, so a stray value cannot switch the check off', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('ELIGIBILITY_IP_COUNTRY', 'NG');
    const response = await POST(ask(LAGOS, { 'x-vercel-ip-country': 'CH' }));
    expect(await response.json()).toMatchObject({ eligible: false, ipCountry: 'CH' });
  });

  it('answers with an unknown country when no header and no override exist', async () => {
    vi.stubEnv('ELIGIBILITY_IP_COUNTRY', '');
    const response = await POST(ask(LAGOS));
    expect(await response.json()).toEqual({ eligible: true, ipCountry: null, blocks: [] });
  });

  it('never reads or repeats the raw IP', async () => {
    // #given a request that carries its IP in the usual forwarding headers
    vi.stubEnv('ELIGIBILITY_IP_COUNTRY', '');
    const ipHeaders = { 'x-forwarded-for': '102.89.33.17', 'x-real-ip': '102.89.33.17', 'x-vercel-forwarded-for': '102.89.33.17' };
    const response = await POST(ask(LAGOS, { ...ipHeaders, 'x-vercel-ip-country': 'NG' }));
    // #then the answer holds the country only
    expect(await response.text()).not.toContain('102.89');
    // #and the country comes from the country header alone
    expect(requestCountry(new Headers(ipHeaders), {})).toEqual({ country: null, source: 'none' });
  });

  it('refuses a body that is not an attestation', async () => {
    vi.stubEnv('ELIGIBILITY_IP_COUNTRY', '');
    expect((await POST(ask('not json'))).status).toBe(400);
    expect((await POST(ask({ residence: 'Nigeria', notUsPerson: true, notSanctioned: true }))).status).toBe(400);
    expect((await POST(ask({ residence: 'NG', notUsPerson: 'yes', notSanctioned: true }))).status).toBe(400);
  });
});
