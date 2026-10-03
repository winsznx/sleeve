import type { JSX, ReactNode } from 'react';

import { TickerStrip } from '@/components/shell/ticker-strip';
import { SiteFooter } from '@/components/site-footer';

import { MarketingHeader } from './marketing-header';

/**
 * Marketing pages: the navbar, the launch Stock Tokens strip under it at the top of the page, the page as the main
 * landmark, and the column footer with the disclaimer.
 */
export default function MarketingLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <>
      <MarketingHeader />
      <TickerStrip />
      <main id="main-content" tabIndex={-1} className="flex-1 focus-visible:outline-none">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
