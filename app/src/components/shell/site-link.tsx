import Link from 'next/link';
import type { JSX, ReactNode } from 'react';

import { isExternal } from './site-map';

/** A same-page anchor or a file outside the app is a plain link; a route is a client navigation. */
export function SiteLink({
  href,
  className,
  children,
  onNavigate,
}: {
  href: string;
  className?: string;
  children: ReactNode;
  onNavigate?: () => void;
}): JSX.Element {
  if (isExternal(href)) {
    return (
      <a href={href} target="_blank" rel="noreferrer" onClick={onNavigate} className={className}>
        {children}
      </a>
    );
  }
  if (href.includes('#') || href.endsWith('.txt')) {
    return (
      <a href={href} onClick={onNavigate} className={className}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} onClick={onNavigate} className={className}>
      {children}
    </Link>
  );
}
