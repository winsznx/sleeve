import type { JSX, ReactNode } from 'react';

import { PRIMARY_NAV, SECONDARY_NAV, SECTION_ALIASES } from '@/components/sleeve/navigation';
import { AppShell } from '@/components/ui/app-shell';

/**
 * Every product screen sits inside the app shell, which reads the signed-in account from the data layer and mounts
 * the toast provider and the Receive dialog the screens use.
 */
export default function ProductLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <AppShell primaryNav={PRIMARY_NAV} secondaryNav={SECONDARY_NAV} aliases={SECTION_ALIASES}>
      {children}
    </AppShell>
  );
}
