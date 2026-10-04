import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Development pages: the component kit and the shell preview. Nothing links here, search engines are told to skip
 * it, and the production worker answers not found (SLEEVE_ENV, D-033). Previews and local builds render it.
 */
export default function DevLayout({ children }: { children: ReactNode }): ReactNode {
  if (process.env.SLEEVE_ENV === 'production') notFound();
  return children;
}
