import { DEPLOYMENT_4663 } from '@sleeve/core';
import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';

describe('keeper workspace', () => {
  it('resolves @sleeve/core and viem', () => {
    const { address } = DEPLOYMENT_4663.contracts.SleeveModule;
    expect(DEPLOYMENT_4663.chainId).toBe(4663);
    expect(getAddress(address)).toBe(address);
  });
});
