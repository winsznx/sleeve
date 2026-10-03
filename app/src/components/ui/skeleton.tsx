import type { JSX, ReactNode } from 'react';

import { cx } from './cx';

/**
 * Placeholders for a layout that is known (docs/DESIGN.md 11.9): flat blocks the size of the real content, no
 * shimmer, nothing that moves. Never render 0.00 while an amount loads; render a Skeleton in its place.
 */

export interface SkeletonProps {
  /** Width and height. Text lines default to rounded-xs; pass the real radius for blocks. */
  className?: string;
}

export function Skeleton({ className }: SkeletonProps): JSX.Element {
  return <span aria-hidden="true" className={cx('block rounded-xs bg-skeleton', className)} />;
}

export interface SkeletonGroupProps {
  /** Read to screen readers in place of the placeholders: "Loading receipts". */
  label: string;
  children: ReactNode;
  className?: string;
}

/** Wraps skeletons: aria-busy, a status role and a visually hidden label naming what loads. */
export function SkeletonGroup({ label, children, className }: SkeletonGroupProps): JSX.Element {
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/** A few lines of text, the last one shorter, at the line height of body-s. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }): JSX.Element {
  return (
    <span aria-hidden="true" className={cx('flex flex-col gap-2', className)}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className={cx('h-3.5', index === lines - 1 && lines > 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </span>
  );
}
