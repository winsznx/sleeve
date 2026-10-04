import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { SampleDataNotice } from '@/components/sample-data-notice';
import shellStyles from '@/components/shell/shell.module.css';
import { cx } from '@/components/ui/cx';
import { DataLayerProvider } from '@/data/provider';
import { DATA_SOURCE } from '@/data/source';
import { BRAND_NAME } from '@/lib/copy';
import { THEME_BOOT_SCRIPT } from '@/styles/theme';

import { ibmPlexMono, instrumentSans } from './fonts';
import '../styles/tokens.css';
import '../generated/brand/sleeve-logo.css';
import './globals.css';

export const metadata: Metadata = {
  // Link previews need absolute image URLs, and without a base Next writes localhost into og:image. The Cloudflare
  // build sets NEXT_PUBLIC_SITE_URL to https://trysleeve.xyz (D-034).
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'),
  title: { default: BRAND_NAME, template: `%s | ${BRAND_NAME}` },
  description: 'A payment address on Robinhood Chain that invests part of every payment.',
  openGraph: { type: 'website', siteName: BRAND_NAME },
  // The icons come from the brand kit through the file conventions in this folder (D-037).
  manifest: '/site.webmanifest',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // Both themes exist (D-029); the boot script below picks one and the tokens set color-scheme to match.
  colorScheme: 'light dark',
  // The browser chrome follows the system, as the brand kit sets it, in each theme's canvas colour.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0b0d' },
  ],
};

/**
 * Every page: the fonts, the theme, the data layer, and while the mock runs the sample data strip above everything.
 * Each route group's layout draws its own frame and footer: the marketing navbar and column footer, the app shell with
 * its footer line, and the public pages' frame. Every one of them prints the disclaimer.
 *
 * The theme boot script runs in <head> before first paint and sets data-theme on <html> from the owner's saved
 * choice or the system setting, so a dark page never flashes light. React does not own that attribute, hence
 * suppressHydrationWarning on <html> alone.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  const mock = DATA_SOURCE === 'mock';
  return (
    <html lang="en" className={`${instrumentSans.variable} ${ibmPlexMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className={cx('flex min-h-dvh flex-col', mock && shellStyles.withNotice)}>
        <DataLayerProvider>
          {mock ? <SampleDataNotice /> : null}
          {children}
        </DataLayerProvider>
      </body>
    </html>
  );
}
