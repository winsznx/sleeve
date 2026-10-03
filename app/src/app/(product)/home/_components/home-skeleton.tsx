import type { JSX } from 'react';

import { Skeleton, SkeletonGroup, SkeletonText } from '@/components/ui/skeleton';

function TileSkeleton(): JSX.Element {
  return (
    <div className="rounded-module border border-border bg-surface-muted">
      <div className="flex gap-3 p-4">
        <Skeleton className="size-icon-tile shrink-0 rounded-row" />
        <div className="min-w-0 flex-1">
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="mt-2 h-7 w-40 max-w-full" />
        </div>
      </div>
      <div className="border-t border-border px-4 py-3">
        <Skeleton className="h-3.5 w-3/4" />
      </div>
      <div className="flex min-h-12 items-center border-t border-border px-4">
        <Skeleton className="h-3.5 w-24" />
      </div>
    </div>
  );
}

/**
 * Home while the account loads: the hero, the two sleeves and the address in their places, flat and still, so nothing
 * jumps when the numbers arrive. No amount is ever drawn as 0.00 in the meantime (docs/DESIGN.md 11.9).
 */
export function HomeSkeleton(): JSX.Element {
  return (
    <SkeletonGroup label="Loading your account" className="flex flex-col gap-8">
      <div className="grid gap-stack xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] xl:items-start">
        <div className="rounded-module border border-border bg-surface p-card md:p-6">
          <Skeleton className="h-3.5 w-24" />
          <div className="mt-3 flex items-center gap-3">
            <Skeleton className="size-icon-tile shrink-0 rounded-pill" />
            <Skeleton className="h-9 w-56 max-w-full" />
          </div>
          <Skeleton className="mt-3 h-3.5 w-64 max-w-full" />
          <Skeleton className="mt-6 h-3 w-full rounded-pill" />
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-36 w-full rounded-row" />
            <Skeleton className="h-36 w-full rounded-row" />
          </div>
        </div>
        <div className="grid gap-stack sm:grid-cols-2 xl:grid-cols-1">
          <TileSkeleton />
          <TileSkeleton />
        </div>
      </div>
      <div className="rounded-module border border-border bg-surface p-card">
        <Skeleton className="h-4 w-44" />
        <SkeletonText lines={1} className="mt-3" />
        <div className="mt-4 flex flex-col gap-4 sm:flex-row">
          <Skeleton className="size-48 shrink-0 self-center rounded-row sm:self-start" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mt-2 h-12 w-full rounded-control" />
          </div>
        </div>
      </div>
    </SkeletonGroup>
  );
}
