import type { Metadata } from 'next';
import type { JSX } from 'react';

import { HistoryScreen } from './history-screen';

export const metadata: Metadata = { title: 'History' };

/**
 * Rendered per request, so the filters in the URL reach the server render and the page hydrates in one pass. A
 * static page would need a Suspense boundary around the filters, and that boundary hydrates late: by then the
 * session read has often finished, so its first client render no longer matches the server's HTML.
 */
export const dynamic = 'force-dynamic';

export default function HistoryPage(): JSX.Element {
  return (
    <div className="mx-auto w-full max-w-content">
      <HistoryScreen />
    </div>
  );
}
