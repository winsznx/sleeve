import type { JSX } from 'react';

import { Footer } from './ui/footer';

/** The footer the root layout renders once on every page: the disclaimer word for word (docs/DESIGN.md 12.9). */
export function SiteFooter(): JSX.Element {
  return <Footer />;
}
