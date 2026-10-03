import type { Metadata } from 'next';
import type { JSX } from 'react';

import { HoldingsScreen } from './holdings-screen';

export const metadata: Metadata = { title: 'Holdings' };

export default function HoldingsPage(): JSX.Element {
  return (
    <div className="mx-auto w-full max-w-content">
      <HoldingsScreen />
    </div>
  );
}
