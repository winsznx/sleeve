import { describe, expect, it } from 'vitest';

import {
  ERC1967_IMPLEMENTATION_SLOT,
  KERNEL_PROXY_RUNTIME,
  KERNEL_V31_IMPLEMENTATION,
  implementationFromSlot,
  isKernelV31Account,
} from '../../src/chain/kernel';

const SLOT_WORD = `0x000000000000000000000000${KERNEL_V31_IMPLEMENTATION.slice(2).toLowerCase()}` as const;

describe('Kernel v3.1 accounts (audit A1-23)', () => {
  it('reads the implementation from the ERC-1967 slot word', () => {
    // #when
    const implementation = implementationFromSlot(SLOT_WORD);
    // #then
    expect(implementation?.toLowerCase()).toBe(KERNEL_V31_IMPLEMENTATION.toLowerCase());
  });

  it('accepts the factory proxy pointing at v3.1', () => {
    // #when
    const ok = isKernelV31Account(KERNEL_PROXY_RUNTIME, implementationFromSlot(SLOT_WORD));
    // #then
    expect(ok).toBe(true);
  });

  it('refuses a contract that writes the slot itself but runs its own code', () => {
    // #when
    const ok = isKernelV31Account('0x6080604052', implementationFromSlot(SLOT_WORD));
    // #then
    expect(ok).toBe(false);
  });

  it('refuses the proxy pointing at another implementation, such as Kernel v3.3', () => {
    // #when
    const ok = isKernelV31Account(KERNEL_PROXY_RUNTIME, '0xd6CEDDe84be40893d153Be9d467CD6aD37875b28');
    // #then
    expect(ok).toBe(false);
  });

  it('refuses an address with no code', () => {
    // #when
    const ok = isKernelV31Account(undefined, null);
    // #then
    expect(ok).toBe(false);
  });

  it('matches the implementation ZeroDev SDK 5.5.10 names for Kernel 0.3.1', async () => {
    // #given
    const { KernelVersionToAddressesMap } = await import('@zerodev/sdk/constants');
    // #when
    const fromSdk = KernelVersionToAddressesMap['0.3.1'].accountImplementationAddress;
    // #then
    expect(fromSdk).toBe(KERNEL_V31_IMPLEMENTATION);
  });

  it('names the proxy runtime by the slot it reads', () => {
    // #when
    const embedsSlot = KERNEL_PROXY_RUNTIME.includes(ERC1967_IMPLEMENTATION_SLOT.slice(2));
    // #then
    expect(embedsSlot).toBe(true);
  });
});
