/**
 * Token icon sync. The rules live in docs/design/icon-system.md; this file is their only implementation.
 *
 *   cd app && node --experimental-strip-types scripts/sync-icons.ts
 *
 * Node 22.18 and later strip types without the flag. The script needs network access and writes
 * public/assets/tokens/* and public/assets/icons-manifest.json, nothing else.
 *
 * Every asset Sleeve shows walks the owner's source ladder, highest rung first:
 *
 *   ISSUER      the issuer's own asset metadata, keyed by contract
 *   CONTRACT    onchain metadata looked up by the exact contract address, never by ticker
 *   CHAIN_LIST  the community chain registry, for network and native gas identity
 *   PINNED      a manually verified source, recorded with its URL, its sha256 and the reason
 *
 * An image from an automated rung passes the brand guard first. Sleeve never shows the Robinhood feather or a
 * field of Robin Neon, and one image served for several assets is a placeholder, not an identity. A rejected
 * image is recorded as evidence and the walk goes on to the next rung.
 *
 * The run writes nothing unless every asset ends in one of two states:
 *
 *   icon       a real logo, downloaded, checksummed and served from public/assets/tokens
 *   withheld   the asset declares a neutral glyph, and every rung it could use returned a banned mark
 *
 * Anything else (an HTTP error, a missing image, a pin whose bytes changed upstream) fails the run with exit 1 and
 * leaves the committed files untouched. There is no letter badge and no silent fallback.
 */
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

type Rung = 'ISSUER' | 'CONTRACT' | 'CHAIN_LIST' | 'PINNED';
type AssetKind = 'stock-token' | 'stablecoin' | 'gas';
type Art = 'disc' | 'mark';
type Verdict = 'rejected' | 'not-listed' | 'not-applicable' | 'no-approved-pin';

interface Pin {
  url: string;
  sha256: string;
  reason: string;
  /** Who approved the pin and where the decision is logged, e.g. "owner, 2026-10-04, DECISIONS.md D-0xx". */
  approvedBy: string;
}

interface AssetSpec {
  key: string;
  symbol: string;
  name: string;
  kind: AssetKind;
  /** EIP-55 address on chain 4663. Null for the native gas token. */
  contract: string | null;
  /** How the accepted artwork sits in the circle: "disc" fills it, "mark" sits inset on a white plate. */
  art: Art;
  pin?: Pin;
  /** Set only for assets whose single published mark is banned: what the UI shows instead (icon-system.md 5). */
  withhold?: 'stock-token-glyph';
}

interface Check {
  rung: Rung;
  verdict: Verdict;
  sourceUrl?: string;
  sha256?: string;
  bytes?: number;
  reasons: string[];
}

interface IconRecord {
  symbol: string;
  name: string;
  kind: AssetKind;
  chainId: number;
  contract: string | null;
  rung: Rung;
  sourceUrl: string;
  gatewayUrl?: string;
  resolvedVia: string[];
  note?: string;
  retrievedAt: string;
  sha256: string;
  bytes: number;
  contentType: string;
  width: number;
  height: number;
  localPath: string;
  art: Art;
  checked: Check[];
}

interface WithheldRecord {
  symbol: string;
  name: string;
  kind: AssetKind;
  chainId: number;
  contract: string | null;
  display: 'stock-token-glyph';
  checked: Check[];
}

interface Manifest {
  schema: 1;
  generatedAt: string;
  generator: string;
  policy: string;
  ladder: Rung[];
  icons: Record<string, IconRecord>;
  withheld: Record<string, WithheldRecord>;
}

interface Image {
  bytes: Buffer;
  sha256: string;
  contentType: string;
  extension: 'png' | 'svg';
  width: number;
  height: number;
  /** sha256 of the decoded pixels (PNG) or of the markup (SVG), so re-encoded copies of one image still match. */
  pixelHash: string;
  /** Share of opaque pixels in the Robin Neon family (hue 60 to 90 degrees, saturation and value of 0.75 or more). */
  neonShare: number;
}

interface Candidate {
  sourceUrl: string;
  gatewayUrl?: string;
  resolvedVia: string[];
  note?: string;
  image: Image;
}

const CHAIN_ID = 4663;
const LADDER: Rung[] = ['ISSUER', 'CONTRACT', 'CHAIN_LIST', 'PINNED'];

const ISSUER_ASSETS_API = 'https://api.robinhood.com/rhj/assets';
/** GeckoTerminal's network id for chain 4663 ("Robinhood", coingecko_asset_platform_id "robinhood"), read from /networks. */
const GECKOTERMINAL_NETWORK = 'robinhood';
const GECKOTERMINAL_API = 'https://api.geckoterminal.com/api/v2';
const CHAIN_REGISTRY = 'https://raw.githubusercontent.com/ethereum-lists/chains/master/_data';
/** The bytes are checked against the CID, so any gateway that answers is as good as another. */
const IPFS_GATEWAYS = ['https://gateway.pinata.cloud/ipfs/', 'https://ipfs.filebase.io/ipfs/', 'https://ipfs.io/ipfs/', 'https://dweb.link/ipfs/'];

/**
 * The issuer's logoUrl image for every Stock Token sampled on 2026-10-03 (14 of the 194 listed, the four launch
 * tickers among them): the Robinhood feather on Robin Neon, 4,058 bytes, 180 by 180.
 */
const KNOWN_FEATHER_SHA256 = new Set(['3acff25ee4e8f842d245c315002965c712c7f42f00fff4377e1ad8ce88d78ab1']);
const NEON_REJECT_SHARE = 0.1;
const MIN_BYTES = 400;
const MIN_EDGE_PX = 64;

/** Contracts match LAUNCH_TICKERS in packages/core/src/tickers.ts; icons-manifest.test.ts holds them together. */
const ASSETS: readonly AssetSpec[] = [
  {
    key: 'SPY',
    symbol: 'SPY',
    name: 'SPDR S&P 500 ETF Trust',
    kind: 'stock-token',
    contract: '0x117cc2133c37B721F49dE2A7a74833232B3B4C0C',
    art: 'disc',
    pin: {
      url: 'https://assets.parqet.com/logos/symbol/SPY?format=png&size=200',
      sha256: '0647e693da95a106fa6b275d2487764bbdc9ecea40dc9b72c5fe887d0773b47e',
      reason: 'The issuer serves only the Robinhood feather for every Stock Token. This is the mark of the underlying fund or company, which tells the holder what the token tracks, as wallets and DeFi apps show it.',
      approvedBy: 'owner, 2026-10-03, DECISIONS.md D-023',
    },
    withhold: 'stock-token-glyph',
  },
  {
    key: 'QQQ',
    symbol: 'QQQ',
    name: 'Invesco QQQ',
    kind: 'stock-token',
    contract: '0xD5f3879160bc7c32ebb4dC785F8a4F505888de68',
    art: 'disc',
    pin: {
      url: 'https://assets.parqet.com/logos/symbol/QQQ?format=png&size=200',
      sha256: '3ec4f670dc08346af970bec328815e954ff015bf0906e3ed36b43f662257724e',
      reason: 'The issuer serves only the Robinhood feather for every Stock Token. This is the mark of the underlying fund or company, which tells the holder what the token tracks, as wallets and DeFi apps show it.',
      approvedBy: 'owner, 2026-10-03, DECISIONS.md D-023',
    },
    withhold: 'stock-token-glyph',
  },
  {
    key: 'NVDA',
    symbol: 'NVDA',
    name: 'NVIDIA',
    kind: 'stock-token',
    contract: '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC',
    art: 'disc',
    pin: {
      url: 'https://assets.parqet.com/logos/symbol/NVDA?format=png&size=200',
      sha256: '2fcc2b17f57c3dbd4c518fb299c9fee02b133b5ffab19adca5748b9b02d8c55a',
      reason: 'The issuer serves only the Robinhood feather for every Stock Token. This is the mark of the underlying fund or company, which tells the holder what the token tracks, as wallets and DeFi apps show it.',
      approvedBy: 'owner, 2026-10-03, DECISIONS.md D-023',
    },
    withhold: 'stock-token-glyph',
  },
  {
    key: 'AAPL',
    symbol: 'AAPL',
    name: 'Apple',
    kind: 'stock-token',
    contract: '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9',
    art: 'disc',
    pin: {
      url: 'https://assets.parqet.com/logos/symbol/AAPL?format=png&size=200',
      sha256: '475c11968359342e5599e6cb59ad72a519566ec62fe72d88bb9c2279c467162f',
      reason: 'The issuer serves only the Robinhood feather for every Stock Token. This is the mark of the underlying fund or company, which tells the holder what the token tracks, as wallets and DeFi apps show it.',
      approvedBy: 'owner, 2026-10-03, DECISIONS.md D-023',
    },
    withhold: 'stock-token-glyph',
  },
  {
    key: 'USDG',
    symbol: 'USDG',
    name: 'Global Dollar',
    kind: 'stablecoin',
    contract: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
    art: 'disc',
  },
  {
    key: 'ETH',
    symbol: 'ETH',
    name: 'Ether',
    kind: 'gas',
    contract: null,
    art: 'mark',
  },
];

const NO_PIN_REASON =
  'No approved pin. The candidates are the underlying company and fund sponsor logos; Apple and NVIDIA publish terms that ' +
  'require written permission, and PRD 7.12 rules out implied endorsement. Owner decision: docs/design/icon-system.md section 5.';

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS_DIR = join(APP_ROOT, 'public', 'assets');
const TOKENS_DIR = join(ASSETS_DIR, 'tokens');
const MANIFEST_PATH = join(ASSETS_DIR, 'icons-manifest.json');
const PUBLIC_TOKENS_PATH = '/assets/tokens';

class SyncError extends Error {}

function fail(message: string): never {
  throw new SyncError(message);
}

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(url: string, accept: string, attempts = 4): Promise<Response> {
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(url, {
      headers: { accept, 'user-agent': 'sleeve-icon-sync' },
      redirect: 'follow',
      signal: AbortSignal.timeout(30_000),
    });
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt >= attempts) return response;
    const retryAfter = Number(response.headers.get('retry-after'));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 60) * 1000 : 15_000 * attempt;
    console.log(`  wait   HTTP ${response.status} from ${new URL(url).host}, retrying in ${Math.round(waitMs / 1000)}s`);
    await sleep(waitMs);
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await request(url, 'application/json');
  if (!response.ok) fail(`HTTP ${response.status} for ${url}`);
  return response.json();
}

async function fetchBytes(url: string, attempts?: number): Promise<{ bytes: Buffer; contentType: string }> {
  const response = await request(url, 'image/png,image/svg+xml;q=0.9,*/*;q=0.1', attempts);
  if (!response.ok) fail(`HTTP ${response.status} for ${url}`);
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    contentType: (response.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? '',
  };
}

let lastGeckoTerminalCall = 0;

/** GeckoTerminal's public API allows about 30 calls a minute; the sync makes six. */
async function fetchGeckoTerminal(url: string): Promise<unknown> {
  const waitMs = lastGeckoTerminalCall + 2_500 - Date.now();
  if (waitMs > 0) await sleep(waitMs);
  lastGeckoTerminalCall = Date.now();
  return fetchJson(url);
}

function record(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(`${where}: expected an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown, where: string): string {
  if (typeof value !== 'string' || value === '') fail(`${where}: expected a non-empty string`);
  return value;
}

function list(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) fail(`${where}: expected an array`);
  return value;
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

// PNG reading for the brand guard: 8-bit RGB, RGBA, grey and grey-alpha, and 1 to 8-bit palette and grey, without
// interlacing. Anything else fails the guard loudly rather than passing unchecked.

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

interface PngChunk {
  type: string;
  data: Buffer;
}

function pngChunks(png: Buffer): PngChunk[] {
  if (png.length < 33 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) fail('not a PNG file');
  const chunks: PngChunk[] = [];
  let offset = 8;
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('latin1', offset + 4, offset + 8);
    chunks.push({ type, data: png.subarray(offset + 8, offset + 8 + length) });
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  return chunks;
}

function byteAt(bytes: Uint8Array, index: number): number {
  return bytes[index] ?? 0;
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toUpLeft = Math.abs(estimate - upLeft);
  if (toLeft <= toUp && toLeft <= toUpLeft) return left;
  return toUp <= toUpLeft ? up : upLeft;
}

function decodePng(png: Buffer): { width: number; height: number; rgba: Uint8Array } {
  const chunks = pngChunks(png);
  const header = chunks.find((chunk) => chunk.type === 'IHDR')?.data ?? fail('PNG without IHDR');
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const bitDepth = byteAt(header, 8);
  const colorType = byteAt(header, 9);
  const interlace = byteAt(header, 12);
  const channels = PNG_CHANNELS[colorType] ?? fail(`PNG color type ${colorType} is unknown`);
  const lowDepthAllowed = colorType === 0 || colorType === 3;
  if (interlace !== 0) fail('interlaced PNG; the brand guard reads non-interlaced PNG only');
  if (!(bitDepth === 8 || (lowDepthAllowed && [1, 2, 4].includes(bitDepth)))) {
    fail(`PNG bit depth ${bitDepth} with color type ${colorType} is not read by the brand guard`);
  }
  const palette = chunks.find((chunk) => chunk.type === 'PLTE')?.data;
  const transparency = chunks.find((chunk) => chunk.type === 'tRNS')?.data;
  if (colorType === 3 && palette === undefined) fail('palette PNG without PLTE');

  const raw = inflateSync(Buffer.concat(chunks.filter((chunk) => chunk.type === 'IDAT').map((chunk) => chunk.data)));
  const bitsPerPixel = channels * bitDepth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const step = Math.max(1, bitsPerPixel >> 3);
  if (raw.length < height * (stride + 1)) fail('PNG data is shorter than its header says');

  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  let position = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = byteAt(raw, position);
    const line = new Uint8Array(raw.subarray(position + 1, position + 1 + stride));
    position += stride + 1;
    for (let i = 0; i < stride; i += 1) {
      const left = i >= step ? byteAt(line, i - step) : 0;
      const up = byteAt(previous, i);
      const upLeft = i >= step ? byteAt(previous, i - step) : 0;
      const value = byteAt(line, i);
      if (filter === 1) line[i] = (value + left) & 255;
      else if (filter === 2) line[i] = (value + up) & 255;
      else if (filter === 3) line[i] = (value + ((left + up) >> 1)) & 255;
      else if (filter === 4) line[i] = (value + paeth(left, up, upLeft)) & 255;
      else if (filter !== 0) fail(`PNG filter ${filter} is unknown`);
    }
    for (let x = 0; x < width; x += 1) {
      const out = (y * width + x) * 4;
      if (bitDepth < 8) {
        const bit = x * bitDepth;
        const sample = (byteAt(line, bit >> 3) >> (8 - bitDepth - (bit & 7))) & ((1 << bitDepth) - 1);
        if (colorType === 3 && palette !== undefined) {
          rgba.set([byteAt(palette, sample * 3), byteAt(palette, sample * 3 + 1), byteAt(palette, sample * 3 + 2)], out);
          rgba[out + 3] = transparency?.[sample] ?? 255;
        } else {
          const grey = Math.round((sample * 255) / ((1 << bitDepth) - 1));
          rgba.set([grey, grey, grey, 255], out);
        }
        continue;
      }
      const at = x * channels;
      if (colorType === 6) rgba.set(line.subarray(at, at + 4), out);
      else if (colorType === 2) rgba.set([byteAt(line, at), byteAt(line, at + 1), byteAt(line, at + 2), 255], out);
      else if (colorType === 4) rgba.set([byteAt(line, at), byteAt(line, at), byteAt(line, at), byteAt(line, at + 1)], out);
      else if (colorType === 3 && palette !== undefined) {
        const index = byteAt(line, at);
        rgba.set([byteAt(palette, index * 3), byteAt(palette, index * 3 + 1), byteAt(palette, index * 3 + 2)], out);
        rgba[out + 3] = transparency?.[index] ?? 255;
      } else rgba.set([byteAt(line, at), byteAt(line, at), byteAt(line, at), 255], out);
    }
    previous = line;
  }
  return { width, height, rgba };
}

function isRobinNeon(red: number, green: number, blue: number): boolean {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  if (max === 0 || max === min) return false;
  if ((max - min) / max < 0.75 || max / 255 < 0.75) return false;
  const delta = max - min;
  let hue = max === red ? ((green - blue) / delta) % 6 : max === green ? (blue - red) / delta + 2 : (red - green) / delta + 4;
  hue *= 60;
  if (hue < 0) hue += 360;
  return hue >= 60 && hue <= 90;
}

function neonShareOf(rgba: Uint8Array): number {
  let opaque = 0;
  let neon = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (byteAt(rgba, i + 3) < 128) continue;
    opaque += 1;
    if (isRobinNeon(byteAt(rgba, i), byteAt(rgba, i + 1), byteAt(rgba, i + 2))) neon += 1;
  }
  return opaque === 0 ? 0 : neon / opaque;
}

function svgSize(svg: string): { width: number; height: number } {
  const viewBox = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(svg);
  const width = Number(viewBox?.[1] ?? /\bwidth\s*=\s*["']([\d.]+)/i.exec(svg)?.[1]);
  const height = Number(viewBox?.[2] ?? /\bheight\s*=\s*["']([\d.]+)/i.exec(svg)?.[1]);
  if (!(width > 0 && height > 0)) fail('SVG without a usable viewBox or size');
  return { width: Math.round(width), height: Math.round(height) };
}

function svgNeonShare(svg: string): number {
  const colors = [...svg.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)].map((match) => {
    const hex = match[1] ?? '';
    const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex;
    return [0, 2, 4].map((offset) => parseInt(full.slice(offset, offset + 2), 16));
  });
  if (colors.length === 0) return 0;
  return colors.filter(([red = 0, green = 0, blue = 0]) => isRobinNeon(red, green, blue)).length / colors.length;
}

function readImage(bytes: Buffer, contentType: string, url: string): Image {
  if (bytes.length < MIN_BYTES) fail(`${url}: ${bytes.length} bytes is too small to be a logo`);
  const head = bytes.subarray(0, 512).toString('utf8').trimStart();
  if (bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    const { width, height, rgba } = decodePng(bytes);
    if (Math.min(width, height) < MIN_EDGE_PX) fail(`${url}: ${width} by ${height} px is below ${MIN_EDGE_PX} px`);
    return {
      bytes,
      sha256: sha256(bytes),
      contentType: 'image/png',
      extension: 'png',
      width,
      height,
      pixelHash: sha256(rgba),
      neonShare: neonShareOf(rgba),
    };
  }
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) {
    const svg = bytes.toString('utf8');
    if (/<script\b|\bon[a-z]+\s*=|<foreignObject\b|xlink:href\s*=\s*["']https?:/i.test(svg)) {
      fail(`${url}: SVG with scripts, event handlers or external references is not served`);
    }
    return {
      bytes,
      sha256: sha256(bytes),
      contentType: 'image/svg+xml',
      extension: 'svg',
      ...svgSize(svg),
      pixelHash: sha256(svg.replace(/\s+/g, ' ')),
      neonShare: svgNeonShare(svg),
    };
  }
  return fail(`${url}: served ${contentType || 'an unknown type'}, which is neither PNG nor SVG`);
}

/** Brand guard for automated rungs. Returns the reasons to reject, or none. */
function brandReasons(image: Image, sharedWith: readonly string[]): string[] {
  const reasons: string[] = [];
  if (KNOWN_FEATHER_SHA256.has(image.sha256)) reasons.push('robinhood-feather: the issuer placeholder, byte for byte');
  if (image.neonShare >= NEON_REJECT_SHARE) {
    reasons.push(`robin-neon: ${(image.neonShare * 100).toFixed(1)} percent of opaque pixels in the Robin Neon family`);
  }
  if (sharedWith.length > 0) reasons.push(`shared-placeholder: the same picture is served for ${sharedWith.join(', ')}`);
  return reasons;
}

async function downloadImage(url: string): Promise<Image> {
  const { bytes, contentType } = await fetchBytes(url);
  return readImage(bytes, contentType, url);
}

// Rung resolvers. Each returns a candidate, a non-image verdict, or throws on any transport or format error.

type Resolved = { candidate: Candidate } | { verdict: Exclude<Verdict, 'rejected'>; reasons: string[]; sourceUrl?: string };

interface IssuerAsset {
  symbol: string;
  contract: string;
  logoUrl: string;
}

async function loadIssuerAssets(): Promise<IssuerAsset[]> {
  const body = record(await fetchJson(ISSUER_ASSETS_API), ISSUER_ASSETS_API);
  return list(body.assets, `${ISSUER_ASSETS_API} assets`).flatMap((entry, index) => {
    const asset = record(entry, `${ISSUER_ASSETS_API} assets[${index}]`);
    const deployment = list(asset.deployments, `assets[${index}].deployments`)
      .map((item, at) => record(item, `assets[${index}].deployments[${at}]`))
      .find((item) => item.chainId === CHAIN_ID);
    if (deployment === undefined || typeof asset.logoUrl !== 'string') return [];
    return [
      {
        symbol: text(asset.tokenSymbol, `assets[${index}].tokenSymbol`),
        contract: text(deployment.contractAddress, `assets[${index}].contractAddress`),
        logoUrl: asset.logoUrl,
      },
    ];
  });
}

async function resolveIssuer(spec: AssetSpec, issuerAssets: readonly IssuerAsset[]): Promise<Resolved> {
  if (spec.contract === null) {
    return { verdict: 'not-applicable', reasons: ['A native gas token has no issuer metadata.'] };
  }
  const contract = spec.contract;
  const listed = issuerAssets.find((asset) => sameAddress(asset.contract, contract));
  if (listed === undefined) {
    if (issuerAssets.some((asset) => asset.symbol === spec.symbol)) {
      fail(`${spec.key}: the issuer lists ${spec.symbol} under another contract than ${contract}`);
    }
    return {
      verdict: 'not-listed',
      sourceUrl: ISSUER_ASSETS_API,
      reasons: [`Not among the ${issuerAssets.length} assets the issuer lists for chain ${CHAIN_ID}.`],
    };
  }
  if (listed.symbol !== spec.symbol) fail(`${spec.key}: the issuer lists ${contract} as ${listed.symbol}`);
  return {
    candidate: {
      sourceUrl: listed.logoUrl,
      resolvedVia: [ISSUER_ASSETS_API],
      image: await downloadImage(listed.logoUrl),
    },
  };
}

async function resolveContract(spec: AssetSpec): Promise<Resolved> {
  if (spec.contract === null) {
    return { verdict: 'not-applicable', reasons: ['A native gas token has no contract to look up.'] };
  }
  const infoUrl = `${GECKOTERMINAL_API}/networks/${GECKOTERMINAL_NETWORK}/tokens/${spec.contract.toLowerCase()}/info`;
  const data = record(record(await fetchGeckoTerminal(infoUrl), infoUrl).data, `${infoUrl} data`);
  const attributes = record(data.attributes, `${infoUrl} attributes`);
  if (!sameAddress(text(attributes.address, `${infoUrl} address`), spec.contract)) fail(`${infoUrl} answered for another address`);
  const imageUrl = attributes.image_url;
  if (typeof imageUrl !== 'string' || imageUrl === '' || imageUrl.endsWith('missing.png')) {
    return { verdict: 'not-listed', sourceUrl: infoUrl, reasons: ['No image for this contract.'] };
  }
  return { candidate: { sourceUrl: imageUrl, resolvedVia: [infoUrl], image: await downloadImage(imageUrl) } };
}

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Decode(value: string): Buffer {
  let number = 0n;
  for (const character of value) {
    const digit = BASE58.indexOf(character);
    if (digit < 0) fail(`"${value}" is not base58`);
    number = number * 58n + BigInt(digit);
  }
  const hex = number.toString(16);
  const body = Buffer.from(hex.length % 2 === 0 ? hex : `0${hex}`, 'hex');
  const zeros = value.length - value.replace(/^1+/, '').length;
  return Buffer.concat([Buffer.alloc(zeros), body]);
}

function varint(value: number): Buffer {
  const out: number[] = [];
  let rest = value;
  while (rest >= 0x80) {
    out.push((rest & 0x7f) | 0x80);
    rest = Math.floor(rest / 0x80);
  }
  out.push(rest);
  return Buffer.from(out);
}

/**
 * True when the bytes are the file a CIDv0 names: a single dag-pb block holding one UnixFS file node, which is what
 * `ipfs add` produces for files up to its 256 KiB chunk size.
 */
function matchesCidV0(cid: string, bytes: Buffer): boolean {
  if (!/^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(cid)) fail(`${cid} is not a CIDv0 the sync can verify`);
  if (bytes.length > 262_144) fail(`${cid}: files over 256 KiB span several blocks and are not verified here`);
  const multihash = base58Decode(cid);
  if (multihash[0] !== 0x12 || multihash[1] !== 0x20) fail(`${cid} is not a sha2-256 multihash`);
  const unixfs = Buffer.concat([Buffer.from([0x08, 0x02, 0x12]), varint(bytes.length), bytes, Buffer.from([0x18]), varint(bytes.length)]);
  const block = Buffer.concat([Buffer.from([0x0a]), varint(unixfs.length), unixfs]);
  return createHash('sha256').update(block).digest().equals(multihash.subarray(2));
}

async function resolveChainList(spec: AssetSpec, previous: Manifest | null): Promise<Resolved> {
  if (spec.kind !== 'gas') {
    return { verdict: 'not-applicable', reasons: ['Chain registries list networks and their gas tokens, not tokens.'] };
  }
  const chainUrl = `${CHAIN_REGISTRY}/chains/eip155-${CHAIN_ID}.json`;
  const chain = record(await fetchJson(chainUrl), chainUrl);
  const gas = record(chain.nativeCurrency, `${chainUrl} nativeCurrency`);
  if (chain.chainId !== CHAIN_ID || gas.symbol !== spec.symbol) {
    fail(`${chainUrl}: expected chain ${CHAIN_ID} with gas ${spec.symbol}, got ${String(chain.chainId)} with ${String(gas.symbol)}`);
  }
  // Chain 4663 carries no icon of its own, by design here. Its gas is the ETH of its parent, Ethereum mainnet, so
  // the ETH icon is the one the registry assigns to eip155-1.
  const parentUrl = `${CHAIN_REGISTRY}/chains/eip155-1.json`;
  const parent = record(await fetchJson(parentUrl), parentUrl);
  if (record(parent.nativeCurrency, `${parentUrl} nativeCurrency`).symbol !== spec.symbol) fail(`${parentUrl}: gas is not ${spec.symbol}`);
  const iconName = text(parent.icon, `${parentUrl} icon`);
  const iconUrl = `${CHAIN_REGISTRY}/icons/${iconName}.json`;
  const iconEntry = record(list(await fetchJson(iconUrl), iconUrl)[0], `${iconUrl}[0]`);
  const ipfsUrl = text(iconEntry.url, `${iconUrl}[0].url`);
  const cid = ipfsUrl.replace(/^ipfs:\/\//, '');
  const resolvedVia = [chainUrl, parentUrl, iconUrl];
  const note = 'Bytes verified against the CID.';

  // A CID names its bytes, so a committed copy that still matches needs no gateway at all.
  const prior = previous?.icons[spec.key];
  if (prior?.sourceUrl === ipfsUrl) {
    const committed = await readFile(join(APP_ROOT, 'public', prior.localPath)).catch(() => null);
    if (committed !== null && matchesCidV0(cid, committed)) {
      const gatewayUrl = prior.gatewayUrl;
      return {
        candidate: {
          sourceUrl: ipfsUrl,
          ...(gatewayUrl === undefined ? {} : { gatewayUrl }),
          resolvedVia,
          note,
          image: readImage(committed, prior.contentType, prior.localPath),
        },
      };
    }
  }

  const tried: string[] = [];
  for (const gateway of IPFS_GATEWAYS) {
    const gatewayUrl = `${gateway}${cid}`;
    try {
      // One attempt per gateway: a busy gateway is skipped, not waited for.
      const { bytes, contentType } = await fetchBytes(gatewayUrl, 1);
      if (!matchesCidV0(cid, bytes)) {
        tried.push(`${gateway}: bytes do not match the CID`);
        continue;
      }
      return { candidate: { sourceUrl: ipfsUrl, gatewayUrl, resolvedVia, note, image: readImage(bytes, contentType, gatewayUrl) } };
    } catch (error) {
      if (!(error instanceof SyncError) && !(error instanceof TypeError) && !(error instanceof DOMException)) throw error;
      tried.push(`${gateway}: ${error.message}`);
    }
  }
  return fail(`${spec.key}: no IPFS gateway returned ${cid}. ${tried.join('; ')}`);
}

async function resolvePinned(spec: AssetSpec): Promise<Resolved> {
  const pin = spec.pin;
  if (pin === undefined) {
    return { verdict: 'no-approved-pin', reasons: [spec.kind === 'stock-token' ? NO_PIN_REASON : 'No pin declared.'] };
  }
  const image = await downloadImage(pin.url);
  if (image.sha256 !== pin.sha256) {
    fail(`${spec.key}: the pinned source changed upstream (sha256 ${image.sha256}, pinned ${pin.sha256}). Look at it again before re-pinning.`);
  }
  return { candidate: { sourceUrl: pin.url, resolvedVia: [], note: `${pin.reason} Approved by ${pin.approvedBy}.`, image } };
}

type Outcome = { kind: 'icon'; record: IconRecord; image: Image } | { kind: 'withheld'; record: WithheldRecord };

async function main(): Promise<void> {
  const previous = await readManifest();
  console.log(`token icon sync, chain ${CHAIN_ID}\n`);
  console.log(`reading the issuer's asset metadata: ${ISSUER_ASSETS_API}`);
  const issuerAssets = await loadIssuerAssets();

  const checks = new Map<string, Check[]>(ASSETS.map((spec) => [spec.key, []]));
  const accepted = new Map<string, { rung: Rung; candidate: Candidate }>();
  const failures: string[] = [];

  for (const rung of LADDER) {
    const open = ASSETS.filter((spec) => !accepted.has(spec.key));
    const candidates = new Map<string, Candidate>();
    for (const spec of open) {
      try {
        const resolved =
          rung === 'ISSUER'
            ? await resolveIssuer(spec, issuerAssets)
            : rung === 'CONTRACT'
              ? await resolveContract(spec)
              : rung === 'CHAIN_LIST'
                ? await resolveChainList(spec, previous)
                : await resolvePinned(spec);
        if ('candidate' in resolved) candidates.set(spec.key, resolved.candidate);
        else checks.get(spec.key)?.push({ rung, verdict: resolved.verdict, sourceUrl: resolved.sourceUrl, reasons: resolved.reasons });
      } catch (error) {
        failures.push(`${spec.key} at ${rung}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    for (const [key, candidate] of candidates) {
      const sharedWith =
        rung === 'PINNED'
          ? []
          : [...candidates].filter(([other, peer]) => other !== key && peer.image.pixelHash === candidate.image.pixelHash).map(([other]) => other);
      const reasons = rung === 'PINNED' ? [] : brandReasons(candidate.image, sharedWith);
      if (reasons.length === 0) {
        accepted.set(key, { rung, candidate });
        console.log(`  ok     ${key.padEnd(6)} ${String(candidate.image.bytes.length).padStart(7)}B  ${rung.toLowerCase()}  ${candidate.sourceUrl}`);
        continue;
      }
      checks.get(key)?.push({
        rung,
        verdict: 'rejected',
        sourceUrl: candidate.sourceUrl,
        sha256: candidate.image.sha256,
        bytes: candidate.image.bytes.length,
        reasons,
      });
      console.log(`  reject ${key.padEnd(6)} ${rung.toLowerCase()}  ${reasons.map((reason) => reason.split(':')[0]).join(', ')}`);
    }
  }

  const retrievedAt = new Date().toISOString();
  const outcomes = new Map<string, Outcome>();
  for (const spec of ASSETS) {
    const checked = checks.get(spec.key) ?? [];
    const hit = accepted.get(spec.key);
    if (hit !== undefined) {
      const { image } = hit.candidate;
      const localPath = `${PUBLIC_TOKENS_PATH}/${spec.key.toLowerCase()}.${image.extension}`;
      const prior = previous?.icons[spec.key];
      outcomes.set(spec.key, {
        kind: 'icon',
        image,
        record: {
          symbol: spec.symbol,
          name: spec.name,
          kind: spec.kind,
          chainId: CHAIN_ID,
          contract: spec.contract,
          rung: hit.rung,
          sourceUrl: hit.candidate.sourceUrl,
          ...(hit.candidate.gatewayUrl === undefined ? {} : { gatewayUrl: hit.candidate.gatewayUrl }),
          resolvedVia: hit.candidate.resolvedVia,
          ...(hit.candidate.note === undefined ? {} : { note: hit.candidate.note }),
          retrievedAt: prior?.sha256 === image.sha256 ? prior.retrievedAt : retrievedAt,
          sha256: image.sha256,
          bytes: image.bytes.length,
          contentType: image.contentType,
          width: image.width,
          height: image.height,
          localPath,
          art: spec.art,
          checked,
        },
      });
      continue;
    }
    const tried = checked.filter((check) => check.verdict !== 'not-applicable' && check.verdict !== 'no-approved-pin');
    const onlyBannedMarks =
      tried.length > 0 &&
      tried.every((check) => check.verdict === 'rejected' && check.reasons.some((reason) => /^(robinhood-feather|robin-neon)/.test(reason)));
    if (spec.withhold !== undefined && onlyBannedMarks && !failures.some((line) => line.startsWith(`${spec.key} `))) {
      outcomes.set(spec.key, {
        kind: 'withheld',
        record: {
          symbol: spec.symbol,
          name: spec.name,
          kind: spec.kind,
          chainId: CHAIN_ID,
          contract: spec.contract,
          display: spec.withhold,
          checked,
        },
      });
      continue;
    }
    if (!failures.some((line) => line.startsWith(`${spec.key} `))) {
      failures.push(`${spec.key}: no rung produced an acceptable logo (${checked.map((check) => `${check.rung} ${check.verdict}`).join(', ')})`);
    }
  }

  if (failures.length > 0) {
    console.error('\nFAILED. Every asset needs a real logo or an evidenced withhold. Nothing was written.');
    for (const line of failures) console.error(`  ${line}`);
    process.exit(1);
  }

  const manifest: Manifest = {
    schema: 1,
    generatedAt: retrievedAt,
    generator: 'app/scripts/sync-icons.ts',
    policy: 'docs/design/icon-system.md',
    ladder: LADDER,
    icons: {},
    withheld: {},
  };
  for (const spec of ASSETS) {
    const outcome = outcomes.get(spec.key);
    if (outcome?.kind === 'icon') manifest.icons[spec.key] = outcome.record;
    else if (outcome?.kind === 'withheld') manifest.withheld[spec.key] = outcome.record;
  }

  await mkdir(TOKENS_DIR, { recursive: true });
  const keep = new Set<string>();
  for (const outcome of outcomes.values()) {
    if (outcome.kind !== 'icon') continue;
    const file = outcome.record.localPath.split('/').pop() ?? fail('empty local path');
    keep.add(file);
    await writeFile(join(TOKENS_DIR, file), outcome.image.bytes);
  }
  for (const file of await readdir(TOKENS_DIR)) {
    if (keep.has(file)) continue;
    await rm(join(TOKENS_DIR, file));
    console.log(`  remove ${file}, no longer in the manifest`);
  }

  if (previous !== null && sameExceptTime(previous, manifest)) {
    console.log('\nmanifest unchanged');
  } else {
    await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`\nwrote ${MANIFEST_PATH.slice(APP_ROOT.length + 1)}`);
  }

  for (const icon of Object.values(manifest.icons)) {
    const onDisk = await readFile(join(APP_ROOT, 'public', icon.localPath));
    if (sha256(onDisk) !== icon.sha256) fail(`${icon.localPath} does not match its manifest checksum after writing`);
  }

  const withheld = Object.keys(manifest.withheld);
  console.log(`${Object.keys(manifest.icons).length} icons, ${withheld.length} withheld`);
  if (withheld.length > 0) {
    console.log(
      `\nWITHHELD ${withheld.join(', ')}: every published mark is the Robinhood feather, so the UI shows the Stock Token ` +
        'glyph. An approved PINNED source replaces it (docs/design/icon-system.md section 5).',
    );
  }
}

async function readManifest(): Promise<Manifest | null> {
  try {
    return JSON.parse(await readFile(MANIFEST_PATH, 'utf8')) as Manifest;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function sameExceptTime(a: Manifest, b: Manifest): boolean {
  return JSON.stringify({ ...a, generatedAt: '' }) === JSON.stringify({ ...b, generatedAt: '' });
}

main().catch((error: unknown) => {
  console.error(error instanceof SyncError ? `\nFAILED. ${error.message}` : error);
  process.exit(1);
});
