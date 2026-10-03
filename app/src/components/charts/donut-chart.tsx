import type { JSX, ReactNode } from 'react';

import { cx } from '@/components/ui/cx';

/**
 * A ring of rounded segments with gaps between them and the figure in its middle, drawn as SVG strokes on one
 * circle each. The middle is HTML laid over the ring, so its text stays crisp and scales with the page. The drawing
 * is decorative: the legend beside it carries every name and number.
 */

export interface DonutSegment {
  id: string;
  value: number;
  /** A stroke utility from the semantic colors: stroke-equity, stroke-accent-strong, stroke-equity/60. */
  tone: string;
}

export interface DonutChartProps {
  segments: readonly DonutSegment[];
  /** The segment to bring forward; the others fade back. Null shows them all alike. */
  activeId?: string | null;
  /** Inside the ring, such as the total and its label. */
  center?: ReactNode;
  className?: string;
}

const VIEW = 100;
const STROKE = 11;
const RADIUS = (VIEW - STROKE) / 2 - 1;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** Round caps reach past each end of a dash by half the stroke, as a share of the ring. */
const CAP = (STROKE / 2 / CIRCUMFERENCE) * 100;
/** Clear space between two segments, as a share of the ring. */
const GAP = 1.6;

export function DonutChart({ segments, activeId = null, center, className }: DonutChartProps): JSX.Element {
  const shown = segments.filter((segment) => segment.value > 0);
  const total = shown.reduce((sum, segment) => sum + segment.value, 0);
  let start = 0;
  const arcs = shown.map((segment) => {
    const share = total === 0 ? 0 : (segment.value / total) * 100;
    const single = shown.length === 1;
    const length = single ? 100 : Math.max(0.001, share - 2 * CAP - GAP);
    const arc = { segment, offset: single ? 0 : start + CAP + GAP / 2, length };
    start += share;
    return arc;
  });

  return (
    <div className={cx('relative aspect-square', className)}>
      <svg viewBox={`0 0 ${VIEW} ${VIEW}`} aria-hidden="true" focusable="false" className="size-full -rotate-90">
        <circle cx={VIEW / 2} cy={VIEW / 2} r={RADIUS} fill="none" strokeWidth={STROKE} className="stroke-surface-muted" />
        {arcs.map(({ segment, offset, length }) => (
          <circle
            key={segment.id}
            cx={VIEW / 2}
            cy={VIEW / 2}
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE}
            strokeLinecap={shown.length === 1 ? 'butt' : 'round'}
            pathLength={100}
            strokeDasharray={`${length} ${100 - length}`}
            strokeDashoffset={-offset}
            className={cx(
              segment.tone,
              'transition-opacity duration-fast ease-standard',
              activeId !== null && activeId !== segment.id && 'opacity-30',
            )}
          />
        ))}
      </svg>
      {center === undefined ? null : (
        <div className="absolute inset-[18%] flex flex-col items-center justify-center text-center">{center}</div>
      )}
    </div>
  );
}
