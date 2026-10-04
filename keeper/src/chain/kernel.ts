import type { Address, Hex } from 'viem';

/**
 * ZeroDev Kernel v3.1 on chain 4663, the only account the keeper triggers for (audit A1-23). packages/core does not
 * carry these yet; the app keeps its own copy in app/src/lib/chain/kernel.ts and docs/GATES.md records the code check.
 */
export const KERNEL_V31_IMPLEMENTATION: Address = '0xBAC849bB641841b44E965fB01A4Bf5F074f84b4D';

/** The ERC-1967 implementation slot, where a Kernel account proxy keeps its implementation. */
export const ERC1967_IMPLEMENTATION_SLOT: Hex = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';

/**
 * Runtime code of every account the Kernel factory deploys: Solady's 61-byte ERC-1967 proxy, read from an account
 * created through the factory on a fork of chain 4663. The implementation lives in the slot above, so the code is
 * the same for every account and every Kernel 3.x version.
 */
export const KERNEL_PROXY_RUNTIME: Hex =
  '0x363d3d373d3d363d7f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc545af43d6000803e6038573d6000fd5b3d6000f3';

export const MODULE_TYPE_EXECUTOR = 2n;

/** The one Kernel view the keeper calls. JSON form, as in the app. */
export const kernelAbi = [
  {
    type: 'function',
    name: 'isModuleInstalled',
    stateMutability: 'view',
    inputs: [
      { name: 'moduleType', type: 'uint256' },
      { name: 'module', type: 'address' },
      { name: 'additionalContext', type: 'bytes' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

/** The implementation an ERC-1967 slot word names. */
export function implementationFromSlot(word: Hex | undefined): Address | null {
  if (word === undefined || !/^0x[0-9a-fA-F]{64}$/.test(word)) return null;
  return `0x${word.slice(26)}`;
}

/**
 * A Kernel v3.1 account: the factory's proxy code, pointing at the v3.1 implementation. A contract that installs the
 * module on itself fails the code check even when it writes the implementation slot itself.
 */
export function isKernelV31Account(code: Hex | undefined, implementation: Address | null): boolean {
  if (code === undefined || implementation === null) return false;
  return (
    code.toLowerCase() === KERNEL_PROXY_RUNTIME.toLowerCase() &&
    implementation.toLowerCase() === KERNEL_V31_IMPLEMENTATION.toLowerCase()
  );
}
