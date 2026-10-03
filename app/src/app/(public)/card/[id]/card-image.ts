import { TOTAL_BPS } from '@sleeve/core';

import type { CardContent } from './card-content';

/**
 * Draws a card as a PNG in the browser (PRD 7.10): a 4:5 image, 1080 by 1350, that reads in a chat at phone size.
 * The art is the app's split card floating on a mint stage: the share of pay as the figure, the rail split between
 * spend in ink and equity in green, the debt security line under the headline, and the disclaimer at the foot,
 * because the image travels without the page around it. Colors and fonts come from the page's design tokens, so
 * the image never carries a color of its own.
 */

export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1350;

const INSET = 56;
const PAD = 64;
const LEFT = INSET + PAD;
const RIGHT = CARD_WIDTH - INSET - PAD;
const CONTENT_WIDTH = RIGHT - LEFT;
const TOP = INSET + PAD;
const BOTTOM = CARD_HEIGHT - INSET - PAD;
const RAIL_HEIGHT = 32;
const RAIL_GAP = 8;
const RAIL_MIN_SEGMENT = 24;

interface CardTheme {
  stage: string;
  stageEdge: string;
  surface: string;
  border: string;
  ink: string;
  inkSecondary: string;
  spend: string;
  equity: string;
  equityText: string;
  sans: string;
  mono: string;
}

/** Reads the tokens the image uses from the page. A missing token fails the drawing instead of guessing a color. */
function readTheme(): CardTheme {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string): string => {
    const value = style.getPropertyValue(name).trim();
    if (value === '') throw new Error(`The design token ${name} is not set on this page`);
    return value;
  };
  return {
    stage: token('--color-accent-soft'),
    stageEdge: token('--color-accent-border'),
    surface: token('--color-surface'),
    border: token('--color-border'),
    ink: token('--color-ink'),
    inkSecondary: token('--color-ink-secondary'),
    spend: token('--color-spend'),
    equity: token('--color-equity'),
    equityText: token('--color-equity-text'),
    sans: token('--font-sans'),
    mono: token('--font-mono'),
  };
}

interface TextStyle {
  weight: 400 | 500 | 600;
  size: number;
  lineHeight: number;
  family: 'sans' | 'mono';
  color: string;
  /** Letter spacing in pixels; negative tightens large figures as text-figure does. */
  tracking?: number;
}

/** Splits text into lines no wider than maxWidth. A word wider than a line, such as a hash, breaks anywhere. */
export function wrapLines(text: string, maxWidth: number, measure: (value: string) => number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter((part) => part !== '')) {
    const candidate = line === '' ? word : `${line} ${word}`;
    if (measure(candidate) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line !== '') lines.push(line);
    line = '';
    let rest = word;
    while (measure(rest) > maxWidth && rest.length > 1) {
      let cut = rest.length - 1;
      while (cut > 1 && measure(rest.slice(0, cut)) > maxWidth) cut -= 1;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    line = rest;
  }
  if (line !== '') lines.push(line);
  return lines;
}

class Painter {
  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    private readonly theme: CardTheme,
  ) {}

  private use(style: TextStyle): void {
    const family = style.family === 'mono' ? this.theme.mono : this.theme.sans;
    this.ctx.font = `${style.weight} ${style.size}px ${family}`;
    this.ctx.fillStyle = style.color;
    this.ctx.letterSpacing = `${style.tracking ?? 0}px`;
    this.ctx.textBaseline = 'middle';
  }

  lines(text: string, style: TextStyle, width = CONTENT_WIDTH): string[] {
    this.use(style);
    return wrapLines(text, width, (value) => this.ctx.measureText(value).width);
  }

  width(text: string, style: TextStyle): number {
    this.use(style);
    return this.ctx.measureText(text).width;
  }

  /** Draws lines from `top` and returns the y below the last one. */
  text(lines: readonly string[], style: TextStyle, top: number, align: 'left' | 'right' = 'left'): number {
    this.use(style);
    this.ctx.textAlign = align;
    const x = align === 'left' ? LEFT : RIGHT;
    lines.forEach((line, index) => this.ctx.fillText(line, x, top + style.lineHeight * index + style.lineHeight / 2));
    return top + style.lineHeight * lines.length;
  }

  roundedRect(x: number, y: number, width: number, height: number, radius: number): void {
    const r = Math.min(radius, width / 2, height / 2);
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  fillRounded(x: number, y: number, width: number, height: number, radius: number, color: string): void {
    this.roundedRect(x, y, width, height, radius);
    this.ctx.fillStyle = color;
    this.ctx.fill();
  }
}

/** Spend on the left in ink, the equity share on the right in green; a sliver keeps 24 px so it stays visible. */
function railWidths(equityBps: number): { spend: number; equity: number } {
  if (equityBps <= 0) return { spend: CONTENT_WIDTH, equity: 0 };
  if (equityBps >= TOTAL_BPS) return { spend: 0, equity: CONTENT_WIDTH };
  const usable = CONTENT_WIDTH - RAIL_GAP;
  const equity = Math.min(Math.max(Math.round((usable * equityBps) / TOTAL_BPS), RAIL_MIN_SEGMENT), usable - RAIL_MIN_SEGMENT);
  return { spend: usable - equity, equity };
}

/** The figure's largest and smallest size. It gives up height first when amounts and proof fill the card. */
const FIGURE_SIZE = 216;
const FIGURE_MIN_SIZE = 132;

function paint(ctx: CanvasRenderingContext2D, content: CardContent, theme: CardTheme): void {
  const painter = new Painter(ctx, theme);
  const style = {
    brand: { weight: 600, size: 44, lineHeight: 56, family: 'sans', color: theme.ink, tracking: -0.6 },
    date: { weight: 400, size: 30, lineHeight: 56, family: 'sans', color: theme.inkSecondary },
    headline: { weight: 600, size: 56, lineHeight: 66, family: 'sans', color: theme.ink, tracking: -1 },
    debt: { weight: 500, size: 32, lineHeight: 44, family: 'sans', color: theme.inkSecondary },
    fact: { weight: 400, size: 34, lineHeight: 48, family: 'sans', color: theme.ink },
    railSpend: { weight: 400, size: 30, lineHeight: 42, family: 'sans', color: theme.inkSecondary },
    railEquity: { weight: 500, size: 30, lineHeight: 42, family: 'sans', color: theme.equityText },
    amounts: { weight: 500, size: 34, lineHeight: 48, family: 'sans', color: theme.ink },
    receipts: { weight: 500, size: 30, lineHeight: 42, family: 'mono', color: theme.ink },
    account: { weight: 400, size: 28, lineHeight: 40, family: 'mono', color: theme.inkSecondary },
    verify: { weight: 400, size: 28, lineHeight: 40, family: 'sans', color: theme.inkSecondary },
    disclaimer: { weight: 400, size: 22, lineHeight: 32, family: 'sans', color: theme.inkSecondary },
  } satisfies Record<string, TextStyle>;

  // Measure every block first, so the layout can settle before anything is drawn.
  const headline = painter.lines(content.headline, style.headline);
  const debt = painter.lines(content.debtLine, style.debt);
  const facts = content.facts.flatMap((fact) => painter.lines(fact, style.fact));
  const disclaimer = painter.lines(content.disclaimer, style.disclaimer);
  const labelsFit =
    painter.width(content.spendLabel, style.railSpend) + painter.width(content.equityLabel, style.railEquity) + 32 <= CONTENT_WIDTH;
  const amounts = content.amounts === null ? [] : painter.lines(content.amounts, style.amounts);
  const proof = content.proof;
  const receipts = proof === null ? [] : painter.lines(proof.receipts, style.receipts);
  const verify = proof === null ? [] : painter.lines(proof.verify, style.verify);

  const disclaimerTop = BOTTOM - disclaimer.length * style.disclaimer.lineHeight;
  const hairline = disclaimerTop - 28;
  const headerEnd = TOP + style.brand.lineHeight;
  const groupHeight =
    RAIL_HEIGHT +
    16 +
    style.railSpend.lineHeight * (labelsFit ? 1 : 2) +
    (amounts.length > 0 ? 32 + amounts.length * style.amounts.lineHeight : 0) +
    (proof === null ? 0 : 32 + receipts.length * style.receipts.lineHeight + style.account.lineHeight + verify.length * style.verify.lineHeight);
  const textBelowFigure =
    8 + headline.length * style.headline.lineHeight + 10 + debt.length * style.debt.lineHeight + (facts.length > 0 ? 28 + facts.length * style.fact.lineHeight : 0);
  const room = hairline - 44 - groupHeight - 48 - (headerEnd + 56);
  const figureSize = Math.max(FIGURE_MIN_SIZE, Math.min(FIGURE_SIZE, room - textBelowFigure - 4));
  const figure: TextStyle = { weight: 600, size: figureSize, lineHeight: figureSize + 4, family: 'sans', color: theme.equityText, tracking: -figureSize / 36 };
  // Whatever room is left goes mostly below the figure block, which sits a little above the optical middle.
  const slack = Math.max(0, room - textBelowFigure - figure.lineHeight);

  // The stage and the card on it.
  const stage = ctx.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT);
  stage.addColorStop(0, theme.stage);
  stage.addColorStop(1, theme.stageEdge);
  ctx.fillStyle = stage;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  painter.roundedRect(INSET, INSET, CARD_WIDTH - INSET * 2, CARD_HEIGHT - INSET * 2, 48);
  ctx.fillStyle = theme.surface;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = theme.stageEdge;
  ctx.stroke();

  // Top: brand and date, then the share of pay, what it became, and the debt security line directly under it.
  painter.text([content.brand], style.brand, TOP);
  painter.text([content.dateLine], style.date, TOP, 'right');
  let y = headerEnd + 56 + Math.round(slack * 0.4);
  y = painter.text([content.figure], figure, y);
  y = painter.text(headline, style.headline, y + 8);
  y = painter.text(debt, style.debt, y + 10);
  if (facts.length > 0) y = painter.text(facts, style.fact, y + 28);

  // Foot: the disclaimer under a hairline, because the image travels without the page's footer.
  painter.text(disclaimer, style.disclaimer, disclaimerTop);
  ctx.fillStyle = theme.border;
  ctx.fillRect(LEFT, hairline, CONTENT_WIDTH, 2);

  // Above the foot: the rail and its words, then amounts and proof when the owner chose them.
  y = Math.max(y + 48, hairline - 44 - groupHeight);
  const rail = railWidths(content.equityBps);
  if (rail.spend > 0) painter.fillRounded(LEFT, y, rail.spend, RAIL_HEIGHT, RAIL_HEIGHT / 2, theme.spend);
  if (rail.equity > 0) {
    const x = rail.spend > 0 ? LEFT + rail.spend + RAIL_GAP : LEFT;
    painter.fillRounded(x, y, rail.equity, RAIL_HEIGHT, RAIL_HEIGHT / 2, theme.equity);
  }
  y += RAIL_HEIGHT + 16;
  if (labelsFit) {
    painter.text([content.spendLabel], style.railSpend, y);
    y = painter.text([content.equityLabel], style.railEquity, y, 'right');
  } else {
    y = painter.text([content.spendLabel], style.railSpend, y);
    y = painter.text([content.equityLabel], style.railEquity, y);
  }
  if (amounts.length > 0) y = painter.text(amounts, style.amounts, y + 32);
  if (proof !== null) {
    y = painter.text(receipts, style.receipts, y + 32);
    y = painter.text([proof.account], style.account, y);
    painter.text(verify, style.verify, y);
  }
}

/** The fonts the page already serves. One that fails to load leaves the browser's fallback, not a broken image. */
async function loadFonts(theme: CardTheme): Promise<void> {
  if (typeof document.fonts === 'undefined') return;
  await Promise.allSettled([
    document.fonts.load(`600 64px ${theme.sans}`),
    document.fonts.load(`500 32px ${theme.sans}`),
    document.fonts.load(`400 32px ${theme.sans}`),
    document.fonts.load(`500 32px ${theme.mono}`),
    document.fonts.load(`400 32px ${theme.mono}`),
  ]);
}

function encodePng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) reject(new Error('The card image could not be encoded as PNG'));
      else resolve(blob);
    }, 'image/png');
  });
}

/** Browser only. Rejects when the page has no canvas or no design tokens; the screen then shows the card as text. */
export async function renderCardPng(content: CardContent): Promise<Blob> {
  const theme = readTheme();
  const canvas = document.createElement('canvas');
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('This browser cannot draw the card image');
  await loadFonts(theme);
  paint(ctx, content, theme);
  return encodePng(canvas);
}
