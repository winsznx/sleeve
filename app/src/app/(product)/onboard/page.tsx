import type { Metadata } from 'next';
import type { JSX } from 'react';

import { OnboardScreen } from './onboard-screen';

export const metadata: Metadata = { title: 'Set up Sleeve' };

export default function OnboardPage(): JSX.Element {
  return <OnboardScreen />;
}
