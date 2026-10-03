import { createChainDataLayer } from './chain';
import { serverCardStore } from './chain/server-cards';
import { checkEligibilityOnServer } from './eligibility-client';
import { createMockDataLayer } from './mock';
import { browserPasskeys } from './passkey';
import { DATA_SOURCE } from './source';
import type { DataSource, SleeveDataLayer } from './types';

/** Long enough for loading states to show while screens are built against the mock. */
const MOCK_LATENCY_MS = 200;

/**
 * The implementation behind the screens. On sample data the passkey ceremony and the eligibility check are still
 * real: the passkey is made for this site, and the server reads the request's country. On Robinhood Chain every read
 * comes from the live contracts (data/chain); the server reads shared cards from Supabase directly, and the browser
 * through Sleeve's own route, which holds the key.
 */
export function createDataLayer(source: DataSource = DATA_SOURCE): SleeveDataLayer {
  switch (source) {
    case 'mock':
      return createMockDataLayer({
        latencyMs: MOCK_LATENCY_MS,
        passkeys: browserPasskeys(),
        eligibility: (input) => checkEligibilityOnServer(input),
      });
    case 'chain':
      return createChainDataLayer(typeof window === 'undefined' ? { cards: serverCardStore() } : {});
  }
}
