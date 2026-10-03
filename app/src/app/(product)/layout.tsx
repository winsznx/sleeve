import type { JSX, ReactNode } from 'react';

import { PRIMARY_NAV, SECONDARY_NAV } from '@/components/sleeve/navigation';
import { AppShell } from '@/components/ui/app-shell';
import { SAMPLE_ACCOUNT } from '@/data/mock';

// Every product screen sits inside the app shell, which also mounts the toast provider their actions use.
export default function ProductLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <AppShell primaryNav={PRIMARY_NAV} secondaryNav={SECONDARY_NAV} account={SAMPLE_ACCOUNT}>
      {children}
    </AppShell>
  );
}
