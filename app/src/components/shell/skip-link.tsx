import type { JSX } from 'react';

/** The first stop for keyboard users on every frame: straight to the page's main landmark. */
export function SkipLink({ target = 'main-content' }: { target?: string }): JSX.Element {
  return (
    <a
      href={`#${target}`}
      className="sr-only focus:not-sr-only focus:fixed focus:left-gutter focus:top-3 focus:z-toast focus:rounded-pill focus:bg-brand focus:px-4 focus:py-2.5 focus:text-body-s focus:font-medium focus:text-on-brand"
    >
      Skip to content
    </a>
  );
}
