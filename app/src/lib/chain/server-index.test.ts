import { afterEach, describe, expect, it, vi } from 'vitest';

import { indexedReceipts, uintArrayFromText } from './server-index';

const CONFIG = { url: 'https://example.supabase.co', key: 'service-role' };
const ACCOUNT = '0xd5c24c50895b1d5f2cfa052f7b253fadac9bfd0b';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('uintArrayFromText', () => {
  it('reads Postgres array text as decimal strings', () => {
    expect(uintArrayFromText('{0,500000,0,123456789012345678901234567890}')).toEqual(['0', '500000', '0', '123456789012345678901234567890']);
    expect(uintArrayFromText('{}')).toEqual([]);
  });
});

describe('indexedReceipts', () => {
  it('asks PostgREST only for casts it can parse, and reads a reconciliation back', async () => {
    // #given an index with one RECONCILED receipt, answering every select by table
    const paths: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const path = url.slice(`${CONFIG.url}/rest/v1/`.length);
        paths.push(path);
        const table = path.split('?')[0];
        const rows: Record<string, unknown[]> = {
          receipts: [
            {
              receipt_id: '7',
              account: ACCOUNT,
              rule_version: 1,
              status: 'RECONCILED',
              lot_id: '0',
              receipt_hash: '0xaa',
              event_data: '0xbb',
              tx_hash: '0xcc',
              block_number: '79988022',
              log_index: 3,
            },
          ],
          rule_versions: [],
          reconciliations: [{ receipt_id: '7', from_spend: '0', from_buckets: '{0,250000,0,0}' }],
          payments: [],
        };
        return Response.json(rows[table ?? ''] ?? []);
      }),
    );
    // #when the receipts of the account are read
    const page = await indexedReceipts(CONFIG, { account: ACCOUNT, tickerId: null, status: null, before: null, limit: 20 });
    // #then no select carries an array cast, and the buckets come back as decimal strings
    expect(paths.some((path) => path.includes('[]'))).toBe(false);
    expect(page.items[0]?.reconciliation).toEqual({ fromSpend: '0', fromBuckets: ['0', '250000', '0', '0'] });
  });
});
