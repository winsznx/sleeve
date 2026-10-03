import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { encodeEventTopics } from 'viem';
import { describe, expect, it } from 'vitest';

import { accessRegistryPauseAbi, stockTokenEventsAbi, uniswapV3SwapAbi } from '../src/abi';
import { InvalidReceiptIdError, parseReceiptId } from '../src/errors';

/** The topics docs/research/chain-constants.md section 3 records from cast sig-event, which the local ABI must give. */
const research = readFileSync(join(__dirname, '..', '..', '..', 'docs', 'research', 'chain-constants.md'), 'utf8');

function recorded(event: string): string {
  const row = research.split('\n').find((line) => line.startsWith(`| \`${event}(`));
  const topic = row?.match(/0x[0-9a-f]{64}/)?.[0];
  if (topic === undefined) throw new Error(`no recorded topic for ${event}`);
  return topic;
}

describe('the ABI items packages/core does not carry', () => {
  it.each(['UIMultiplierUpdated', 'Paused', 'Unpaused', 'OraclePaused', 'OracleUnpaused'] as const)('%s has the recorded topic', (eventName) => {
    expect(encodeEventTopics({ abi: stockTokenEventsAbi, eventName })[0]).toBe(recorded(eventName));
  });

  it("gives the registry's pause events the same topics as the token's", () => {
    expect(encodeEventTopics({ abi: accessRegistryPauseAbi, eventName: 'Paused' })[0]).toBe(recorded('Paused'));
  });

  it('has the Uniswap v3 Swap topic', () => {
    expect(encodeEventTopics({ abi: uniswapV3SwapAbi, eventName: 'Swap' })[0]).toBe('0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67');
  });
});

describe('a receipt id', () => {
  it('is a whole number from 1', () => {
    expect(parseReceiptId(' 42 ')).toBe(42n);
    expect(parseReceiptId(7)).toBe(7n);
    expect(parseReceiptId(9n)).toBe(9n);
  });

  it.each(['0', '-1', '1.5', 'abc', '', `${2n ** 256n}`, '0x10'])('refuses %j', (input) => {
    expect(() => parseReceiptId(input)).toThrow(InvalidReceiptIdError);
  });
});
