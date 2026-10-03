import { describe, expect, it } from 'vitest';

import reference from './__fixtures__/qr-reference.json';
import { encodeQr, type QrErrorLevel } from './qr';

function rowsOf(modules: readonly boolean[], size: number): string[] {
  const rows: string[] = [];
  for (let row = 0; row < size; row += 1) {
    const bits = modules.slice(row * size, (row + 1) * size).map((dark) => (dark ? '1' : '0'));
    rows.push(BigInt(`0b${bits.join('')}`).toString(16).padStart(Math.ceil(size / 4), '0'));
  }
  return rows;
}

function isErrorLevel(value: string): value is QrErrorLevel {
  return value === 'L' || value === 'M' || value === 'Q' || value === 'H';
}

/** Reads the 15 format bits from the copy around the top-left finder, in the order the standard writes them. */
function readFormatBits(modules: readonly boolean[], size: number): number {
  const at = (row: number, col: number) => (modules[row * size + col] ? 1 : 0);
  const positions: [number, number][] = [
    [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [7, 8], [8, 8],
    [8, 7], [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
  ];
  return positions.reduce((bits, [row, col], index) => bits | (at(row, col) << index), 0);
}

describe('encodeQr', () => {
  it.each(reference.cases.map((entry) => [`${entry.errorLevel} version ${entry.version}`, entry] as const))(
    'matches node-qrcode bit for bit at %s',
    (_name, entry) => {
      if (!isErrorLevel(entry.errorLevel)) throw new Error(`bad level ${entry.errorLevel}`);
      const matrix = encodeQr(entry.text, { errorLevel: entry.errorLevel });
      expect({ version: matrix.version, mask: matrix.mask, size: matrix.size }).toEqual({
        version: entry.version,
        mask: entry.mask,
        size: entry.size,
      });
      expect(rowsOf(matrix.modules, matrix.size)).toEqual(entry.rows);
    },
  );

  it('fits the 42-character payment address in version 3 at level M', () => {
    const matrix = encodeQr('0x3efEf72Ee9aF42fd90f193A1A64aC25384179b36');
    expect([matrix.version, matrix.errorLevel, matrix.size]).toEqual([3, 'M', 29]);
  });

  it('writes format bits that name the level and the chosen mask, with a valid BCH remainder', () => {
    for (const errorLevel of ['L', 'M', 'Q', 'H'] as const) {
      for (let mask = 0; mask < 8; mask += 1) {
        const matrix = encodeQr('0x9b2C3fA0E14d6a7E5f8B1C0d2E3F4a5B6c7D8e91', { errorLevel, mask });
        const raw = readFormatBits(matrix.modules, matrix.size) ^ 0x5412;
        const data = raw >>> 10;
        let remainder = data;
        for (let i = 0; i < 10; i += 1) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
        expect(raw & 0x3ff).toBe(remainder & 0x3ff);
        expect(data).toBe(({ L: 1, M: 0, Q: 3, H: 2 } as const)[errorLevel] * 8 + mask);
      }
    }
  });

  it('keeps the dark module and alternating timing patterns', () => {
    const { modules, size } = encodeQr('Sleeve');
    expect(modules[(size - 8) * size + 8]).toBe(true);
    for (let i = 8; i < size - 8; i += 1) {
      expect(modules[6 * size + i]).toBe(i % 2 === 0);
      expect(modules[i * size + 6]).toBe(i % 2 === 0);
    }
  });

  it('refuses text that does not fit version 10 instead of drawing a broken code', () => {
    expect(() => encodeQr('x'.repeat(272), { errorLevel: 'L' })).toThrow(RangeError);
    expect(() => encodeQr('x'.repeat(120), { errorLevel: 'H' })).toThrow(RangeError);
  });
});
