'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, useContext, useState, type JSX, type ReactNode } from 'react';

import { createDataLayer } from './create';
import { isDataLayerError } from './errors';
import type { SleeveDataLayer } from './types';

const DataLayerContext = createContext<SleeveDataLayer | null>(null);

/** Only a source outage is worth another try; every other failure is a named answer. */
function shouldRetry(failureCount: number, error: Error): boolean {
  return isDataLayerError(error) && error.code === 'SourceUnavailable' && failureCount < 2;
}

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 15_000, retry: shouldRetry },
      mutations: { retry: false },
    },
  });
}

export interface DataLayerProviderProps {
  children: ReactNode;
  /** Tests pass their own; the app uses the source NEXT_PUBLIC_SLEEVE_DATA_SOURCE names. */
  dataLayer?: SleeveDataLayer;
}

/** One data layer and one query cache per browser tab. The mock's sample account lives as long as the tab. */
export function DataLayerProvider({ children, dataLayer }: DataLayerProviderProps): JSX.Element {
  const [layer] = useState(() => dataLayer ?? createDataLayer());
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <DataLayerContext.Provider value={layer}>{children}</DataLayerContext.Provider>
    </QueryClientProvider>
  );
}

export function useDataLayer(): SleeveDataLayer {
  const layer = useContext(DataLayerContext);
  if (layer === null) throw new Error('useDataLayer needs a DataLayerProvider above it');
  return layer;
}
