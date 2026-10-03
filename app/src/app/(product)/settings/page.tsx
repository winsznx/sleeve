import type { Metadata } from 'next';
import type { JSX } from 'react';

import { SettingsScreen } from './settings-screen';

export const metadata: Metadata = { title: 'Settings' };

export default function SettingsPage(): JSX.Element {
  return <SettingsScreen />;
}
