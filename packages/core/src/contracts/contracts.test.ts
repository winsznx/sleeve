import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { sleeveModuleAbi, tokenSourceAbi } from './abis';
import { DEPLOYMENT_4663 } from './deployment';

const record = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '..', '..', 'contracts', 'deployments', '4663.json'), 'utf8'),
) as { chainId: number; contracts: Record<string, { address: string; txHash: string; blockNumber: number }> };

describe('the 4663 deployment', () => {
  it('matches the deploy record address for address', () => {
    expect(DEPLOYMENT_4663.chainId).toBe(4663);
    for (const [name, entry] of Object.entries(record.contracts)) {
      const deployed = DEPLOYMENT_4663.contracts[name as keyof typeof DEPLOYMENT_4663.contracts];
      expect(deployed.address, name).toBe(entry.address);
      expect(deployed.txHash, name).toBe(entry.txHash);
    }
  });

  it('starts scanning at the first deploy block', () => {
    const blocks = Object.values(record.contracts).map((entry) => entry.blockNumber);
    expect(DEPLOYMENT_4663.firstBlock).toBe(Math.min(...blocks));
  });
});

describe('the module ABI', () => {
  const names = (type: string) =>
    sleeveModuleAbi.flatMap((item) => (item.type === type && 'name' in item ? [item.name] : []));

  it('has every entry point the keeper and the app call', () => {
    for (const fn of ['split', 'settle', 'release', 'sell', 'reconcileLots', 'observe', 'previewSplit', 'previewSettle', 'ledger', 'beginOwnerOp', 'endOwnerOp', 'setRule']) {
      expect(names('function'), fn).toContain(fn);
    }
  });

  it('decodes the events and errors the libraries raise from the module address', () => {
    expect(names('event')).toEqual(expect.arrayContaining(['ReceiptWritten', 'Observed', 'Reconciled', 'OwnerOpEnded', 'LotsReconciled']));
    expect(names('error')).toEqual(expect.arrayContaining(['GracePeriodActive', 'GuardNotClear', 'SellWaits', 'PremiumAboveCap']));
  });

  it('carries TokenSource views', () => {
    expect(tokenSourceAbi.flatMap((item) => (item.type === 'function' ? [item.name] : []))).toEqual(
      expect.arrayContaining(['ticker', 'tickerCount', 'isPoolAllowed', 'poolsOf']),
    );
  });
});
