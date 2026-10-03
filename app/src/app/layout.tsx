import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { SampleDataNotice } from '@/components/sample-data-notice';
import shellStyles from '@/components/shell/shell.module.css';
import { cx } from '@/components/ui/cx';
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

/**
 * Every page: the fonts, the data layer, and while the mock runs the sample data strip above everything. Each route
 * group's layout draws its own frame and footer: the marketing navbar and column footer, the app shell with its
 * footer line, and the public pages' frame. Every one of them prints the disclaimer.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  const mock = DATA_SOURCE === 'mock';
  return (
    <html lang="en" className={`${instrumentSans.variable} ${ibmPlexMono.variable}`}>
      <body className={cx('flex min-h-dvh flex-col', mock && shellStyles.withNotice)}>
        <DataLayerProvider>
          {mock ? <SampleDataNotice /> : null}
          {children}
        </DataLayerProvider>
      </body>
    </html>
  );
}
