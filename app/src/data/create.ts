import { DataLayerError } from './errors';
import { createMockDataLayer } from './mock';
import { DATA_SOURCE } from './source';
import type { DataSource, SleeveDataLayer } from './types';

/** Long enough for loading states to show while screens are built against the mock. */
const MOCK_LATENCY_MS = 200;

/**
 * The implementation behind the screens. The Robinhood Chain implementation lands here later; until then
 * choosing it fails loudly rather than falling back to sample data.
 */
export function createDataLayer(source: DataSource = DATA_SOURCE): SleeveDataLayer {
  switch (source) {
    case 'mock':
      return createMockDataLayer({ latencyMs: MOCK_LATENCY_MS });
    case 'chain':
      throw new DataLayerError(
        { code: 'SourceUnavailable' },
        'The Robinhood Chain data layer is not built yet. Set NEXT_PUBLIC_SLEEVE_DATA_SOURCE=mock for the sample account.',
      );
  }
}
