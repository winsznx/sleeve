import type { Metadata } from 'next';
import type { JSX } from 'react';

import { NotificationsScreen } from './notifications-screen';

export const metadata: Metadata = { title: 'Notifications' };

export default function NotificationsPage(): JSX.Element {
  return <NotificationsScreen />;
}
