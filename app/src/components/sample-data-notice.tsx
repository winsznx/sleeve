import type { JSX } from 'react';

import { SplitMark } from '@/components/ui/wordmark';
import { SAMPLE_DATA_LINE } from '@/lib/copy';

/**
 * Shown on every page while the mock data layer is selected, so no sample number passes for a chain read. A centered
 * strip with the split mark, after Mercury's announcement bar (docs/design/inspiration.md 4.1). From 768 px it stays
 * at the top of the window, one line tall, so the live figures in the sticky bars below it are always labelled; the
 * bars sit under it through --sample-notice-height, which the root layout sets to the same height.
 */
export function SampleDataNotice(): JSX.Element {
  return (
    <div
      role="note"
      className="z-header border-b border-accent-border bg-info-soft md:sticky md:top-0 md:h-[var(--sample-notice-height,2.25rem)]"
    >
      <p className="mx-auto w-full max-w-content text-balance px-gutter py-2 text-center text-body-s font-medium text-info md:flex md:h-full md:items-center md:justify-center md:py-0">
        <SplitMark className="mr-2.5 align-middle" />
        {SAMPLE_DATA_LINE}
      </p>
    </div>
  );
}
