import { HttpRequestError, getAddress } from 'viem';
import { describe, expect, it } from 'vitest';

import { describeFailure, formatFailure, guardReason } from '../../src/chain/revert';
import { revert } from '../support/fake-chain';

describe('describeFailure', () => {
  it('names a module revert and its arguments', () => {
    // #when
    const failure = describeFailure(revert('PoolNotAllowed', [0, '0x783c9bbb765047cfdd2b84b92b2ca9f11d34b7ed']));
    // #then
    expect(failure).toMatchObject({
      kind: 'revert',
      name: 'PoolNotAllowed',
      args: [0, getAddress('0x783c9bbb765047cfdd2b84b92b2ca9f11d34b7ed')],
    });
  });

  it('reads GuardNotClear as the reason the settle waits on', () => {
    // #when
    const failure = describeFailure(revert('GuardNotClear', [8]));
    // #then
    expect([guardReason(failure), formatFailure(failure)]).toEqual(['PREMIUM', 'GuardNotClear(PREMIUM)']);
  });

  it('treats a transport failure as an RPC failure, never a revert', () => {
    // #when
    const failure = describeFailure(new HttpRequestError({ url: 'https://rpc.example/v2/xxxxxxxxxxxx', status: 503, details: 'Service Unavailable' }));
    // #then
    expect(failure.kind).toBe('rpc');
  });

  it('keeps the RPC URL out of the failure text', () => {
    // #when
    const failure = describeFailure(new HttpRequestError({ url: 'https://rpc.example/v2/xxxxxxxxxxxx', status: 503, details: 'Service Unavailable' }));
    // #then
    expect(formatFailure(failure)).not.toContain('xxxxxxxxxxxx');
  });

  it('describes a plain error by its message', () => {
    // #when
    const failure = describeFailure(new Error('socket closed'));
    // #then
    expect(failure).toEqual({ kind: 'rpc', message: 'socket closed' });
  });
});
