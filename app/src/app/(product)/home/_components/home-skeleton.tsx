import type { JSX, ReactNode } from 'react';

import { cx } from '@/components/ui/cx';
import { Skeleton, SkeletonGroup, SkeletonText } from '@/components/ui/skeleton';

function CardSkeleton({ className, children }: { className?: string; children: ReactNode }): JSX.Element {
  return (
    <div className={cx('flex min-w-0 flex-col rounded-card border border-border bg-surface p-4 sm:p-5 xl:p-6', className)}>
      <Skeleton className="h-5 w-32" />
      <div className="mt-4 flex flex-1 flex-col">{children}</div>
    </div>
  );
}

/**
 * Home while the account loads: every card of the overview in its place and at about its height, flat and still, so
 * nothing jumps when the numbers arrive. No amount is ever drawn as 0.00 in the meantime (docs/DESIGN.md 11.9).
 */
export function HomeSkeleton(): JSX.Element {
  return (
    <SkeletonGroup label="Loading your account" className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3 xl:gap-5">
      <CardSkeleton className="lg:col-span-2">
        <Skeleton className="h-3 w-full rounded-pill" />
        <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 sm:gap-x-6">
          {[0, 1, 2].map((tile) => (
            <div key={tile} className={tile === 2 ? 'col-span-2 sm:col-span-1' : undefined}>
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="mt-3 h-8 w-32 max-w-full" />
              <SkeletonText lines={2} className="mt-2" />
            </div>
          ))}
        </div>
      </CardSkeleton>
      <CardSkeleton className="lg:col-span-2 xl:col-span-1">
        <SkeletonText lines={2} />
        <Skeleton className="mt-4 h-12 w-full rounded-control" />
        <Skeleton className="mt-4 h-44 w-full flex-1 rounded-row md:hidden xl:block" />
      </CardSkeleton>
      <CardSkeleton className="lg:col-span-2">
        <Skeleton className="h-9 w-56 max-w-full" />
        <Skeleton className="mt-4 h-64 w-full rounded-row" />
      </CardSkeleton>
      <CardSkeleton>
        <Skeleton className="h-72 w-full rounded-row" />
      </CardSkeleton>
    </SkeletonGroup>
  );
}
