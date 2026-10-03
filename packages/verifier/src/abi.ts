/**
 * ABI items the verifier reads that packages/core does not carry yet. Everything Sleeve deployed comes from core.
 * These belong to contracts outside Sleeve: the Uniswap v3 pool's Swap event, and the Stock Token's and its access
 * registry's pause and multiplier events and views, as docs/research/chain-constants.md section 3 lists them with
 * their topics. abi.test.ts pins every topic to that list.
 */

/** Uniswap v3 pool. amount0 and amount1 are the pool's deltas: positive is what the pool received. */
export const uniswapV3SwapAbi = [
  {
    type: 'event',
    name: 'Swap',
    inputs: [
      { name: 'sender', type: 'address', indexed: true },
      { name: 'recipient', type: 'address', indexed: true },
      { name: 'amount0', type: 'int256', indexed: false },
      { name: 'amount1', type: 'int256', indexed: false },
      { name: 'sqrtPriceX96', type: 'uint160', indexed: false },
      { name: 'liquidity', type: 'uint128', indexed: false },
      { name: 'tick', type: 'int24', indexed: false },
    ],
  },
] as const;

/**
 * Stock Token events. UIMultiplierUpdated has nothing indexed; oldMultiplier is uiMultiplier() when the update was
 * made. Paused and Unpaused are the token's own flag; the registry emits the same two events for its global pause.
 */
export const stockTokenEventsAbi = [
  {
    type: 'event',
    name: 'UIMultiplierUpdated',
    inputs: [
      { name: 'oldMultiplier', type: 'uint256', indexed: false },
      { name: 'newMultiplier', type: 'uint256', indexed: false },
      { name: 'effectiveAtTimestamp', type: 'uint256', indexed: false },
    ],
  },
  { type: 'event', name: 'Paused', inputs: [] },
  { type: 'event', name: 'Unpaused', inputs: [] },
  { type: 'event', name: 'OraclePaused', inputs: [] },
  { type: 'event', name: 'OracleUnpaused', inputs: [] },
] as const;

/** tokenPaused() is the token's own flag. paused() on the token ORs it with the registry's global pause. */
export const stockTokenPauseAbi = [
  { type: 'function', name: 'tokenPaused', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'bool' }] },
] as const;

/** The access registry's global pause, which every Stock Token's paused() includes. */
export const accessRegistryPauseAbi = [
  { type: 'function', name: 'paused', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'bool' }] },
  { type: 'event', name: 'Paused', inputs: [] },
  { type: 'event', name: 'Unpaused', inputs: [] },
] as const;
