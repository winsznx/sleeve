import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { SampleDataNotice } from '@/components/sample-data-notice';
import { SiteFooter } from '@/components/site-footer';
import { DataLayerProvider } from '@/data/provider';
import { DATA_SOURCE } from '@/data/source';
import { BRAND_NAME } from '@/lib/copy';

import { ibmPlexMono, instrumentSans } from './fonts';
import '../styles/tokens.css';
import './globals.css';

export const metadata: Metadata = {
  title: { default: BRAND_NAME, template: `%s | ${BRAND_NAME}` },
  description: 'A payment address on Robinhood Chain that invests part of every payment.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  colorScheme: 'light',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${instrumentSans.variable} ${ibmPlexMono.variable}`}>
      <body className="flex min-h-dvh flex-col">
        <DataLayerProvider>
          {DATA_SOURCE === 'mock' ? <SampleDataNotice /> : null}
          <div className="flex flex-1 flex-col">{children}</div>
          <SiteFooter />
        </DataLayerProvider>
      </body>
    </html>
  );
}
