import type { JSX, ReactNode } from 'react';

import { SkipLink } from '@/components/shell/skip-link';
import { SiteFooter } from '@/components/site-footer';

/**
 * Pages anyone can open without an account, such as Check a split and a shared card. Each page draws its own public
 * frame, whose main landmark is #main-content; this layout puts the skip link to it first and the column footer with
 * the disclaimer last.
 */
export default function PublicLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <>
      <SkipLink />
      <div className="flex flex-1 flex-col">{children}</div>
      <SiteFooter />
    </>
  );
}
