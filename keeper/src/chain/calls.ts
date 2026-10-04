import { DEPLOYMENT_4663, sleeveModuleAbi } from '@sleeve/core';
import { type Address, type Hex, encodeFunctionData } from 'viem';

/**
 * The only transactions the keeper can build: split and settle on the deployed module. The type admits nothing else,
 * so no code path can make the keeper key call another function or another contract (PRD 7.2, PRD 14: the keeper has
 * no power beyond what anyone has after the grace period).
 */
export type KeeperCall =
  | { fn: 'split'; account: Address; pool: Address; quote: bigint }
  | { fn: 'settle'; account: Address; tickerId: number; pool: Address; quote: bigint };

export const MODULE_ADDRESS: Address = DEPLOYMENT_4663.contracts.SleeveModule.address;

export interface EncodedCall {
  to: Address;
  data: Hex;
}

export function encodeKeeperCall(call: KeeperCall): EncodedCall {
  const data =
    call.fn === 'split'
      ? encodeFunctionData({ abi: sleeveModuleAbi, functionName: 'split', args: [call.account, call.pool, call.quote] })
      : encodeFunctionData({
          abi: sleeveModuleAbi,
          functionName: 'settle',
          args: [call.account, call.tickerId, call.pool, call.quote],
        });
  return { to: MODULE_ADDRESS, data };
}
