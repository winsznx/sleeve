import type { Metadata } from 'next';
import type { JSX } from 'react';

import { InboxScreen } from './inbox-screen';

export const metadata: Metadata = { title: 'Inbox' };

export default function InboxPage(): JSX.Element {
  return <InboxScreen />;
}
