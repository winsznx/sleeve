import type { JSX } from 'react';

import { SAMPLE_DATA_LINE } from '@/lib/copy';

/** Shown on every page while the mock data layer is selected, so no sample number passes for a chain read. */
export function SampleDataNotice(): JSX.Element {
  return (
    <div role="note" className="bg-info-soft">
      <p className="mx-auto w-full max-w-content px-gutter py-2 text-body-s text-info">{SAMPLE_DATA_LINE}</p>
    </div>
  );
}
