// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

function join(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/waitlist', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

interface Sent {
  url: string;
  prefer: string | null;
  body: unknown;
}

function stubSupabase(status: number, sent: Sent[]): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      sent.push({ url: String(input), prefer: headers.get('prefer'), body: JSON.parse(String(init?.body)) });
      return new Response(status < 300 ? null : 'error', { status });
    }),
  );
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co/');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key-for-tests');
  vi.stubEnv('ELIGIBILITY_IP_COUNTRY', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('POST /api/waitlist', () => {
  it('stores the email, the answer, the request country and the source, ignoring a repeat', async () => {
    // #given Supabase accepts the row
    const sent: Sent[] = [];
    stubSupabase(201, sent);
    // #when someone in Lagos joins from the footer
    const response = await POST(join({ email: 'Ada@Example.com', paidWith: 'stablecoins', source: 'footer', company: '' }, { 'cf-ipcountry': 'NG' }));
    // #then the row goes to the waitlist table as an insert that ignores a duplicate email
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ joined: true });
    expect(sent).toEqual([
      {
        url: 'https://project.supabase.co/rest/v1/waitlist?on_conflict=email',
        prefer: 'return=minimal,resolution=ignore-duplicates',
        body: { email: 'ada@example.com', paid_with: 'stablecoins', country: 'NG', source: 'footer' },
      },
    ]);
  });

  it('stores no country when Cloudflare cannot tell', async () => {
    const sent: Sent[] = [];
    stubSupabase(201, sent);
    await POST(join({ email: 'ada@example.com' }, { 'cf-ipcountry': 'XX' }));
    expect(sent[0]?.body).toEqual({ email: 'ada@example.com', paid_with: null, country: null, source: 'site' });
  });

  it('answers a filled honeypot as if it worked and stores nothing', async () => {
    const sent: Sent[] = [];
    stubSupabase(201, sent);
    const response = await POST(join({ email: 'bot@example.com', company: 'Acme' }));
    expect([response.status, await response.json(), sent.length]).toEqual([201, { joined: true }, 0]);
  });

  it('refuses a body that is not JSON or has no usable email', async () => {
    const sent: Sent[] = [];
    stubSupabase(201, sent);
    const notJson = await POST(join('{'));
    const badEmail = await POST(join({ email: 'ada' }));
    expect([notJson.status, badEmail.status, sent.length]).toEqual([400, 400, 0]);
    expect(await badEmail.json()).toEqual({ error: 'Enter an email address like you@example.com.' });
  });

  it('says so when Supabase refuses the row', async () => {
    stubSupabase(500, []);
    const response = await POST(join({ email: 'ada@example.com' }));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'The waitlist could not be saved. Try again in a minute.' });
  });

  it('answers 501 when the server has no Supabase keys', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    const response = await POST(join({ email: 'ada@example.com' }));
    expect(response.status).toBe(501);
  });
});
