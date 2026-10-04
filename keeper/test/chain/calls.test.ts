import { DEPLOYMENT_4663, sleeveModuleAbi } from '@sleeve/core';
import { decodeFunctionData, getAddress, toFunctionSelector } from 'viem';
import { describe, expect, it } from 'vitest';

import { encodeKeeperCall } from '../../src/chain/calls';

describe('encodeKeeperCall', () => {
  it('builds only split and settle, on the deployed module', () => {
    // #given
    const account = '0xada0000000000000000000000000000000000001';
    const pool = '0xa7bb1ac63bbab0c44316e6c8c455213441689167';
    // #when
    const calls = [
      encodeKeeperCall({ fn: 'split', account, pool, quote: 7n }),
      encodeKeeperCall({ fn: 'settle', account, tickerId: 2, pool, quote: 9n }),
    ];
    // #then
    expect(calls.map((call) => [call.to, call.data.slice(0, 10)])).toEqual([
      [DEPLOYMENT_4663.contracts.SleeveModule.address, toFunctionSelector('split(address,address,uint256)')],
      [DEPLOYMENT_4663.contracts.SleeveModule.address, toFunctionSelector('settle(address,uint8,address,uint256)')],
    ]);
  });

  it('carries the arguments the trigger chose', () => {
    // #given
    const call = encodeKeeperCall({
      fn: 'settle',
      account: '0xada0000000000000000000000000000000000001',
      tickerId: 3,
      pool: '0xaae0d815ee56e4092a5e5c2911e676fea50b2d6d',
      quote: 1_297_424_691_357_802n,
    });
    // #when
    const decoded = decodeFunctionData({ abi: sleeveModuleAbi, data: call.data });
    // #then
    expect([decoded.functionName, decoded.args]).toEqual([
      'settle',
      [
        getAddress('0xada0000000000000000000000000000000000001'),
        3,
        getAddress('0xaae0d815ee56e4092a5e5c2911e676fea50b2d6d'),
        1_297_424_691_357_802n,
      ],
    ]);
  });
});
