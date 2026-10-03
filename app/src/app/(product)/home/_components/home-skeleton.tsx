import type { JSX } from 'react';

import { Card } from '@/components/ui/card';
import { Skeleton, SkeletonGroup, SkeletonText } from '@/components/ui/skeleton';

function SleeveSkeleton({ tone }: { tone: 'surface' | 'muted' }): JSX.Element {
  return (
    <Card as="div" tone={tone}>
      <Skeleton className="h-4 w-28" />
      <Skeleton className="mt-4 h-7 w-44 max-w-full" />
      <Skeleton className="mt-2 h-3.5 w-32" />
    </Card>
  );
}

/**
 * Home while the account loads: the same blocks in the same places, flat and still, so nothing jumps when the
 * numbers arrive. No amount is ever drawn as 0.00 in the meantime (docs/DESIGN.md 11.9).
 */
export function HomeSkeleton(): JSX.Element {
  return (
    <SkeletonGroup label="Loading your account">
      <div className="grid gap-8 xl:grid-cols-2 xl:items-start">
        <div className="flex min-w-0 flex-col gap-8">
          <div>
            <Skeleton className="h-6 w-40" />
            <Card as="div" className="mt-3">
              <Skeleton className="h-5 w-24" />
              <SkeletonText lines={2} className="mt-4" />
              <Skeleton className="mt-4 h-3 w-full rounded-pill" />
              <div className="mt-3 flex gap-8">
                <Skeleton className="h-6 w-28" />
                <Skeleton className="h-6 w-24" />
              </div>
            </Card>
          </div>
          <div className="grid gap-stack sm:grid-cols-2 xl:grid-cols-1">
            <SleeveSkeleton tone="muted" />
            <SleeveSkeleton tone="surface" />
          </div>
        </div>
        <Card as="div">
          <Skeleton className="h-4 w-44" />
          <SkeletonText lines={1} className="mt-3" />
          <div className="mt-4 flex flex-col gap-4 sm:flex-row">
            <Skeleton className="size-48 shrink-0 self-center rounded-row sm:self-start" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="mt-2 h-12 w-full rounded-control" />
            </div>
          </div>
        </Card>
      </div>
    </SkeletonGroup>
  );
}
