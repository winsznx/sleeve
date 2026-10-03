import { describe, expect, it } from 'vitest';

import { createDataLayer } from './create';
import { resolveDataSource } from './source';

describe('resolveDataSource', () => {
  it('selects the mock when the flag is unset or empty', () => {
    expect([resolveDataSource(undefined), resolveDataSource(''), resolveDataSource('  ')]).toEqual(['mock', 'mock', 'mock']);
  });

  it('takes an exact source name', () => {
    expect([resolveDataSource('mock'), resolveDataSource(' chain ')]).toEqual(['mock', 'chain']);
  });

  it('fails on anything else instead of falling back', () => {
    expect(() => resolveDataSource('Chain')).toThrow('must be "mock" or "chain"');
  });
});

describe('createDataLayer', () => {
  it('builds the mock for the mock source', () => {
    expect(createDataLayer('mock').source).toBe('mock');
  });

  it('builds the Robinhood Chain layer for the chain source without touching the network', () => {
    expect(createDataLayer('chain').source).toBe('chain');
  });
});
