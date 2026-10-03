/**
 * Every color claim docs/DESIGN.md makes, checked against the values in tokens.css.
 *
 * Pure functions with no dependencies: give checkTokens() the text of tokens.css and it returns a
 * report. scripts/contrast-check.mjs prints that report as Markdown for DESIGN.md section 3 and exits
 * non-zero on any failure; /dev/palette renders the same report, so the page and the gate cannot
 * disagree.
 *
 * Contrast is WCAG 2: relative luminance from sRGB, (L1 + 0.05) / (L2 + 0.05), compared unrounded and
 * printed truncated to two decimals, so a printed value never overstates. Translucent colors are
 * composited over their backdrop in sRGB, as browsers blend, before measuring.
 */

export const AA_TEXT = 4.5;
export const AA_NON_TEXT = 3;
export const CHROMATIC_OKLCH_C = 0.04;
export const MIN_DELTA_E = 10;
export const NEON_BAND = [60, 90];
export const BLUE_BAND = [190, 260];
/** Machado, Oliveira and Fernandes (2009) severity 1.0; thresholds are the dataviz method's. */
export const CVD_TARGET = 8;
export const NORMAL_VISION_FLOOR = 15;

/**
 * Colors the palette keeps away from. Names avoid the brand word so the copy lint, which reads this
 * folder, stays clean; DESIGN.md section 3 says whose colors they are.
 */
export const REFERENCES = [
  {
    hex: '#ccff00',
    name: 'Robin Neon',
    source: 'docs.robinhood.com/chain/brand-guidelines, fetched 2 October 2026 (docs/research/issuer-docs.md section 4)',
  },
  {
    hex: '#00c805',
    name: 'Logo green',
    source: 'www.designyourway.net/blog/robinhood-logo/, a third-party logo page (docs/research/issuer-docs.md section 4)',
  },
  {
    hex: '#21ce99',
    name: 'Former link green',
    source: 'github.com/robinhood/thorn docs/_theme/thorn/static/thorn.css_t line 158, fetched 3 October 2026',
  },
  {
    hex: '#17ad7b',
    name: 'Former link hover green',
    source: 'github.com/robinhood/thorn docs/_theme/thorn/static/thorn.css_t line 163, fetched 3 October 2026',
  },
];

export class TokenError extends Error {}

// ---------- color math ----------

/**
 * @typedef {{ r: number, g: number, b: number, a: number }} Rgba
 * @typedef {{ h: number, s: number, l: number }} Hsl
 * @typedef {{ L: number, C: number, h: number }} Oklch
 */

/** @param {number} c8 */
const toLinear = (c8) => {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** @param {Rgba} color */
export const luminance = ({ r, g, b }) => 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);

/** @param {Rgba} a @param {Rgba} b */
export const contrast = (a, b) => {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

/** @param {Rgba} top @param {Rgba} bottom @returns {Rgba} */
export const over = (top, bottom) => {
  if (bottom.a !== 1) throw new TokenError('backdrop must be opaque after compositing');
  /** @param {number} t @param {number} u */
  const mix = (t, u) => Math.round(t * top.a + u * (1 - top.a));
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: 1 };
};

/** @param {Rgba} color @returns {Hsl} */
export const hsl = ({ r, g, b }) => {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l: l * 100 };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rr) h = ((gg - bb) / d) % 6;
  else if (max === gg) h = (bb - rr) / d + 2;
  else h = (rr - gg) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s: s * 100, l: l * 100 };
};

/** @param {[number, number, number]} linear @returns {[number, number, number]} */
const oklabFromLinear = ([lr, lg, lb]) => {
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
};

/** @param {Rgba} color @returns {[number, number, number]} */
const linearOf = ({ r, g, b }) => [toLinear(r), toLinear(g), toLinear(b)];

/** @param {Rgba} color @returns {Oklch} */
export const oklch = (color) => {
  const [L, A, B] = oklabFromLinear(linearOf(color));
  let h = (Math.atan2(B, A) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { L, C: Math.hypot(A, B), h };
};

/** @param {Oklch} target @returns {{ color: Rgba, inGamut: boolean }} */
export const fromOklch = ({ L, C, h }) => {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const inGamut = linear.every((v) => v >= -1e-4 && v <= 1 + 1e-4);
  /** @param {number} v */
  const encode = (v) => {
    const c = Math.min(1, Math.max(0, v));
    return Math.round((c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055) * 255);
  };
  return { color: { r: encode(linear[0]), g: encode(linear[1]), b: encode(linear[2]), a: 1 }, inGamut };
};

/** @param {Rgba} color */
const lab = (color) => {
  const [lr, lg, lb] = linearOf(color);
  const x = (0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / 0.95047;
  const y = 0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb;
  const z = (0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb) / 1.08883;
  /** @param {number} t */
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  return { L: 116 * f(y) - 16, a: 500 * (f(x) - f(y)), b: 200 * (f(y) - f(z)) };
};

/** CIEDE2000, after Sharma, Wu and Dalal (2005). @param {Rgba} c1 @param {Rgba} c2 */
export const deltaE2000 = (c1, c2) => {
  const p = lab(c1);
  const q = lab(c2);
  const rad = Math.PI / 180;
  const cBar = (Math.hypot(p.a, p.b) + Math.hypot(q.a, q.b)) / 2;
  const g = 0.5 * (1 - Math.sqrt(cBar ** 7 / (cBar ** 7 + 25 ** 7)));
  const a1 = (1 + g) * p.a;
  const a2 = (1 + g) * q.a;
  const c1p = Math.hypot(a1, p.b);
  const c2p = Math.hypot(a2, q.b);
  /** @param {number} a @param {number} b */
  const hue = (a, b) => {
    if (a === 0 && b === 0) return 0;
    const h = (Math.atan2(b, a) * 180) / Math.PI;
    return h < 0 ? h + 360 : h;
  };
  const h1 = hue(a1, p.b);
  const h2 = hue(a2, q.b);
  let dh = 0;
  if (c1p * c2p !== 0) {
    dh = h2 - h1;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }
  const dL = q.L - p.L;
  const dC = c2p - c1p;
  const dH = 2 * Math.sqrt(c1p * c2p) * Math.sin((dh / 2) * rad);
  const lBar = (p.L + q.L) / 2;
  const cBarP = (c1p + c2p) / 2;
  let hBar = h1 + h2;
  if (c1p * c2p !== 0) {
    if (Math.abs(h1 - h2) > 180) hBar = h1 + h2 < 360 ? (h1 + h2 + 360) / 2 : (h1 + h2 - 360) / 2;
    else hBar = (h1 + h2) / 2;
  }
  const t =
    1 -
    0.17 * Math.cos((hBar - 30) * rad) +
    0.24 * Math.cos(2 * hBar * rad) +
    0.32 * Math.cos((3 * hBar + 6) * rad) -
    0.2 * Math.cos((4 * hBar - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hBar - 275) / 25) ** 2));
  const rc = 2 * Math.sqrt(cBarP ** 7 / (cBarP ** 7 + 25 ** 7));
  const sl = 1 + (0.015 * (lBar - 50) ** 2) / Math.sqrt(20 + (lBar - 50) ** 2);
  const sc = 1 + 0.045 * cBarP;
  const sh = 1 + 0.015 * cBarP * t;
  const rt = -Math.sin(2 * dTheta * rad) * rc;
  return Math.sqrt((dL / sl) ** 2 + (dC / sc) ** 2 + (dH / sh) ** 2 + rt * (dC / sc) * (dH / sh));
};

/** Machado, Oliveira and Fernandes (2009), severity 1.0, on linear RGB. */
const CVD = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
};

/**
 * OKLab distance times 100, the unit of the dataviz method's color-vision checks.
 * @param {Rgba} c1 @param {Rgba} c2 @param {'protan' | 'deutan' | 'normal'} vision
 */
export const okDelta = (c1, c2, vision) => {
  /** @param {Rgba} color @returns {[number, number, number]} */
  const seen = (color) => {
    const linear = linearOf(color);
    if (vision === 'normal') return linear;
    const m = CVD[vision];
    /** @param {number[]} row */
    const apply = (row) => Math.min(1, Math.max(0, row[0] * linear[0] + row[1] * linear[1] + row[2] * linear[2]));
    return [apply(m[0]), apply(m[1]), apply(m[2])];
  };
  const p = oklabFromLinear(seen(c1));
  const q = oklabFromLinear(seen(c2));
  return 100 * Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};

// ---------- parsing ----------

const HEX = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/gi;
const RGB = /rgba?\(\s*[^)]*\)/gi;
const ANY_COLOR = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|rgba?\(\s*[^)]*\)/gi;

/** @param {string} text @returns {Rgba | null} */
export const parseColor = (text) => {
  const value = text.trim();
  if (value.startsWith('#')) {
    let h = value.slice(1);
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(h)) return null;
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    };
  }
  const m = /^rgba?\((.*)\)$/i.exec(value);
  if (!m) return null;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  /** @param {string} p */
  const channel = (p) => (p.endsWith('%') ? (parseFloat(p) / 100) * 255 : parseFloat(p));
  const alpha = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
  return { r: channel(parts[0]), g: channel(parts[1]), b: channel(parts[2]), a: alpha };
};

/** @param {Rgba} color */
export const toHex = ({ r, g, b }) =>
  `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`.toUpperCase();

/** @param {string} css */
export const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Declarations from top-level :root blocks only. Blocks inside @media hold responsive overrides of
 * layout and type tokens, and the reduced-transparency fallback for glass, never base colors.
 * @param {string} css comment-free CSS
 * @returns {Map<string, string>}
 */
export const readRootTokens = (css) => {
  const tokens = new Map();
  let depth = 0;
  let i = 0;
  while (i < css.length) {
    const ch = css[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (depth === 0 && css.startsWith(':root', i)) {
      const open = css.indexOf('{', i);
      let close = open + 1;
      let inner = 1;
      while (inner > 0 && close < css.length) {
        if (css[close] === '{') inner += 1;
        else if (css[close] === '}') inner -= 1;
        close += 1;
      }
      const body = css.slice(open + 1, close - 1);
      for (const decl of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
        tokens.set(decl[1], decl[2].replace(/\s+/g, ' ').trim());
      }
      i = close;
      continue;
    }
    i += 1;
  }
  return tokens;
};

/**
 * Replaces every var() with its resolved value, following fallbacks.
 * @param {string} value @param {Map<string, string>} tokens @param {Set<string>} [seen]
 * @returns {string}
 */
export const resolveVars = (value, tokens, seen = new Set()) => {
  let out = '';
  let i = 0;
  while (i < value.length) {
    const start = value.indexOf('var(', i);
    if (start === -1) {
      out += value.slice(i);
      break;
    }
    out += value.slice(i, start);
    let depth = 1;
    let j = start + 4;
    while (j < value.length && depth > 0) {
      if (value[j] === '(') depth += 1;
      else if (value[j] === ')') depth -= 1;
      j += 1;
    }
    const inner = value.slice(start + 4, j - 1);
    const comma = inner.indexOf(',');
    const name = (comma === -1 ? inner : inner.slice(0, comma)).trim();
    const fallback = comma === -1 ? undefined : inner.slice(comma + 1).trim();
    const known = tokens.get(name);
    if (known !== undefined) {
      if (seen.has(name)) throw new TokenError(`circular reference through ${name}`);
      out += resolveVars(known, tokens, new Set([...seen, name]));
    } else if (fallback !== undefined) {
      out += resolveVars(fallback, tokens, seen);
    } else {
      throw new TokenError(`undefined token ${name}`);
    }
    i = j;
  }
  return out;
};

// ---------- the claims ----------

/** Surfaces text and focus rings sit on. Every one is opaque. */
export const TEXT_SURFACES = [
  '--color-canvas',
  '--color-surface-muted',
  '--color-surface-strong',
  '--color-shell',
  '--color-accent-soft',
  '--color-equity-surface',
  '--color-spend-soft',
  '--color-spend-surface',
  '--color-info-soft',
  '--color-warning-soft',
  '--color-danger-soft',
];

/**
 * What each use asks of a palette step.
 * @type {Record<string, { says: string, min?: number, on?: string[], under?: string[], carries?: string[] }>}
 */
export const USE_RULES = {
  text: { min: AA_TEXT, on: TEXT_SURFACES, says: 'text and links, 4.5:1 on every light surface and tint' },
  focus: { min: AA_NON_TEXT, on: [...TEXT_SURFACES, '--color-brand'], says: 'focus ring, 3:1 on every surface it can sit on, the black pill included' },
  fill: { min: AA_NON_TEXT, on: ['--color-canvas', '--color-surface-muted', '--color-surface-strong'], says: 'meaningful fills, icons, segments and strokes, 3:1' },
  'under white': { min: AA_TEXT, carries: ['--color-on-accent'], says: 'carries white text at 4.5:1 (feature card, deep band, verified check)' },
  tint: { min: AA_TEXT, under: ['--color-ink', '--color-ink-secondary'], says: 'background under ink and ink-secondary text' },
  highlight: { min: AA_TEXT, under: ['--color-ink'], says: 'text selection and highlights, under ink only' },
  border: { says: 'decorative border, no contrast duty' },
  art: { says: 'illustration and gradient stops, no contrast duty' },
};

/**
 * The scales, their hue bands (HSL) and the allowed uses of each step. `replaces` names the closeout
 * value a step stands in for, with its file and line under closeout/apps/web.
 */
export const SCALES = [
  {
    name: 'green',
    prefix: '--palette-green-',
    hueBand: [150, 170],
    steps: {
      50: { uses: ['tint', 'art'], replaces: 'none (notes and equity surfaces)' },
      100: { uses: ['tint', 'art'], replaces: '#EAF0FE accent-soft, preserve-soft (globals.css:21, 25)' },
      200: { uses: ['tint', 'highlight', 'border', 'art'], replaces: '#C9DCF7 gradient start (marketing.css:259, tailwind.config.ts:106)' },
      300: { uses: ['tint', 'art'], replaces: '#9FBFEE, #85AAE6, #8FB4E9 gradient middle and end (marketing.css:259, tailwind.config.ts:106)' },
      500: { uses: ['under white', 'fill', 'art'], replaces: '#6D9BF2, #4C7EF3 featured and deep gradient starts (marketing.css:862, tailwind.config.ts:108)' },
      600: { uses: ['text', 'focus', 'fill', 'under white'], replaces: '#3B71F0 accent, preserve, info (globals.css:19, 24, 32)' },
      700: { uses: ['text', 'fill', 'under white'], replaces: '#2554CC accent-strong and glow (globals.css:20, marketing.css:258, 862)' },
      800: { uses: ['text', 'fill', 'under white'], replaces: '#2554CC gradient end (tailwind.config.ts:108)' },
      900: { uses: ['text', 'fill', 'under white'], replaces: 'rgba(20, 60, 150, 0.3) inset art (marketing.css:989)' },
      950: { uses: ['text', 'fill', 'under white'], replaces: 'none (deepest text and card ink)' },
    },
  },
  {
    name: 'apricot',
    prefix: '--palette-apricot-',
    hueBand: [18, 34],
    steps: {
      50: { uses: ['tint', 'art'], replaces: 'none (spend surfaces)' },
      100: { uses: ['tint', 'art'], replaces: 'none (spend tiles and chips)' },
      200: { uses: ['tint', 'border', 'art'], replaces: 'none' },
      300: { uses: ['art'], replaces: 'none' },
      400: { uses: ['art'], replaces: 'none' },
      500: { uses: ['fill', 'art'], replaces: 'none (the spend mark)' },
      600: { uses: ['fill', 'art'], replaces: 'none' },
      700: { uses: ['text', 'fill'], replaces: 'none (spend words on tints)' },
      800: { uses: ['text', 'fill'], replaces: 'none' },
      900: { uses: ['text', 'fill'], replaces: 'none' },
    },
  },
];

/**
 * The band the green scale skips. Sampled on a grid: every in-gamut color in it must sit within
 * MIN_DELTA_E of a reference, which is why the scale has no 400.
 */
export const GAP_RULE = { L: [0.6, 0.84], h: [163, 171], minC: 0.1, step: { L: 0.005, h: 0.5, C: 0.005 } };

/** @param {string[]} bgs @param {string} fg @param {number} min @param {string} use */
const pairsOn = (bgs, fg, min, use) => bgs.map((bg) => ({ fg, bg, min, use }));

/**
 * Every pair DESIGN.md relies on. `over` composites a translucent token onto an opaque backdrop: the
 * chrome bar is measured over ink, its worst case when dark content scrolls under it.
 * @typedef {string | { over: string, on: string }} Backdrop
 * @typedef {{ fg: string, bg: Backdrop, min: number, use: string }} Pair
 * @type {Pair[]}
 */
export const REQUIRED_PAIRS = [
  // Text, 4.5:1
  ...pairsOn([...TEXT_SURFACES, '--color-selection'], '--color-ink', AA_TEXT, 'body text'),
  { fg: '--color-ink', bg: { over: '--color-shell-raised', on: '--color-shell' }, min: AA_TEXT, use: 'body text on rail cards' },
  { fg: '--color-ink', bg: { over: '--color-chrome', on: '--color-ink' }, min: AA_TEXT, use: 'nav label, active' },
  ...pairsOn(TEXT_SURFACES, '--color-ink-secondary', AA_TEXT, 'secondary text'),
  { fg: '--color-ink-secondary', bg: { over: '--color-shell-raised', on: '--color-shell' }, min: AA_TEXT, use: 'secondary text on rail cards' },
  { fg: '--color-ink-secondary', bg: { over: '--color-chrome', on: '--color-ink' }, min: AA_TEXT, use: 'nav label, inactive' },
  ...pairsOn(['--color-canvas', '--color-surface-muted', '--color-info-soft', '--color-equity-surface', '--color-spend-surface'], '--color-ink-muted', AA_TEXT, 'meta text, hints, timestamps'),
  { fg: '--color-ink-muted', bg: { over: '--color-shell-raised', on: '--color-shell' }, min: AA_TEXT, use: 'meta text on rail cards' },
  ...pairsOn(TEXT_SURFACES, '--color-accent-text', AA_TEXT, 'green text'),
  { fg: '--color-accent-strong', bg: '--color-accent-soft', min: AA_TEXT, use: 'green glyph tile (closeout m-provider-stripe)' },
  ...pairsOn(['--color-canvas', '--color-surface-muted', '--color-info-soft', '--color-equity-surface'], '--color-link', AA_TEXT, 'inline link'),
  ...pairsOn(['--color-canvas', '--color-surface-muted'], '--color-link-hover', AA_TEXT, 'inline link, hover'),
  ...pairsOn(['--color-canvas', '--color-equity-soft', '--color-equity-surface', '--color-surface-muted'], '--color-equity-text', AA_TEXT, 'equity words and tile glyphs'),
  ...pairsOn(['--color-canvas', '--color-spend-soft', '--color-spend-surface', '--color-surface-muted'], '--color-spend-text', AA_TEXT, 'spend words and tile glyphs'),
  ...pairsOn(['--color-success-soft', '--color-canvas'], '--color-success-text', AA_TEXT, 'success tag'),
  ...pairsOn(['--color-info-soft', '--color-canvas'], '--color-info-text', AA_TEXT, 'info tag'),
  ...pairsOn(['--color-warning-soft', '--color-canvas', '--color-surface-muted'], '--color-warning-text', AA_TEXT, 'waiting and warning text'),
  ...pairsOn(['--color-waiting-soft', '--color-canvas'], '--color-waiting-text', AA_TEXT, 'waiting tag'),
  ...pairsOn(['--color-danger-soft', '--color-canvas', '--color-surface-muted'], '--color-danger-text', AA_TEXT, 'error and refused text'),
  ...pairsOn(['--color-brand', '--color-brand-strong'], '--color-on-brand', AA_TEXT, 'primary button label'),
  ...pairsOn(['--color-accent', '--color-accent-strong', '--color-success', '--palette-green-900'], '--color-on-accent', AA_TEXT, 'white on green fills, the verified check and the solid glass fallback'),
  ...pairsOn(['--color-danger', '--color-danger-strong'], '--color-on-danger', AA_TEXT, 'destructive button label'),

  // UI components and graphics, 3:1
  ...pairsOn([...TEXT_SURFACES, '--color-brand'], '--color-focus', AA_NON_TEXT, 'focus ring'),
  { fg: '--color-focus', bg: { over: '--color-chrome', on: '--color-ink' }, min: AA_NON_TEXT, use: 'focus ring in the nav bar' },
  ...pairsOn(['--color-brand', '--color-accent', '--color-accent-strong', '--palette-green-500', '--palette-green-800'], '--color-focus-inverse', AA_NON_TEXT, 'focus ring on black and green fills'),
  ...pairsOn(['--color-canvas', '--color-surface-muted'], '--color-border-control', AA_NON_TEXT, 'input and checkbox boundary'),
  ...pairsOn(['--color-canvas', '--color-surface-muted', '--color-surface-strong', '--color-shell', '--color-equity-surface'], '--color-equity', AA_NON_TEXT, 'equity segment, dot, icon, chart line'),
  ...pairsOn(['--color-canvas', '--color-surface-muted', '--color-surface-strong', '--color-spend-surface'], '--color-spend', AA_NON_TEXT, 'spend segment, dot, chart bar'),
  ...pairsOn(['--color-canvas', '--color-surface-muted', '--color-waiting-soft'], '--color-waiting', AA_NON_TEXT, 'waiting stripes and icon'),
  ...pairsOn(['--color-canvas', '--color-danger-soft'], '--color-danger', AA_NON_TEXT, 'error icon and fill'),
  ...pairsOn(['--color-canvas', '--color-surface-muted'], '--color-ink-muted', AA_NON_TEXT, 'icon glyphs'),
  ...pairsOn(['--color-canvas', '--color-surface-muted'], '--color-brand', AA_NON_TEXT, 'selected pill, active tab bar'),
  ...pairsOn(['--color-canvas'], '--color-success', AA_NON_TEXT, 'verified check circle'),
  ...['--color-chart-spend', '--color-chart-equity', '--color-chart-waiting'].map((fg) => ({ fg, bg: '--color-canvas', min: AA_NON_TEXT, use: 'chart series' })),
];

/**
 * Gradients that carry text. Their stops must be opaque so each can be measured; the worst stop is
 * the result.
 * @type {{ token: string, text: { fg: string, min: number, use: string }[] }[]}
 */
export const GRADIENT_TEXT = [
  {
    token: '--gradient-feature',
    text: [
      { fg: '--color-on-accent', min: AA_TEXT, use: 'feature card text' },
      { fg: '--color-focus-inverse', min: AA_NON_TEXT, use: 'focus ring on the feature card' },
    ],
  },
  {
    token: '--gradient-accent-deep',
    text: [
      { fg: '--color-on-accent', min: AA_TEXT, use: 'text on the deep band' },
      { fg: '--color-focus-inverse', min: AA_NON_TEXT, use: 'focus ring on the deep band' },
    ],
  },
  {
    token: '--gradient-hero',
    text: [
      { fg: '--color-ink', min: AA_TEXT, use: 'text on the mint wash' },
      { fg: '--color-ink-secondary', min: AA_TEXT, use: 'secondary text on the mint wash' },
      { fg: '--color-focus', min: AA_NON_TEXT, use: 'focus ring on the mint wash' },
    ],
  },
  {
    token: '--gradient-apricot',
    text: [
      { fg: '--color-ink', min: AA_TEXT, use: 'text on the apricot wash' },
      { fg: '--color-ink-secondary', min: AA_TEXT, use: 'secondary text on the apricot wash' },
      { fg: '--color-focus', min: AA_NON_TEXT, use: 'focus ring on the apricot wash' },
    ],
  },
];

/** Gradients that never carry text directly, and where their text goes instead. */
export const GRADIENT_NO_TEXT = [
  { token: '--gradient-stage', note: 'hero app stage: text sits on white cards floating on it' },
  { token: '--gradient-step', note: 'step panel: text sits on --glass-deep at the foot of the panel' },
  { token: '--gradient-art-on-accent', note: 'decorative inset inside the feature card' },
  { token: '--gradient-art-neutral', note: 'hero notes panel: text sits on white cards floating on it' },
];

/**
 * Glass over arbitrary art. Each text pair is measured with the glass composited over the backdrop
 * that is worst for it, so the pair holds wherever the glass is placed.
 * @type {{ token: string, backdrop: string, backdropLabel: string, text: { fg: string, min: number, use: string }[] }[]}
 */
export const GLASS_TEXT = [
  {
    token: '--glass-deep',
    backdrop: '#ffffff',
    backdropLabel: 'white',
    text: [
      { fg: '--color-on-accent', min: AA_TEXT, use: 'white text on deep glass' },
      { fg: '--color-focus-inverse', min: AA_NON_TEXT, use: 'focus ring on deep glass' },
    ],
  },
  {
    token: '--glass-light',
    backdrop: '#000000',
    backdropLabel: 'black',
    text: [
      { fg: '--color-ink', min: AA_TEXT, use: 'text on light glass' },
      { fg: '--color-ink-secondary', min: AA_TEXT, use: 'secondary text on light glass' },
      { fg: '--color-focus', min: AA_NON_TEXT, use: 'focus ring on light glass' },
    ],
  },
];

/**
 * The split's marks must stay apart for people with the two common color-vision deficiencies, and the
 * warm marks must stay apart from each other and from danger.
 * @type {{ a: string, b: string, measure: 'cvd' | 'normal' | 'de2000', min: number, use: string }[]}
 */
export const SPLIT_CHECKS = [
  { a: '--color-spend', b: '--color-equity', measure: 'cvd', min: CVD_TARGET, use: 'spend and equity segments side by side, protan and deutan' },
  { a: '--color-spend', b: '--color-equity', measure: 'normal', min: NORMAL_VISION_FLOOR, use: 'spend and equity segments, full color vision' },
  { a: '--color-spend', b: '--color-waiting', measure: 'de2000', min: MIN_DELTA_E, use: 'spend mark and waiting stripes; waiting is also always hatched' },
  { a: '--color-spend', b: '--color-danger', measure: 'de2000', min: 15, use: 'spend mark and the danger red' },
  { a: '--color-equity', b: '--color-waiting', measure: 'cvd', min: CVD_TARGET, use: 'equity segment beside the waiting stripes, protan and deutan' },
];

/** Measured and printed, never relied on. Each line says what carries the meaning instead. */
export const INFO_PAIRS = [
  { fg: '--color-spend', bg: '--color-equity', note: 'spend and equity segments: a 2px gap, hue and the color-vision distance above separate them' },
  { fg: '--color-equity', bg: '--color-waiting', note: 'equity and waiting segments: a 2px gap and the waiting stripes separate them' },
  { fg: '--color-on-accent', bg: '--color-spend', note: 'no text on the spend fill; spend words use spend-text on a tint' },
  { fg: '--color-on-accent', bg: '--palette-green-300', note: 'never white on mint: mint carries ink' },
  { fg: '--color-ink-muted', bg: '--color-accent-soft', note: 'not allowed: use ink-secondary on the green-100 tint' },
  { fg: '--color-ink-muted', bg: '--color-spend-soft', note: 'not allowed: use ink-secondary on the apricot-100 tint' },
  { fg: '--color-ink-muted', bg: '--color-surface-strong', note: 'not allowed: use ink-secondary on surface-strong' },
  { fg: '--color-ink-muted', bg: '--color-shell', note: 'not allowed: use ink-secondary on the shell' },
  { fg: '--color-border-control', bg: '--color-surface-strong', note: 'not allowed: inputs sit on canvas or surface-muted' },
  { fg: '--color-warning', bg: '--color-canvas', note: 'warning fill is not a text color: text uses warning-text' },
  { fg: '--color-danger', bg: '--color-danger-soft', note: 'danger fill is not a text color on its soft tint: text uses danger-text' },
  { fg: '--color-border-strong', bg: '--color-canvas', note: 'hairline divider, decorative' },
];

// ---------- run ----------

/** Truncated to two decimals, so a printed ratio never overstates. @param {number} n */
export const fmt = (n) => (Math.floor(n * 100) / 100).toFixed(2);

/** @param {string} name */
export const short = (name) => name.replace(/^--color-/, '').replace(/^--palette-/, '').replace(/^--/, '');

/** @param {Backdrop} bg */
const backdropLabel = (bg) => (typeof bg === 'string' ? short(bg) : `${short(bg.over)} over ${short(bg.on)}`);

/**
 * @typedef {{ step: string, token: string, hex: string, hsl: Hsl, oklch: Oklch, onWhite: number, uses: string[], replaces: string, problems: string[] }} ScaleRow
 * @typedef {{ step: string, token: string, hex: string, hue: number, distances: number[], problems: string[] }} DistanceRow
 * @typedef {{ fg: string, bg: string, fgHex: string, bgHex: string, ratio: number, min: number, use: string, pass: boolean }} PairResult
 * @typedef {{ token: string, stops: string[], fg: string, fgHex: string, ratios: number[], worst: number, min: number, use: string, pass: boolean }} GradientResult
 * @typedef {{ token: string, glassHex: string, backdropLabel: string, composite: string, fg: string, fgHex: string, ratio: number, min: number, use: string, pass: boolean }} GlassResult
 * @typedef {{ a: string, b: string, aHex: string, bHex: string, measure: string, value: number, detail: string, min: number, use: string, pass: boolean }} SplitResult
 * @typedef {{ fg: string, bg: string, ratio: number, note: string }} InfoResult
 * @typedef {{
 *   scales: { name: string, hueBand: number[], rows: ScaleRow[] }[],
 *   references: { hex: string, name: string, source: string, hue: number, onWhite: number }[],
 *   distances: { name: string, rows: DistanceRow[] }[],
 *   gap: { largest: number, at: string, samples: number, pass: boolean },
 *   literals: { distinct: number, chromatic: number, translucent: number },
 *   pairs: PairResult[],
 *   gradients: GradientResult[],
 *   noText: { token: string, note: string }[],
 *   glass: GlassResult[],
 *   split: SplitResult[],
 *   info: InfoResult[],
 *   failures: string[],
 *   checks: number,
 * }} Report
 */

/**
 * Runs every check against the text of tokens.css.
 * @param {string} rawCss
 * @returns {Report}
 */
export function checkTokens(rawCss) {
  const css = stripComments(rawCss);
  const tokens = readRootTokens(css);
  /** @type {string[]} */
  const failures = [];
  let checks = 0;

  /** @param {string} name @returns {Rgba} */
  const colorOf = (name) => {
    const raw = tokens.get(name);
    if (raw === undefined) throw new TokenError(`token ${name} is not defined`);
    const color = parseColor(resolveVars(raw, tokens));
    if (!color) throw new TokenError(`token ${name} is not a single color: ${raw}`);
    return color;
  };
  /** @param {string} name */
  const opaque = (name) => {
    const color = colorOf(name);
    if (color.a !== 1) throw new TokenError(`token ${name} is translucent; measure it with { over, on }`);
    return color;
  };
  /** @param {Backdrop} bg */
  const backdrop = (bg) => (typeof bg === 'string' ? opaque(bg) : over(colorOf(bg.over), opaque(bg.on)));
  const white = /** @type {Rgba} */ (parseColor('#ffffff'));
  const references = REFERENCES.map((ref) => ({ ...ref, color: /** @type {Rgba} */ (parseColor(ref.hex)) }));

  // 1. Scales: hue band and allowed uses
  const scales = SCALES.map((scale) => {
    const rows = Object.entries(scale.steps).map(([step, spec]) => {
      const token = `${scale.prefix}${step}`;
      const color = opaque(token);
      const h = hsl(color);
      /** @type {string[]} */
      const problems = [];
      checks += 1;
      if (h.h < scale.hueBand[0] || h.h > scale.hueBand[1]) problems.push(`hue ${h.h.toFixed(1)} outside ${scale.hueBand[0]} to ${scale.hueBand[1]}`);
      for (const use of spec.uses) {
        const rule = USE_RULES[use];
        if (!rule) throw new TokenError(`unknown use ${use}`);
        for (const bg of rule.on ?? []) {
          const ratio = contrast(color, opaque(bg));
          if (ratio < (rule.min ?? 0)) problems.push(`${use} on ${short(bg)} is ${fmt(ratio)}, needs ${rule.min}`);
        }
        for (const fg of [...(rule.under ?? []), ...(rule.carries ?? [])]) {
          const ratio = contrast(opaque(fg), color);
          if (ratio < (rule.min ?? 0)) problems.push(`${short(fg)} on it is ${fmt(ratio)}, needs ${rule.min}`);
        }
      }
      problems.forEach((p) => failures.push(`${scale.name}-${step}: ${p}`));
      return { step, token, hex: toHex(color), hsl: h, oklch: oklch(color), onWhite: contrast(color, white), uses: spec.uses, replaces: spec.replaces, problems };
    });
    return { name: scale.name, hueBand: scale.hueBand, rows };
  });

  // 2. Distance from the reference colors
  const distances = scales.map((scale) => ({
    name: scale.name,
    rows: scale.rows.map((row) => {
      const color = opaque(row.token);
      const h = row.hsl.h;
      const values = references.map((ref) => deltaE2000(color, ref.color));
      /** @type {string[]} */
      const problems = [];
      checks += 1;
      if (h >= NEON_BAND[0] && h <= NEON_BAND[1]) problems.push(`hue ${h.toFixed(1)} inside the Robin Neon band`);
      values.forEach((d, k) => {
        if (d < MIN_DELTA_E) problems.push(`CIEDE2000 ${d.toFixed(1)} to ${references[k].hex.toUpperCase()} is under ${MIN_DELTA_E}`);
      });
      problems.forEach((p) => failures.push(`${scale.name}-${row.step}: ${p}`));
      return { step: row.step, token: row.token, hex: row.hex, hue: h, distances: values, problems };
    }),
  }));

  // 3. The skipped green band
  let largest = 0;
  let at = '';
  let samples = 0;
  for (let L = GAP_RULE.L[0]; L <= GAP_RULE.L[1] + 1e-9; L += GAP_RULE.step.L) {
    for (let h = GAP_RULE.h[0]; h <= GAP_RULE.h[1] + 1e-9; h += GAP_RULE.step.h) {
      for (let C = GAP_RULE.minC; C <= 0.4; C += GAP_RULE.step.C) {
        const { color, inGamut } = fromOklch({ L, C, h });
        if (!inGamut) break;
        samples += 1;
        const nearest = Math.min(...references.map((ref) => deltaE2000(color, ref.color)));
        if (nearest > largest) {
          largest = nearest;
          at = `${toHex(color)} (OKLCH ${L.toFixed(3)} ${C.toFixed(3)} ${h.toFixed(1)})`;
        }
      }
    }
  }
  checks += 1;
  const gapPass = largest < MIN_DELTA_E;
  if (!gapPass) failures.push(`gap rule: ${at} is CIEDE2000 ${largest.toFixed(2)} from every reference, so a step could live in the skipped band`);
  if (tokens.has('--palette-green-400')) failures.push('gap rule: --palette-green-400 is defined, but the scale skips that band');

  // 4. Every color literal: no blue, nothing in the neon band, nothing near a reference; translucent
  //    literals are white, ink or a palette step at an alpha
  const literals = [...css.matchAll(HEX), ...css.matchAll(RGB)].map((m) => m[0]);
  const unique = [...new Set(literals.map((l) => l.toLowerCase().replace(/\s+/g, ' ')))];
  const paletteRgb = new Set(
    [...tokens.keys()]
      .filter((name) => name.startsWith('--palette-'))
      .map((name) => toHex(opaque(name))),
  );
  ['#FFFFFF', '#0B0B0C'].forEach((hex) => paletteRgb.add(hex));
  let chromatic = 0;
  let translucent = 0;
  for (const literal of unique) {
    checks += 1;
    const color = parseColor(literal);
    if (!color) {
      failures.push(`cannot parse color literal ${literal}`);
      continue;
    }
    if (color.a < 1) {
      translucent += 1;
      if (!paletteRgb.has(toHex(color))) failures.push(`${literal} is translucent but its color is not white, ink or a palette step`);
    }
    const { h } = hsl(color);
    const { C } = oklch(color);
    if (C < CHROMATIC_OKLCH_C) continue;
    chromatic += 1;
    if (h >= BLUE_BAND[0] && h <= BLUE_BAND[1]) failures.push(`${literal} is a blue (HSL hue ${h.toFixed(1)}, OKLCH chroma ${C.toFixed(3)})`);
    if (h >= NEON_BAND[0] && h <= NEON_BAND[1]) failures.push(`${literal} sits in the Robin Neon hue band (HSL hue ${h.toFixed(1)})`);
    for (const ref of references) {
      const d = deltaE2000(color, ref.color);
      if (d < MIN_DELTA_E) failures.push(`${literal} is within CIEDE2000 ${d.toFixed(1)} of ${ref.hex.toUpperCase()}`);
    }
  }

  // 5. Pairs
  const pairs = REQUIRED_PAIRS.map((pair) => {
    const fg = opaque(pair.fg);
    const bg = backdrop(pair.bg);
    const ratio = contrast(fg, bg);
    const pass = ratio >= pair.min;
    checks += 1;
    if (!pass) failures.push(`${short(pair.fg)} on ${backdropLabel(pair.bg)} is ${fmt(ratio)}, needs ${pair.min} (${pair.use})`);
    return { fg: short(pair.fg), bg: backdropLabel(pair.bg), fgHex: toHex(fg), bgHex: toHex(bg), ratio, min: pair.min, use: pair.use, pass };
  });

  // 6. Text on gradients
  /** @type {GradientResult[]} */
  const gradients = [];
  for (const gradient of GRADIENT_TEXT) {
    const raw = tokens.get(gradient.token);
    if (raw === undefined) throw new TokenError(`token ${gradient.token} is not defined`);
    const stops = [...resolveVars(raw, tokens).matchAll(ANY_COLOR)].map((m) => /** @type {Rgba} */ (parseColor(m[0])));
    if (stops.length < 2) failures.push(`${gradient.token} has fewer than two color stops`);
    if (stops.some((stop) => stop.a !== 1)) failures.push(`${gradient.token} carries text but has a translucent stop`);
    for (const text of gradient.text) {
      const fg = opaque(text.fg);
      const ratios = stops.map((stop) => contrast(fg, stop));
      const worst = Math.min(...ratios);
      const pass = worst >= text.min;
      checks += 1;
      if (!pass) failures.push(`${short(text.fg)} on ${short(gradient.token)} is ${fmt(worst)} at its worst stop, needs ${text.min} (${text.use})`);
      gradients.push({ token: short(gradient.token), stops: stops.map(toHex), fg: short(text.fg), fgHex: toHex(fg), ratios, worst, min: text.min, use: text.use, pass });
    }
  }
  for (const entry of GRADIENT_NO_TEXT) {
    if (!tokens.has(entry.token)) throw new TokenError(`token ${entry.token} is not defined`);
  }

  // 7. Text on glass, over the backdrop that is worst for it
  /** @type {GlassResult[]} */
  const glass = [];
  for (const pane of GLASS_TEXT) {
    const tint = colorOf(pane.token);
    const composite = over(tint, /** @type {Rgba} */ (parseColor(pane.backdrop)));
    for (const text of pane.text) {
      const fg = opaque(text.fg);
      const ratio = contrast(fg, composite);
      const pass = ratio >= text.min;
      checks += 1;
      if (!pass) failures.push(`${short(text.fg)} on ${short(pane.token)} over ${pane.backdropLabel} is ${fmt(ratio)}, needs ${text.min} (${text.use})`);
      glass.push({ token: short(pane.token), glassHex: toHex(tint), backdropLabel: pane.backdropLabel, composite: toHex(composite), fg: short(text.fg), fgHex: toHex(fg), ratio, min: text.min, use: text.use, pass });
    }
  }

  // 8. The split under color-vision deficiency
  const split = SPLIT_CHECKS.map((entry) => {
    const a = opaque(entry.a);
    const b = opaque(entry.b);
    let value;
    let detail;
    if (entry.measure === 'cvd') {
      const protan = okDelta(a, b, 'protan');
      const deutan = okDelta(a, b, 'deutan');
      value = Math.min(protan, deutan);
      detail = `protan ${protan.toFixed(1)}, deutan ${deutan.toFixed(1)} (OKLab x100)`;
    } else if (entry.measure === 'normal') {
      value = okDelta(a, b, 'normal');
      detail = `${value.toFixed(1)} (OKLab x100)`;
    } else {
      value = deltaE2000(a, b);
      detail = `${value.toFixed(1)} (CIEDE2000)`;
    }
    const pass = value >= entry.min;
    checks += 1;
    if (!pass) failures.push(`${short(entry.a)} and ${short(entry.b)}: ${detail}, needs ${entry.min} (${entry.use})`);
    return { a: short(entry.a), b: short(entry.b), aHex: toHex(a), bHex: toHex(b), measure: entry.measure, value, detail, min: entry.min, use: entry.use, pass };
  });

  const info = INFO_PAIRS.map((pair) => ({ fg: short(pair.fg), bg: short(pair.bg), ratio: contrast(opaque(pair.fg), opaque(pair.bg)), note: pair.note }));

  return {
    scales,
    references: references.map(({ hex, name, source, color }) => ({ hex: hex.toUpperCase(), name, source, hue: hsl(color).h, onWhite: contrast(color, white) })),
    distances,
    gap: { largest, at, samples, pass: gapPass },
    literals: { distinct: unique.length, chromatic, translucent },
    pairs,
    gradients,
    noText: GRADIENT_NO_TEXT.map(({ token, note }) => ({ token: short(token), note })),
    glass,
    split,
    info,
    failures,
    checks,
  };
}

/**
 * The report as the Markdown DESIGN.md section 3 carries.
 * @param {Report} report @param {string} tokensLabel
 */
export function toMarkdown(report, tokensLabel) {
  /** @type {string[]} */
  const lines = [];
  /** @param {string} [s] */
  const out = (s = '') => lines.push(s);
  const pass = (/** @type {boolean} */ ok) => (ok ? 'pass' : 'FAIL');

  out(`Tokens: ${tokensLabel}`);
  out();
  for (const scale of report.scales) {
    out(`### ${scale.name[0].toUpperCase()}${scale.name.slice(1)} scale`);
    out();
    out(`HSL hue band ${scale.hueBand[0]} to ${scale.hueBand[1]}.`);
    out();
    out('| Step | Hex | HSL | OKLCH | On white | Allowed uses | Stands in for (closeout) | Rules |');
    out('| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const row of scale.rows) {
      out(
        `| ${row.step} | ${row.hex} | ${row.hsl.h.toFixed(1)}, ${row.hsl.s.toFixed(0)}%, ${row.hsl.l.toFixed(0)}% | ${row.oklch.L.toFixed(3)} ${row.oklch.C.toFixed(3)} ${row.oklch.h.toFixed(1)} | ${fmt(row.onWhite)} | ${row.uses.join(', ')} | ${row.replaces} | ${pass(row.problems.length === 0)} |`,
      );
    }
    out();
  }
  out('Use rules: ' + Object.entries(USE_RULES).map(([use, rule]) => `${use} = ${rule.says}`).join('; ') + '.');
  out();

  out('### Distance from reference colors');
  out();
  out('| Reference | Hex | HSL hue | On white | Source |');
  out('| --- | --- | --- | --- | --- |');
  for (const ref of report.references) out(`| ${ref.name} | ${ref.hex} | ${ref.hue.toFixed(1)} | ${fmt(ref.onWhite)} | ${ref.source} |`);
  out();
  for (const scale of report.distances) {
    out(`| ${scale.name} | HSL hue | ${report.references.map((ref) => `CIEDE2000 to ${ref.hex}`).join(' | ')} | Rules |`);
    out(`| --- | --- | ${report.references.map(() => '---').join(' | ')} | --- |`);
    for (const row of scale.rows) out(`| ${row.step} | ${row.hue.toFixed(1)} | ${row.distances.map((d) => d.toFixed(1)).join(' | ')} | ${pass(row.problems.length === 0)} |`);
    out();
  }
  out(
    `Skipped band: ${report.gap.samples} in-gamut samples with OKLCH lightness ${GAP_RULE.L[0]} to ${GAP_RULE.L[1]}, hue ${GAP_RULE.h[0]} to ${GAP_RULE.h[1]} and chroma ${GAP_RULE.minC} or more; the farthest from every reference is ${report.gap.at} at CIEDE2000 ${report.gap.largest.toFixed(2)}, under ${MIN_DELTA_E}, so no green step can live there. ${pass(report.gap.pass)}.`,
  );
  out();

  out('### Every color literal in the tokens file');
  out();
  out(
    `${report.literals.distinct} distinct literals, ${report.literals.chromatic} of them chromatic (OKLCH chroma ${CHROMATIC_OKLCH_C} or more) and ${report.literals.translucent} translucent. Rules: no chromatic literal with an HSL hue from ${BLUE_BAND[0]} to ${BLUE_BAND[1]} (blue) or ${NEON_BAND[0]} to ${NEON_BAND[1]} (Robin Neon), none within CIEDE2000 ${MIN_DELTA_E} of a reference color, and every translucent literal is white, ink or a palette step at an alpha. The cool greys kept from closeout stay under the chroma floor.`,
  );
  out();

  out('### Contrast pairs DESIGN.md relies on');
  out();
  out('| Foreground | Background | Ratio | Needs | Use | Result |');
  out('| --- | --- | --- | --- | --- | --- |');
  for (const pair of report.pairs) out(`| ${pair.fg} | ${pair.bg} | ${fmt(pair.ratio)} | ${pair.min} | ${pair.use} | ${pass(pair.pass)} |`);
  out();

  out('### Text on gradients and glass');
  out();
  out('Gradients that carry text are measured at every stop; the worst stop decides. Glass is measured composited over the backdrop that is worst for the text: white under deep glass, black under light glass.');
  out();
  out('| Surface | Stops or composite | Foreground | Worst ratio | Needs | Use | Result |');
  out('| --- | --- | --- | --- | --- | --- | --- |');
  for (const g of report.gradients) out(`| ${g.token} | ${g.stops.join(', ')} | ${g.fg} | ${fmt(g.worst)} | ${g.min} | ${g.use} | ${pass(g.pass)} |`);
  for (const g of report.glass) out(`| ${g.token} over ${g.backdropLabel} | ${g.composite} | ${g.fg} | ${fmt(g.ratio)} | ${g.min} | ${g.use} | ${pass(g.pass)} |`);
  out();
  out('No text directly on: ' + report.noText.map((entry) => `${entry.token} (${entry.note})`).join('; ') + '.');
  out();

  out('### The split under color-vision deficiency');
  out();
  out('Protan and deutan are simulated with Machado, Oliveira and Fernandes (2009) at severity 1.0 and measured in OKLab x100, the units and thresholds of the dataviz method (target 8, full-vision floor 15).');
  out();
  out('| Pair | Hex | Measure | Value | Needs | Use | Result |');
  out('| --- | --- | --- | --- | --- | --- | --- |');
  for (const s of report.split) out(`| ${s.a} and ${s.b} | ${s.aHex}, ${s.bHex} | ${s.measure} | ${s.detail} | ${s.min} | ${s.use} | ${pass(s.pass)} |`);
  out();

  out('### Measured, not relied on');
  out();
  out('| Foreground | Background | Ratio | Why it does not matter |');
  out('| --- | --- | --- | --- |');
  for (const pair of report.info) out(`| ${pair.fg} | ${pair.bg} | ${fmt(pair.ratio)} | ${pair.note} |`);
  out();

  out(report.failures.length ? `Result: FAIL, ${report.failures.length} problem(s) in ${report.checks} checks.` : `Result: pass, ${report.checks} checks, 0 failures.`);
  report.failures.forEach((failure) => out(`- ${failure}`));
  return `${lines.join('\n')}\n`;
}
