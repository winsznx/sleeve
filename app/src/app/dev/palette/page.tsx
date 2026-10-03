import type { Metadata } from 'next';
import type { JSX, ReactNode } from 'react';

import { SplitRail } from '@/components/sleeve/split-rail';
import { cx } from '@/components/ui/cx';
import { fmt } from '@/styles/contrast.mjs';

import { KitSection } from '../kit/kit-section';
import { loadPaletteData, type PaletteReport, type SemanticSwatch } from './palette-data';

export const metadata: Metadata = { title: 'Palette' };

// Prerendered: a build reads tokens.css once from disk, dev reads it on every request.
export const dynamic = 'force-static';

const SEMANTIC_GROUPS: { title: string; tokens: string[] }[] = [
  {
    title: 'Surfaces',
    tokens: ['canvas', 'surface', 'surface-muted', 'surface-strong', 'shell', 'shell-raised', 'chrome', 'scrim', 'selection'],
  },
  { title: 'Borders', tokens: ['border', 'border-strong', 'border-control'] },
  { title: 'Ink and brand', tokens: ['ink', 'ink-secondary', 'ink-muted', 'brand', 'brand-strong'] },
  {
    title: 'Accent, links and focus',
    tokens: ['accent', 'accent-strong', 'accent-soft', 'accent-border', 'accent-text', 'link', 'link-hover', 'focus'],
  },
  {
    title: 'Spend, apricot',
    tokens: ['spend', 'spend-soft', 'spend-surface', 'spend-border', 'spend-text'],
  },
  {
    title: 'Equity, green',
    tokens: ['equity', 'equity-soft', 'equity-surface', 'equity-border', 'equity-text'],
  },
  { title: 'Waiting, amber', tokens: ['waiting', 'waiting-soft', 'waiting-text'] },
  {
    title: 'Status',
    tokens: [
      'success',
      'success-soft',
      'warning',
      'warning-soft',
      'warning-text',
      'danger',
      'danger-strong',
      'danger-soft',
      'danger-text',
      'info',
      'info-soft',
    ],
  },
  { title: 'Charts', tokens: ['chart-spend', 'chart-equity', 'chart-waiting', 'chart-grid', 'chart-axis', 'chart-area'] },
];

const SCALE_ROLE: Record<string, string> = {
  green: 'Equity, links, focus, success and every place closeout used blue',
  apricot: 'The spend side of the split, the one warm accent',
};

export default async function PalettePage(): Promise<JSX.Element> {
  const { report, swatches } = await loadPaletteData();
  const passed = report.failures.length === 0;

  return (
    <main className="mx-auto w-full max-w-content px-gutter py-10">
      <header className="flex flex-col gap-3">
        <h1 className="text-h1 text-ink">Palette, version 2</h1>
        <p className="max-w-reading text-body text-ink-secondary">
          Every color in app/src/styles/tokens.css, the gradients built from them and every text pairing docs/DESIGN.md
          relies on. The numbers come from app/src/styles/contrast.mjs, the same code that{' '}
          <code className="font-mono text-mono-s">node scripts/contrast-check.mjs</code> runs.
        </p>
        <p
          className={cx(
            'w-fit rounded-pill px-3 py-1 text-body-s font-semibold',
            passed ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger',
          )}
        >
          {passed
            ? `All ${report.checks} checks pass`
            : `${report.failures.length} of ${report.checks} checks fail`}
        </p>
        {passed ? null : (
          <ul className="list-disc pl-5 text-body-s text-danger">
            {report.failures.map((failure) => (
              <li key={failure}>{failure}</li>
            ))}
          </ul>
        )}
      </header>

      <KitSection
        id="scales"
        title="Scales"
        description="The only primitives. Components never read a step directly; the semantic tokens below point at them. The green scale skips 400 on purpose: that band sits too close to reference greens."
      >
        {report.scales.map((scale) => (
          <ScaleStrip key={scale.name} scale={scale} />
        ))}
      </KitSection>

      <KitSection id="semantic" title="Semantic tokens" description="What components use. Tailwind maps each one to bg-, text-, border-, fill- and stroke- utilities.">
        <div className="grid gap-8 md:grid-cols-2">
          {SEMANTIC_GROUPS.map((group) => (
            <div key={group.title} className="min-w-0">
              <h3 className="text-h3 text-ink">{group.title}</h3>
              <ul className="mt-3 grid gap-2">
                {group.tokens.map((name) => {
                  const swatch = swatches.get(`--color-${name}`);
                  return swatch ? <SemanticRow key={name} name={name} swatch={swatch} /> : null;
                })}
              </ul>
            </div>
          ))}
        </div>
      </KitSection>

      <KitSection
        id="gradients"
        title="Gradients"
        description="Closeout's blue fields, turned green. Text sits directly only on the hero wash, the apricot wash, the feature card and the deep band. The stage and the step panel carry white cards or deep glass."
      >
        <GradientGallery />
      </KitSection>

      <KitSection
        id="split"
        title="Spend and equity"
        description="The combination the product is built on. Apricot is the share that stays spendable USDG, green is the share that became Stock Tokens, amber stripes are the equity share waiting as USDG. Every number below is example data."
      >
        <SplitShowcase />
      </KitSection>

      <KitSection
        id="pairs"
        title="Text and focus pairings"
        description="Every pair DESIGN.md relies on, drawn in its real colors. Text needs 4.5:1, focus rings and meaningful graphics need 3:1."
      >
        <PairGrid pairs={report.pairs} />
      </KitSection>

      <KitSection id="gradient-checks" title="Text on gradients and glass" description="Gradients are measured at every stop and the worst stop decides. Glass is measured over the backdrop that is worst for its text.">
        <DataTable
          label="Text on gradients and glass"
          head={['Surface', 'Stops or composite', 'Foreground', 'Worst ratio', 'Needs', 'Use']}
          rows={[
            ...report.gradients.map((g) => [g.token, g.stops.join(', '), g.fg, fmt(g.worst), String(g.min), g.use]),
            ...report.glass.map((g) => [`${g.token} over ${g.backdropLabel}`, g.composite, g.fg, fmt(g.ratio), String(g.min), g.use]),
          ]}
        />
      </KitSection>

      <KitSection
        id="cvd"
        title="The split under color-vision deficiency"
        description="Machado, Oliveira and Fernandes (2009) at severity 1.0, measured in OKLab x100. Target 8 under protan and deutan, 15 with full color vision."
      >
        <DataTable
          label="Split color distances"
          head={['Pair', 'Hex', 'Value', 'Needs', 'Use']}
          rows={report.split.map((s) => [`${s.a} and ${s.b}`, `${s.aHex}, ${s.bHex}`, s.detail, String(s.min), s.use])}
        />
      </KitSection>

      <KitSection
        id="references"
        title="Reference colors kept away"
        description="No palette step or color literal may sit within CIEDE2000 10 of these, and no chromatic literal may sit in HSL hue 60 to 90 or in the blue band 190 to 260. They are listed as text only."
      >
        <DataTable
          label="Reference colors"
          head={['Name', 'Hex', 'HSL hue', 'Source']}
          rows={report.references.map((ref) => [ref.name, ref.hex, ref.hue.toFixed(1), ref.source])}
        />
        <p className="max-w-reading text-body-s text-ink-secondary">
          Skipped band: {report.gap.samples} samples, the farthest from every reference is {report.gap.at} at CIEDE2000{' '}
          {report.gap.largest.toFixed(2)}.
        </p>
      </KitSection>

      <KitSection id="info" title="Measured, not relied on" description="Pairs that fail on purpose, and what carries the meaning instead.">
        <DataTable
          label="Pairs measured but not relied on"
          head={['Foreground', 'Background', 'Ratio', 'Why it does not matter']}
          rows={report.info.map((pair) => [pair.fg, pair.bg, fmt(pair.ratio), pair.note])}
        />
      </KitSection>
    </main>
  );
}

function ScaleStrip({ scale }: { scale: PaletteReport['scales'][number] }): JSX.Element {
  return (
    <div className="min-w-0">
      <h3 className="text-h3 text-ink">
        {scale.name[0]?.toUpperCase()}
        {scale.name.slice(1)}
      </h3>
      <p className="mt-1 text-body-s text-ink-secondary">
        {SCALE_ROLE[scale.name] ?? ''}. HSL hue {scale.hueBand[0]} to {scale.hueBand[1]}.
      </p>
      <ol className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5 lg:grid-cols-10">
        {scale.rows.map((row) => (
          <li key={row.step} className="min-w-0 overflow-hidden rounded-row border border-border">
            <div
              className={cx('flex h-24 items-end p-2.5 text-body-s font-semibold', row.onWhite >= 4.5 ? 'text-on-accent' : 'text-ink')}
              style={{ background: `var(${row.token})` }}
            >
              {row.step}
            </div>
            <div className="flex flex-col gap-0.5 p-2.5">
              <span className="font-mono text-mono-s text-ink">{row.hex}</span>
              <span className="text-label text-ink-secondary">{fmt(row.onWhite)} on white</span>
              <span className="text-label text-ink-muted">{row.uses.join(', ')}</span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function SemanticRow({ name, swatch }: { name: string; swatch: SemanticSwatch }): JSX.Element {
  return (
    <li className="flex items-center gap-3">
      <span
        aria-hidden="true"
        className="size-10 shrink-0 rounded-control border border-border"
        style={{ background: `var(${swatch.token})` }}
      />
      <span className="flex min-w-0 flex-col">
        <span className="font-mono text-mono-s text-ink">{name}</span>
        <span className="text-label text-ink-secondary">
          {swatch.hex}
          {swatch.alias ? `, from ${swatch.alias.replace(/^--(color|palette)-/, '')}` : ''}
        </span>
      </span>
    </li>
  );
}

function GradientTile({
  name,
  span,
  className,
  children,
}: {
  name: string;
  /** Column span from 1024 px on the 12-column gallery grid. */
  span: string;
  className: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <figure className={cx('flex min-w-0 flex-col gap-2', span)}>
      <div className={cx('relative overflow-hidden rounded-card', className)}>{children}</div>
      <figcaption className="font-mono text-mono-s text-ink-secondary">{name}</figcaption>
    </figure>
  );
}

function GradientGallery(): JSX.Element {
  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <GradientTile name="--gradient-hero" span="lg:col-span-7" className="bg-hero p-6 md:p-8">
        <p className="text-body-s font-medium text-ink-secondary">Hero wash</p>
        <p className="mt-2 max-w-[15ch] text-display-l text-ink">Payday, split.</p>
        <p className="mt-3 max-w-reading text-body text-ink-secondary">Ink and ink-secondary only. Never white on mint.</p>
        <span className="mt-5 inline-flex min-h-control items-center rounded-pill bg-brand px-5 text-body font-medium text-on-brand">
          Black pill
        </span>
      </GradientTile>

      <GradientTile name="--gradient-step" span="lg:col-span-5" className="flex min-h-96 flex-col justify-end bg-step p-5">
        <div className="rounded-panel border border-glass-deep-edge bg-glass-deep p-5 text-on-accent backdrop-blur-glass">
          <p className="text-figure-m">Step panel</p>
          <p className="mt-1 text-body-s">White text on deep glass, never on the panel itself.</p>
        </div>
      </GradientTile>

      <GradientTile name="--gradient-stage" span="lg:col-span-7" className="flex min-h-80 items-center justify-center bg-stage p-6">
        <div className="w-full max-w-sm rounded-card bg-surface p-5 shadow-floating">
          <p className="text-body-s text-ink-secondary">Example payment</p>
          <p className="mt-1 text-figure-l tabular-nums text-ink">1,000.00 USDG</p>
          <SplitRail parts={{ spend: 700n, equity: 250n, waiting: 50n }} className="mt-4" />
        </div>
      </GradientTile>

      <GradientTile name="--gradient-feature" span="lg:col-span-5" className="bg-feature p-6 text-on-accent">
        <div className="h-28 rounded-panel border border-glass-deep-edge bg-art-on-accent" aria-hidden="true" />
        <p className="mt-5 text-h2">Feature card</p>
        <p className="mt-1 text-body-s">White text passes on every stop. The inset above is --gradient-art-on-accent.</p>
      </GradientTile>

      <GradientTile name="--gradient-accent-deep" span="lg:col-span-4" className="bg-accent-deep p-6 text-on-accent">
        <p className="text-h2">Deep band</p>
        <p className="mt-1 text-body-s">Closing calls to action and the verified receipt header.</p>
      </GradientTile>

      <GradientTile name="--gradient-apricot" span="lg:col-span-4" className="bg-apricot p-6">
        <p className="text-h2 text-ink">Apricot wash</p>
        <p className="mt-1 text-body-s text-ink-secondary">The spend side in marketing art. Ink only.</p>
      </GradientTile>

      <GradientTile name="--gradient-art-neutral" span="lg:col-span-4" className="flex items-center bg-art-neutral p-6">
        <div className="w-full rounded-module bg-surface p-4 shadow-card">
          <p className="text-body-s font-semibold text-ink">Notes panel</p>
          <p className="text-body-s text-ink-secondary">Kept from closeout as is.</p>
        </div>
      </GradientTile>

      <GradientTile name="--gradient-panel-soft" span="lg:col-span-6" className="bg-panel-soft p-6">
        <p className="text-h3 text-ink">Soft panel</p>
        <p className="mt-1 text-body-s text-ink-secondary">The 24 px grey sections of the landing.</p>
      </GradientTile>

      <GradientTile name="--pattern-waiting" span="lg:col-span-6" className="bg-surface-muted p-6">
        <div className="h-3 rounded-pill bg-waiting-stripes" aria-hidden="true" />
        <p className="mt-3 text-body-s text-ink-secondary">Waiting is always hatched, never a flat amber mark.</p>
      </GradientTile>
    </div>
  );
}

/** Example payments for the chart: spend, equity bought and equity waiting, in whole USDG. */
const EXAMPLE_PAYMENTS = [
  { label: 'Jul 3', spend: 1680, equity: 720, waiting: 0 },
  { label: 'Jul 17', spend: 1680, equity: 410, waiting: 310 },
  { label: 'Jul 31', spend: 1680, equity: 720, waiting: 0 },
  { label: 'Aug 14', spend: 1820, equity: 780, waiting: 0 },
  { label: 'Aug 28', spend: 1820, equity: 0, waiting: 780 },
  { label: 'Sep 11', spend: 1820, equity: 780, waiting: 0 },
];

function SplitShowcase(): JSX.Element {
  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <div className="flex min-w-0 flex-col gap-5 rounded-card border border-border bg-surface p-6 shadow-card lg:col-span-7">
        <div>
          <p className="text-body-s text-ink-secondary">Example: a 2,400.00 USDG payday, rule 70 to spend and 30 to SPY</p>
          <p className="mt-1 text-figure-l tabular-nums text-ink">2,400.00 USDG</p>
        </div>
        <SplitRail parts={{ spend: 1680n, equity: 410n, waiting: 310n }} />
        <dl className="grid gap-4 sm:grid-cols-3">
          <LegendItem dot="bg-spend" amount="1,680.00" tone="text-spend" label="spendable" />
          <LegendItem dot="bg-equity" amount="410.00" tone="text-equity" label="became SPY" />
          <LegendItem dot="bg-waiting-stripes" amount="310.00" tone="text-waiting" label="waiting: price above cap" />
        </dl>
        <p className="text-body-s font-medium text-ink-secondary">SPY Stock Token: debt security, not a share.</p>
      </div>

      <div className="grid min-w-0 gap-4 lg:col-span-5">
        <div className="rounded-module border border-spend-border bg-spend-surface p-5">
          <p className="text-body-s font-semibold text-spend">Spend sleeve</p>
          <p className="mt-1 text-figure-m tabular-nums text-ink">1,680.00 USDG</p>
          <p className="text-body-s text-ink-secondary">Stays USDG in the account.</p>
        </div>
        <div className="rounded-module border border-equity-border bg-equity-surface p-5">
          <p className="text-body-s font-semibold text-equity">Equity sleeve</p>
          <p className="mt-1 text-figure-m tabular-nums text-ink">0.6412 SPY</p>
          <p className="text-body-s text-ink-secondary">Debt security, not a share.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-pill bg-spend-soft px-3 py-1 text-label font-semibold text-spend">Spend</span>
          <span className="rounded-pill bg-equity-soft px-3 py-1 text-label font-semibold text-equity">Filled</span>
          <span className="rounded-pill bg-waiting-soft px-3 py-1 text-label font-semibold text-waiting">Queued</span>
          <span className="rounded-pill bg-danger-soft px-3 py-1 text-label font-semibold text-danger">Refused</span>
        </div>
      </div>

      <figure className="min-w-0 rounded-card border border-border bg-surface p-6 lg:col-span-12">
        <figcaption className="text-body-s text-ink-secondary">
          Chart colors on six example payments in USDG: spend, equity bought and equity waiting, stacked. Dashed lines at 1,000 and 2,000.
        </figcaption>
        <ExampleChart />
      </figure>
    </div>
  );
}

function LegendItem({ dot, amount, tone, label }: { dot: string; amount: string; tone: string; label: string }): JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="flex items-center gap-2 text-body-s text-ink-secondary">
        <span aria-hidden="true" className={cx('size-2.5 rounded-pill', dot)} />
        {label}
      </dt>
      <dd className={cx('text-figure-s tabular-nums', tone)}>{amount}</dd>
    </div>
  );
}

function ExampleChart(): JSX.Element {
  const width = 960;
  const height = 240;
  const max = 2600;
  const band = width / EXAMPLE_PAYMENTS.length;
  const bar = band * 0.42;
  const y = (value: number): number => height * (1 - value / max);

  // Labels live in HTML below the drawing so they keep their size when the SVG scales to the card.
  return (
    <div className="mt-4">
      <svg viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="h-auto w-full">
        <defs>
          <pattern id="palette-waiting" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" className="fill-waiting-soft" />
            <rect width="2" height="6" className="fill-chart-waiting" />
          </pattern>
        </defs>
        {[1000, 2000].map((value) => (
          <line key={value} x1="0" x2={width} y1={y(value)} y2={y(value)} className="stroke-chart-grid" strokeDasharray="3 4" />
        ))}
        {EXAMPLE_PAYMENTS.map((payment, i) => {
          const x = band * i + (band - bar) / 2;
          const spendTop = y(payment.spend);
          const equityTop = y(payment.spend + payment.equity);
          const waitingTop = y(payment.spend + payment.equity + payment.waiting);
          return (
            <g key={payment.label}>
              <rect x={x} y={spendTop} width={bar} height={height - spendTop} rx="4" className="fill-chart-spend" />
              {payment.equity > 0 ? (
                <rect x={x} y={equityTop} width={bar} height={spendTop - equityTop - 3} rx="4" className="fill-chart-equity" />
              ) : null}
              {payment.waiting > 0 ? (
                <rect x={x} y={waitingTop} width={bar} height={equityTop - waitingTop - 3} rx="4" fill="url(#palette-waiting)" />
              ) : null}
            </g>
          );
        })}
      </svg>
      <ol className="mt-2 grid grid-cols-6 border-t border-chart-grid pt-2 text-center text-label tabular-nums text-ink-muted">
        {EXAMPLE_PAYMENTS.map((payment) => (
          <li key={payment.label}>
            <span className="block">{payment.label}</span>
            <span className="sr-only">
              {payment.spend} spend, {payment.equity} became SPY, {payment.waiting} waiting
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function PairGrid({ pairs }: { pairs: PaletteReport['pairs'] }): JSX.Element {
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {pairs.map((pair) => {
        const isText = pair.min >= 4.5;
        return (
          <li key={`${pair.fg}|${pair.bg}|${pair.use}`} className="min-w-0 overflow-hidden rounded-row border border-border">
            <div className="flex min-h-20 items-center gap-3 p-3" style={{ background: pair.bgHex, color: pair.fgHex }}>
              {isText ? (
                <span className="text-h2">Aa</span>
              ) : (
                <span aria-hidden="true" className="size-8 shrink-0 rounded-control" style={{ outline: `2px solid ${pair.fgHex}`, outlineOffset: '2px' }} />
              )}
              <span className="text-body-s">{pair.use}</span>
            </div>
            <div className="flex items-baseline justify-between gap-2 bg-surface px-3 py-2">
              <span className="min-w-0 truncate font-mono text-mono-s text-ink-secondary">
                {pair.fg} on {pair.bg}
              </span>
              <span className={cx('shrink-0 text-label font-semibold tabular-nums', pair.pass ? 'text-ink' : 'text-danger')}>
                {fmt(pair.ratio)} / {pair.min}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function DataTable({ label, head, rows }: { label: string; head: string[]; rows: string[][] }): JSX.Element {
  return (
    <div role="region" aria-label={label} tabIndex={0} className="overflow-x-auto rounded-panel border border-border">
      <table className="w-full min-w-[40rem] text-left text-body-s">
        <thead className="bg-surface-muted text-ink-secondary">
          <tr>
            {head.map((cell) => (
              <th key={cell} scope="col" className="px-4 py-2.5 font-semibold">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={`${row[0]}-${i}`} className="border-t border-border">
              {row.map((cell, j) => (
                <td key={j} className={cx('px-4 py-2.5 align-top', j === 0 ? 'text-ink' : 'text-ink-secondary')}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
