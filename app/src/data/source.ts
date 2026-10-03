import type { DataSource } from './types';

export const DATA_SOURCES = ['mock', 'chain'] as const satisfies readonly DataSource[];

/**
 * Unset or empty selects the mock. Anything else must name a source exactly, so a typo fails the build instead
 * of quietly showing sample data. next.config.ts also refuses a Vercel production build without a value.
 */
export function resolveDataSource(value: string | undefined): DataSource {
  const wanted = value?.trim() ?? '';
  if (wanted === '') return 'mock';
  if (wanted === 'mock' || wanted === 'chain') return wanted;
  throw new Error(`NEXT_PUBLIC_SLEEVE_DATA_SOURCE must be "mock" or "chain", got "${value}"`);
}

/** Next inlines NEXT_PUBLIC_ variables at build time, so server and client read the same value. */
export const DATA_SOURCE: DataSource = resolveDataSource(process.env.NEXT_PUBLIC_SLEEVE_DATA_SOURCE);
