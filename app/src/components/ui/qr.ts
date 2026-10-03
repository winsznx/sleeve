/**
 * A QR Code Model 2 encoder (ISO/IEC 18004), byte mode only, versions 1 to 10. That covers the payment address
 * (42 bytes fits version 3 at level M) and short URIs, with no dependency. The mask is chosen with the four
 * standard penalty rules, scored the way the widely used node-qrcode package scores them, so for the same input
 * both produce the same symbol. qr.test.ts checks that bit for bit and decodes the result.
 */

export type QrErrorLevel = 'L' | 'M' | 'Q' | 'H';

export interface QrMatrix {
  version: number;
  errorLevel: QrErrorLevel;
  mask: number;
  /** Modules per side, without the quiet zone. */
  size: number;
  /** Row-major, true is dark. */
  modules: readonly boolean[];
}

const MAX_VERSION = 10;

/** Per version 1 to 10: EC codewords per block, then [blocks, data codewords] for group 1 and group 2. */
type BlockSpec = readonly [ecPerBlock: number, blocks1: number, data1: number, blocks2: number, data2: number];

const BLOCKS: Record<QrErrorLevel, readonly BlockSpec[]> = {
  L: [
    [7, 1, 19, 0, 0],
    [10, 1, 34, 0, 0],
    [15, 1, 55, 0, 0],
    [20, 1, 80, 0, 0],
    [26, 1, 108, 0, 0],
    [18, 2, 68, 0, 0],
    [20, 2, 78, 0, 0],
    [24, 2, 97, 0, 0],
    [30, 2, 116, 0, 0],
    [18, 2, 68, 2, 69],
  ],
  M: [
    [10, 1, 16, 0, 0],
    [16, 1, 28, 0, 0],
    [26, 1, 44, 0, 0],
    [18, 2, 32, 0, 0],
    [24, 2, 43, 0, 0],
    [16, 4, 27, 0, 0],
    [18, 4, 31, 0, 0],
    [22, 2, 38, 2, 39],
    [22, 3, 36, 2, 37],
    [26, 4, 43, 1, 44],
  ],
  Q: [
    [13, 1, 13, 0, 0],
    [22, 1, 22, 0, 0],
    [18, 2, 17, 0, 0],
    [26, 2, 24, 0, 0],
    [18, 2, 15, 2, 16],
    [24, 4, 19, 0, 0],
    [18, 2, 14, 4, 15],
    [22, 4, 18, 2, 19],
    [20, 4, 16, 4, 17],
    [24, 6, 19, 2, 20],
  ],
  H: [
    [17, 1, 9, 0, 0],
    [28, 1, 16, 0, 0],
    [22, 2, 13, 0, 0],
    [16, 4, 9, 0, 0],
    [22, 2, 11, 2, 12],
    [28, 4, 15, 0, 0],
    [26, 4, 13, 1, 14],
    [26, 4, 14, 2, 15],
    [24, 4, 12, 4, 13],
    [28, 6, 15, 2, 16],
  ],
};

/** Alignment pattern centres per version. */
const ALIGNMENT: readonly (readonly number[])[] = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

const FORMAT_LEVEL_BITS: Record<QrErrorLevel, number> = { L: 1, M: 0, Q: 3, H: 2 };

function spec(level: QrErrorLevel, version: number): BlockSpec {
  const found = BLOCKS[level][version - 1];
  if (found === undefined) throw new RangeError(`QR version ${version} is outside 1 to ${MAX_VERSION}`);
  return found;
}

function dataCapacity(level: QrErrorLevel, version: number): number {
  const [, blocks1, data1, blocks2, data2] = spec(level, version);
  return blocks1 * data1 + blocks2 * data2;
}

// GF(256) with the QR primitive polynomial x^8 + x^4 + x^3 + x^2 + 1.
const EXP = new Array<number>(512).fill(0);
const LOG = new Array<number>(256).fill(0);
{
  let value = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = value;
    LOG[value] = i;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255] ?? 0;
}

function gfMultiply(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[(LOG[a] ?? 0) + (LOG[b] ?? 0)] ?? 0;
}

/** The generator polynomial of the given degree, highest power first, leading 1 omitted. */
function generator(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array<number>(poly.length + 1).fill(0);
    poly.forEach((coefficient, j) => {
      next[j] = (next[j] ?? 0) ^ coefficient;
      next[j + 1] = (next[j + 1] ?? 0) ^ gfMultiply(coefficient, EXP[i] ?? 0);
    });
    poly = next;
  }
  return poly.slice(1);
}

function reedSolomon(data: readonly number[], degree: number): number[] {
  const divisor = generator(degree);
  const remainder = new Array<number>(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ (remainder.shift() ?? 0);
    remainder.push(0);
    divisor.forEach((coefficient, i) => {
      remainder[i] = (remainder[i] ?? 0) ^ gfMultiply(coefficient, factor);
    });
  }
  return remainder;
}

function chooseVersion(byteLength: number, level: QrErrorLevel): number {
  for (let version = 1; version <= MAX_VERSION; version += 1) {
    const countBits = version < 10 ? 8 : 16;
    if (4 + countBits + byteLength * 8 <= dataCapacity(level, version) * 8) return version;
  }
  throw new RangeError(`${byteLength} bytes do not fit a version ${MAX_VERSION} QR code at level ${level}`);
}

/** Mode, count, data, terminator and padding, as codewords. */
function dataCodewords(bytes: Uint8Array, version: number, level: QrErrorLevel): number[] {
  const capacityBits = dataCapacity(level, version) * 8;
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, version < 10 ? 8 : 16);
  bytes.forEach((byte) => push(byte, 8));
  push(0, Math.min(4, capacityBits - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | (bits[i + j] ?? 0);
    codewords.push(byte);
  }
  for (let pad = 0xec; codewords.length < capacityBits / 8; pad ^= 0xec ^ 0x11) codewords.push(pad);
  return codewords;
}

/** Splits into blocks, adds error correction to each, and interleaves. */
function finalCodewords(data: readonly number[], version: number, level: QrErrorLevel): number[] {
  const [ecPerBlock, blocks1, data1, blocks2, data2] = spec(level, version);
  const blocks: { data: number[]; ec: number[] }[] = [];
  let offset = 0;
  const lengths = [...new Array<number>(blocks1).fill(data1), ...new Array<number>(blocks2).fill(data2)];
  for (const length of lengths) {
    const chunk = data.slice(offset, offset + length);
    offset += length;
    blocks.push({ data: chunk, ec: reedSolomon(chunk, ecPerBlock) });
  }
  const out: number[] = [];
  const longest = Math.max(data1, data2);
  for (let i = 0; i < longest; i += 1) {
    for (const block of blocks) {
      const value = block.data[i];
      if (value !== undefined) out.push(value);
    }
  }
  for (let i = 0; i < ecPerBlock; i += 1) {
    for (const block of blocks) out.push(block.ec[i] ?? 0);
  }
  return out;
}

class Grid {
  readonly modules: boolean[];
  readonly reserved: boolean[];

  constructor(
    readonly size: number,
    from?: Grid,
  ) {
    this.modules = from === undefined ? new Array<boolean>(size * size).fill(false) : from.modules.slice();
    this.reserved = from === undefined ? new Array<boolean>(size * size).fill(false) : from.reserved.slice();
  }

  get(row: number, col: number): boolean {
    return this.modules[row * this.size + col] ?? false;
  }

  isReserved(row: number, col: number): boolean {
    return this.reserved[row * this.size + col] ?? false;
  }

  /** A function module: fixed by the standard, never masked. */
  fix(row: number, col: number, dark: boolean): void {
    if (row < 0 || col < 0 || row >= this.size || col >= this.size) return;
    this.modules[row * this.size + col] = dark;
    this.reserved[row * this.size + col] = true;
  }

  set(row: number, col: number, dark: boolean): void {
    this.modules[row * this.size + col] = dark;
  }
}

function drawFinder(grid: Grid, top: number, left: number): void {
  for (let dy = -1; dy <= 7; dy += 1) {
    for (let dx = -1; dx <= 7; dx += 1) {
      const inside = dy >= 0 && dy <= 6 && dx >= 0 && dx <= 6;
      const ring = dy === 0 || dy === 6 || dx === 0 || dx === 6;
      const core = dy >= 2 && dy <= 4 && dx >= 2 && dx <= 4;
      grid.fix(top + dy, left + dx, inside && (ring || core));
    }
  }
}

function drawFunctionPatterns(grid: Grid, version: number): void {
  const size = grid.size;
  drawFinder(grid, 0, 0);
  drawFinder(grid, 0, size - 7);
  drawFinder(grid, size - 7, 0);

  for (let i = 8; i < size - 8; i += 1) {
    grid.fix(6, i, i % 2 === 0);
    grid.fix(i, 6, i % 2 === 0);
  }

  const centres = ALIGNMENT[version - 1] ?? [];
  const last = centres.length - 1;
  centres.forEach((row, i) => {
    centres.forEach((col, j) => {
      const overlapsFinder = (i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0);
      if (overlapsFinder) return;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          grid.fix(row + dy, col + dx, Math.max(Math.abs(dy), Math.abs(dx)) !== 1);
        }
      }
    });
  });

  // Format areas are reserved now and written once the mask is known; the dark module is always dark.
  for (let i = 0; i <= 8; i += 1) {
    if (!grid.isReserved(8, i)) grid.fix(8, i, false);
    if (!grid.isReserved(i, 8)) grid.fix(i, 8, false);
  }
  for (let i = 0; i < 8; i += 1) {
    grid.fix(8, size - 1 - i, false);
    grid.fix(size - 1 - i, 8, false);
  }
  grid.fix(size - 8, 8, true);

  if (version >= 7) {
    let remainder = version;
    for (let i = 0; i < 12; i += 1) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
    const bits = (version << 12) | remainder;
    for (let i = 0; i < 18; i += 1) {
      const dark = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      grid.fix(b, a, dark);
      grid.fix(a, b, dark);
    }
  }
}

function drawFormat(grid: Grid, level: QrErrorLevel, mask: number): void {
  const size = grid.size;
  const data = (FORMAT_LEVEL_BITS[level] << 3) | mask;
  let remainder = data;
  for (let i = 0; i < 10; i += 1) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  const bits = ((data << 10) | remainder) ^ 0x5412;
  const bit = (i: number) => ((bits >>> i) & 1) === 1;

  for (let i = 0; i <= 5; i += 1) grid.fix(i, 8, bit(i));
  grid.fix(7, 8, bit(6));
  grid.fix(8, 8, bit(7));
  grid.fix(8, 7, bit(8));
  for (let i = 9; i < 15; i += 1) grid.fix(8, 14 - i, bit(i));

  for (let i = 0; i < 8; i += 1) grid.fix(8, size - 1 - i, bit(i));
  for (let i = 8; i < 15; i += 1) grid.fix(size - 15 + i, 8, bit(i));
  grid.fix(size - 8, 8, true);
}

function drawCodewords(grid: Grid, codewords: readonly number[]): void {
  const size = grid.size;
  const totalBits = codewords.length * 8;
  let index = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (let j = 0; j < 2; j += 1) {
        const col = right - j;
        if (grid.isReserved(row, col)) continue;
        // Remainder bits past the last codeword stay light.
        const dark = index < totalBits && (((codewords[index >>> 3] ?? 0) >>> (7 - (index & 7))) & 1) === 1;
        grid.set(row, col, dark);
        index += 1;
      }
    }
  }
}

const MASKS: readonly ((row: number, col: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function applyMask(grid: Grid, mask: number): void {
  const test = MASKS[mask];
  if (test === undefined) throw new RangeError(`QR mask ${mask} is outside 0 to 7`);
  for (let row = 0; row < grid.size; row += 1) {
    for (let col = 0; col < grid.size; col += 1) {
      if (!grid.isReserved(row, col) && test(row, col)) grid.set(row, col, !grid.get(row, col));
    }
  }
}

/** The four penalty rules, scored as node-qrcode scores them. */
function penalty(grid: Grid): number {
  const size = grid.size;
  let score = 0;

  for (let a = 0; a < size; a += 1) {
    let rowRun = 0;
    let colRun = 0;
    let rowLast: boolean | null = null;
    let colLast: boolean | null = null;
    let rowBits = 0;
    let colBits = 0;
    for (let b = 0; b < size; b += 1) {
      const inRow = grid.get(a, b);
      if (inRow === rowLast) rowRun += 1;
      else {
        if (rowRun >= 5) score += 3 + (rowRun - 5);
        rowLast = inRow;
        rowRun = 1;
      }
      const inCol = grid.get(b, a);
      if (inCol === colLast) colRun += 1;
      else {
        if (colRun >= 5) score += 3 + (colRun - 5);
        colLast = inCol;
        colRun = 1;
      }
      rowBits = ((rowBits << 1) & 0x7ff) | (inRow ? 1 : 0);
      colBits = ((colBits << 1) & 0x7ff) | (inCol ? 1 : 0);
      if (b >= 10 && (rowBits === 0x5d0 || rowBits === 0x05d)) score += 40;
      if (b >= 10 && (colBits === 0x5d0 || colBits === 0x05d)) score += 40;
    }
    if (rowRun >= 5) score += 3 + (rowRun - 5);
    if (colRun >= 5) score += 3 + (colRun - 5);
  }

  for (let row = 0; row < size - 1; row += 1) {
    for (let col = 0; col < size - 1; col += 1) {
      const dark = grid.get(row, col);
      if (dark === grid.get(row, col + 1) && dark === grid.get(row + 1, col) && dark === grid.get(row + 1, col + 1)) {
        score += 3;
      }
    }
  }

  const darkCount = grid.modules.reduce((count, dark) => count + (dark ? 1 : 0), 0);
  const k = Math.abs(Math.ceil((darkCount * 100) / (size * size) / 5) - 10);
  return score + k * 10;
}

export interface QrOptions {
  /** Default M, which recovers about 15 percent of damage. */
  errorLevel?: QrErrorLevel;
  /** Force a mask from 0 to 7. Tests use this; leave it out to pick the best. */
  mask?: number;
}

/** Encodes text (as UTF-8 bytes) into a QR matrix. Throws a RangeError when it does not fit version 10. */
export function encodeQr(text: string, options: QrOptions = {}): QrMatrix {
  const errorLevel = options.errorLevel ?? 'M';
  const bytes = new TextEncoder().encode(text);
  const version = chooseVersion(bytes.length, errorLevel);
  const codewords = finalCodewords(dataCodewords(bytes, version, errorLevel), version, errorLevel);
  const size = 17 + version * 4;

  const base = new Grid(size);
  drawFunctionPatterns(base, version);
  drawCodewords(base, codewords);

  const render = (mask: number): Grid => {
    const grid = new Grid(size, base);
    drawFormat(grid, errorLevel, mask);
    applyMask(grid, mask);
    return grid;
  };

  let mask = options.mask;
  if (mask === undefined) {
    let best = Number.POSITIVE_INFINITY;
    for (let candidate = 0; candidate < MASKS.length; candidate += 1) {
      const score = penalty(render(candidate));
      if (score < best) {
        best = score;
        mask = candidate;
      }
    }
  }
  const chosen = mask ?? 0;
  return { version, errorLevel, mask: chosen, size, modules: render(chosen).modules };
}
