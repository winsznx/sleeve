import { parseUsdg, ZERO_ADDRESS, type Address } from '@sleeve/core';
import { getAddress } from 'viem';

import { usdgExactText } from '@/components/sleeve/text';
import type { LedgerView } from '@/data/types';

/**
 * The checks a send runs before anything is signed: the amount against what is spendable, and the destination as
 * an address. A mixed-case address carries an EIP-55 checksum, so a mistyped letter fails it; an all lower or upper
 * case address carries none, so the screen says so and asks for a closer look. Sleeve keeps no address book.
 */

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export type DestinationCheck =
  | { kind: 'empty' }
  | { kind: 'invalid'; error: string }
  | { kind: 'valid'; address: Address; checksummed: boolean };

export function checkDestination(text: string, own: Address): DestinationCheck {
  const value = text.trim();
  if (value === '') return { kind: 'empty' };
  if (!ADDRESS.test(value)) {
    return { kind: 'invalid', error: 'Enter the whole address: 0x followed by 40 letters and numbers.' };
  }
  const address = getAddress(value);
  const body = value.slice(2);
  const mixed = body !== body.toLowerCase() && body !== body.toUpperCase();
  if (mixed && address !== value) {
    return {
      kind: 'invalid',
      error: 'One of its capital letters is wrong, so this is not the address you were given. Copy it again from where you got it.',
    };
  }
  if (address === getAddress(ZERO_ADDRESS)) {
    return { kind: 'invalid', error: 'That is the zero address. USDG sent there is gone for good.' };
  }
  if (address === getAddress(own)) {
    return { kind: 'invalid', error: 'That is your own payment address. Send to an address outside this account.' };
  }
  return { kind: 'valid', address, checksummed: mixed };
}

/** What can be sent now: spendable USDG and what arrived but is not sorted yet. Waiting USDG needs a release first. */
export function sendable(ledger: Pick<LedgerView, 'spend' | 'unsorted'>): bigint {
  return ledger.spend + ledger.unsorted;
}

export type AmountCheck = { kind: 'empty' } | { kind: 'invalid'; error: string } | { kind: 'valid'; amount: bigint };

export function checkAmount(text: string, max: bigint): AmountCheck {
  if (text.trim() === '') return { kind: 'empty' };
  const parsed = parseUsdg(text.trim());
  if (!parsed.ok) {
    return {
      kind: 'invalid',
      error: parsed.error === 'TOO_MANY_DECIMALS' ? 'USDG has 6 places after the point at most.' : 'Enter an amount in USDG, such as 120.50.',
    };
  }
  if (parsed.value === 0n) return { kind: 'invalid', error: 'Enter an amount above zero.' };
  if (parsed.value > max) return { kind: 'invalid', error: `That is more than you can send now, ${usdgExactText(max)}.` };
  return { kind: 'valid', amount: parsed.value };
}

/** The address in groups of four after 0x, so a reader can check it a piece at a time. */
export function addressGroups(address: Address): string[] {
  const body = address.slice(2);
  const groups: string[] = [];
  for (let index = 0; index < body.length; index += 4) groups.push(body.slice(index, index + 4));
  return groups;
}
