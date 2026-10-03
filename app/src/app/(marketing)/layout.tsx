import type { JSX, ReactNode } from 'react';

import { MarketingHeader } from './marketing-header';

/** Marketing pages: the header, then the page as the main landmark. The root layout prints the disclaimer footer. */
export default function MarketingLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <>
      <MarketingHeader />
      <main id="main-content" tabIndex={-1} className="flex-1 focus-visible:outline-none">
        {children}
      </main>
    </>
  );
}
