import type { Metadata } from 'next';
import type { JSX } from 'react';

import { HomeScreen } from './home-screen';

export const metadata: Metadata = { title: 'Home' };

export default function HomePage(): JSX.Element {
  return <HomeScreen />;
}
