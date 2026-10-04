import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Pitch',
  robots: { index: false, follow: false },
};

/**
 * The deck is light only. The root boot script has already picked a theme from the system or the owner's choice;
 * this runs right after it, before first paint, and holds data-theme at light while the page is open. Nothing on
 * the deck links out, so leaving it is a full navigation and the boot script takes over again.
 */
const FORCE_LIGHT_SCRIPT = `(function(){var d=document.documentElement;function l(){if(d.dataset.theme!=="light")d.dataset.theme="light"}l();new MutationObserver(l).observe(d,{attributes:true,attributeFilter:["data-theme"]})})();`;

/** The pitch deck: unlisted, linked from nowhere, and kept out of search. */
export default function PitchLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: FORCE_LIGHT_SCRIPT }} />
      {children}
    </>
  );
}
