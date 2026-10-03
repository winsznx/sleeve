import type { Metadata } from 'next';
import type { JSX } from 'react';

import { HelpScreen } from './help-screen';

export const metadata: Metadata = { title: 'Help' };

export default function HelpPage(): JSX.Element {
  return <HelpScreen />;
}
