import type { JSX } from 'react';

import { Skeleton, SkeletonGroup, SkeletonText } from '@/components/ui/skeleton';

const ROWS = [0, 1, 2, 3] as const;

/** The inbox while transfers load: the list's rows at their real size, flat and still (docs/DESIGN.md 11.9). */
export function InboxSkeleton(): JSX.Element {
  return (
    <SkeletonGroup label="Loading your inbox">
      <Skeleton className="h-6 w-32" />
      <Skeleton className="mt-2 h-3.5 w-full max-w-md" />
      <div className="mt-3 overflow-hidden rounded-panel border border-border bg-surface">
        {ROWS.map((row) => (
          <div key={row} className="border-t border-border px-4 py-3.5 first:border-t-0 md:px-5 md:py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <Skeleton className="h-4 w-40 max-w-full" />
                <Skeleton className="mt-2 h-3.5 w-48 max-w-full" />
              </div>
              <Skeleton className="h-4 w-20 shrink-0" />
            </div>
            <SkeletonText lines={2} className="mt-3" />
          </div>
        ))}
      </div>
    </SkeletonGroup>
  );
}
