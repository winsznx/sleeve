import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import {
  ACCOUNTING_MODES,
  enumMember,
  REASONS,
  RECEIPT_FIELDS,
  SESSION_REASONS,
  SESSION_TYPES,
  STATUSES,
  TRIGGERS,
} from './spec';

const CONTRACTS = new URL('../../../contracts/src/', import.meta.url);

/** Member names of `enum <name> { ... }` in a Solidity file, in declaration order. */
function solidityEnum(file: string, name: string): string[] {
  const source = readFileSync(new URL(file, CONTRACTS), 'utf8');
  const body = new RegExp(`enum\\s+${name}\\s*\\{([^}]*)\\}`).exec(source)?.[1];
  if (body === undefined) throw new Error(`enum ${name} not found in ${file}`);
  return body
    .split(',')
    .map((member) => member.trim())
    .filter((member) => member !== '');
}

describe('enum order matches the contracts, so an index decodes to the right member', () => {
  it('follows SleeveTypes.sol', () => {
    expect([...STATUSES]).toEqual(solidityEnum('types/SleeveTypes.sol', 'Status'));
    expect([...REASONS]).toEqual(solidityEnum('types/SleeveTypes.sol', 'Reason'));
    expect([...TRIGGERS]).toEqual(solidityEnum('types/SleeveTypes.sol', 'Trigger'));
    expect([...ACCOUNTING_MODES]).toEqual(solidityEnum('types/SleeveTypes.sol', 'AccountingMode'));
  });

  it('follows SessionCalendar.sol', () => {
    expect([...SESSION_TYPES]).toEqual(solidityEnum('libraries/SessionCalendar.sol', 'SessionType'));
    expect([...SESSION_REASONS]).toEqual(solidityEnum('libraries/SessionCalendar.sol', 'Reason'));
  });
});

describe('enumMember', () => {
  it('decodes a uint8 into the contract enum member at that index', () => {
    expect(enumMember(STATUSES, 0)).toBe('FILLED');
    expect(enumMember(STATUSES, 8n)).toBe('RECONCILED');
    expect(enumMember(TRIGGERS, 2)).toBe('PAYLINK');
    expect(enumMember(REASONS, 8)).toBe('PREMIUM');
  });

  it('throws on an index the contract cannot produce', () => {
    expect(() => enumMember(STATUSES, 9)).toThrow(RangeError);
    expect(() => enumMember(STATUSES, -1)).toThrow(RangeError);
    expect(() => enumMember(STATUSES, 1.5)).toThrow(RangeError);
  });
});

describe('receipt fields', () => {
  it('keeps SPEC 13 order', () => {
    const names = Object.keys(RECEIPT_FIELDS);
    expect(names).toHaveLength(39);
    expect(names.slice(0, 5)).toEqual(['id', 'account', 'ruleVersion', 'trigger', 'payer']);
    expect(names.slice(-4)).toEqual(['lotId', 'queuedSince', 'overrideClosed', 'overrideCapBps']);
  });
});
